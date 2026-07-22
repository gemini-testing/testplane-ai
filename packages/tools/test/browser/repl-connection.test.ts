import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ReplConnection, type EvaluateResult } from "../../src/browser/repl-connection.js";

interface FakeReplServer {
    port: number;
    writes: string[];
    close(): Promise<void>;
}

function marker(command: string, name: "RESULT" | "END"): string {
    const match = command.match(new RegExp(`__TESTPLANE_MCP_${name}_[^"]+?__`));
    if (!match) {
        throw new Error(`No ${name} marker in command:\n${command}`);
    }

    return match[0];
}

async function createFakeReplServer(handler: (command: string) => EvaluateResult): Promise<FakeReplServer> {
    const writes: string[] = [];
    const sockets = new Set<net.Socket>();
    const server = net.createServer(socket => {
        sockets.add(socket);
        socket.on("data", data => {
            const command = data.toString();
            writes.push(command);

            const startMarker = marker(command, "RESULT");
            const endMarker = marker(command, "END");
            const response = `${startMarker}${JSON.stringify(handler(command))}${endMarker}`;

            socket.write("> ");
            socket.write(response.slice(0, Math.floor(response.length / 2)));
            socket.write(response.slice(Math.floor(response.length / 2)) + "\n> ");
        });
        socket.on("close", () => sockets.delete(socket));
    });

    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address");
    }

    return {
        port: address.port,
        writes,
        close: () =>
            new Promise<void>(resolve => {
                for (const socket of sockets) {
                    socket.destroy();
                }
                server.close(() => resolve());
            }),
    };
}

interface FakeRawChunk {
    data: string;
    delayMs?: number;
}

type FakeRawResponse = string | FakeRawChunk[];

async function createFakeRawReplServer(
    handler: (line: string, index: number) => FakeRawResponse,
): Promise<FakeReplServer> {
    const writes: string[] = [];
    const sockets = new Set<net.Socket>();
    const server = net.createServer(socket => {
        let input = "";
        sockets.add(socket);
        socket.on("data", data => {
            input += data.toString();

            let newlineIndex = input.indexOf("\n");
            while (newlineIndex !== -1) {
                const line = input.slice(0, newlineIndex);
                input = input.slice(newlineIndex + 1);
                writes.push(`${line}\n`);

                const response = handler(line, writes.length - 1);
                const chunks = typeof response === "string" ? [{ data: response }] : response;

                for (const chunk of chunks) {
                    const write = (): void => {
                        if (!socket.destroyed) {
                            socket.write(chunk.data);
                        }
                    };

                    if (chunk.delayMs) {
                        setTimeout(write, chunk.delayMs);
                    } else {
                        write();
                    }
                }

                newlineIndex = input.indexOf("\n");
            }
        });
        socket.on("close", () => sockets.delete(socket));
    });

    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address");
    }

    return {
        port: address.port,
        writes,
        close: () =>
            new Promise<void>(resolve => {
                for (const socket of sockets) {
                    socket.destroy();
                }
                server.close(() => resolve());
            }),
    };
}

describe("browser/ReplConnection", () => {
    let server: FakeReplServer | null = null;
    let connection: ReplConnection | null = null;

    afterEach(async () => {
        if (connection) {
            await connection.close();
            connection = null;
        }

        if (server) {
            await server.close();
            server = null;
        }
    });

    it("parses a JSON result block surrounded by REPL prompts", async () => {
        server = await createFakeReplServer(() => ({ ok: true, value: { url: "https://example.test" } }));
        connection = new ReplConnection({ port: server.port, evaluateTimeoutMs: 1_000 });

        const result = await connection.send("await browser.getUrl()");

        expect(result).toEqual({ ok: true, value: { url: "https://example.test" } });
        expect(server.writes).toHaveLength(1);
        expect(server.writes[0]).toContain("await browser.getUrl()");
        expect(server.writes[0]).toContain("function evaluateReplExpression");
        expect(server.writes[0]).toContain("this.browser");
        expect(server.writes[0].slice(0, -1)).not.toContain("\n");
    });

    it("returns evaluation errors without throwing transport errors", async () => {
        server = await createFakeReplServer(() => ({ ok: false, error: { message: "page crashed" } }));
        connection = new ReplConnection({ port: server.port, evaluateTimeoutMs: 1_000 });

        await expect(connection.send("await browser.getUrl()")).resolves.toEqual({
            ok: false,
            error: { message: "page crashed" },
        });
    });

    it("consumes the structured evaluation prompt before starting raw input", async () => {
        server = await createFakeRawReplServer((line, index) => {
            if (index === 0) {
                const startMarker = marker(line, "RESULT");
                const endMarker = marker(line, "END");

                return [
                    { data: `${startMarker}{"ok":true,"value":"https://example.test"}${endMarker}` },
                    { data: "\n> ", delayMs: 20 },
                ];
            }

            return index === 1 ? "undefined\n> " : "'https://example.test'\n> ";
        });
        connection = new ReplConnection({ port: server.port, evaluateTimeoutMs: 1_000 });

        await expect(connection.send("await browser.getUrl()")).resolves.toEqual({
            ok: true,
            value: "https://example.test",
        });
        await expect(connection.sendRaw("await browser.getUrl()")).resolves.toBe("'https://example.test'");
        expect(server.writes).toHaveLength(3);
    });

    it("passes raw code through one line at a time and waits for each primary prompt", async () => {
        server = await createFakeRawReplServer((_line, index) => {
            if (index === 0) {
                return "undefined\n> ";
            }

            if (index === 1) {
                return [{ data: "pending\n> ", delayMs: 20 }];
            }

            return "42\n> ";
        });
        connection = new ReplConnection({ port: server.port, evaluateTimeoutMs: 1_000 });

        await expect(connection.sendRaw("const value = await browser.getUrl();\nvalue")).resolves.toBe("pending\n42");
        expect(server.writes).toHaveLength(3);
        expect(server.writes[0]).toContain("function installBrowserFallback");
        expect(server.writes[0]).toContain("globalThis.browser");
        expect(server.writes[1]).toBe("const value = await browser.getUrl();\n");
        expect(server.writes[2]).toBe("value\n");
        expect(server.writes.join("")).not.toContain("__TESTPLANE_MCP_RAW_");
        expect(server.writes.join("")).not.toContain("await (async ()");
    });

    it("waits for delayed top-level await output instead of completing early", async () => {
        server = await createFakeRawReplServer((_line, index) => {
            if (index === 0) {
                return "undefined\n> ";
            }

            return [{ data: "'https://example.test/page'\n> ", delayMs: 20 }];
        });
        connection = new ReplConnection({ port: server.port, evaluateTimeoutMs: 1_000 });

        await expect(connection.sendRaw("await browser.getUrl()")).resolves.toBe("'https://example.test/page'");
        expect(server.writes).toHaveLength(2);
        expect(server.writes[1]).toBe("await browser.getUrl()\n");
    });

    it("uses continuation prompts to submit multiline input", async () => {
        server = await createFakeRawReplServer((_line, index) => {
            if (index === 0) {
                return "undefined\n> ";
            }

            if (index < 3) {
                return "... ";
            }

            return "42\n> ";
        });
        connection = new ReplConnection({ port: server.port, evaluateTimeoutMs: 1_000 });

        await expect(connection.sendRaw("if (true) {\n42\n}")).resolves.toBe("42");
        expect(server.writes.slice(1)).toEqual(["if (true) {\n", "42\n", "}\n"]);
    });

    it("preserves prompt-like user output that is followed by the actual prompt", async () => {
        server = await createFakeRawReplServer((_line, index) => {
            return index === 0 ? "undefined\n> " : "> \n... \n42\n> ";
        });
        connection = new ReplConnection({ port: server.port, evaluateTimeoutMs: 1_000 });

        await expect(connection.sendRaw("printPromptLikeOutput()")).resolves.toBe("> \n... \n42");
    });

    it("recognizes a primary prompt split across socket chunks", async () => {
        server = await createFakeRawReplServer((_line, index) => {
            if (index === 0) {
                return "undefined\n> ";
            }

            return [{ data: "42\n>" }, { data: " ", delayMs: 5 }];
        });
        connection = new ReplConnection({ port: server.port, evaluateTimeoutMs: 1_000 });

        await expect(connection.sendRaw("42")).resolves.toBe("42");
    });

    it("clears incomplete input when the source ends at a continuation prompt", async () => {
        server = await createFakeRawReplServer((_line, index) => {
            if (index === 0) {
                return "undefined\n> ";
            }

            return index === 1 ? "... " : "> ";
        });
        connection = new ReplConnection({ port: server.port, evaluateTimeoutMs: 1_000 });

        await expect(connection.sendRaw("if (true) {")).rejects.toThrow("requested more input");
        expect(server.writes.slice(1)).toEqual(["if (true) {\n", ".break\n"]);
    });
});
