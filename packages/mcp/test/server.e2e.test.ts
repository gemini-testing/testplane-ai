import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { startClient, E2E_TEST_TIMEOUT } from "./utils.js";
import { PlaygroundServer } from "./test-server.js";

const EXPECTED_TOOL_NAMES = [
    // action tools
    "navigate",
    "click",
    "hover",
    "type",
    "select",
    "wait",
    "snapshot",
    "screenshot",
    "console",
    "network-list",
    "network-inspect",
    "network-body",
    "list-tabs",
    "switch-tab",
    "new-tab",
    "close-tab",
    "save-state",
    "restore-state",
    // report tools
    "test-results",
    "inspect-result",
    "time-travel-snapshot",
    "time-travel-export-html",
    // session tools
    "launch",
    "attach",
    "attach-repl",
    "close-browser",
    // advanced tools
    "run-code",
];

describe(
    "mcp server e2e",
    () => {
        let client: Client;
        let testServer: PlaygroundServer;
        let playgroundUrl: string;

        beforeAll(async () => {
            testServer = new PlaygroundServer();
            playgroundUrl = await testServer.start();
            client = await startClient();
        }, E2E_TEST_TIMEOUT);

        afterAll(async () => {
            try {
                await client?.callTool({ name: "close-browser", arguments: {} });
            } finally {
                await Promise.all([client?.close(), testServer?.stop()]);
            }
        });

        it("registers every tool with MCP", async () => {
            const { tools } = await client.listTools();
            const names = tools.map(t => t.name).sort();
            expect(names).toEqual([...EXPECTED_TOOL_NAMES].sort());
        });

        it("requires an active browser for non-navigate action tools", async () => {
            const result = await client.callTool({
                name: "click",
                arguments: {
                    selector: "#btn",
                },
            });
            expect(result.isError).toBe(true);

            const content = result.content as Array<{ type: string; text: string }>;
            const text = content.map(c => c.text).join("\n");
            expect(text).toContain("No active browser session");
        });

        it("auto-launches the browser on first action tool call", async () => {
            const result = await client.callTool({ name: "navigate", arguments: { url: playgroundUrl } });
            expect(result.isError).toBe(false);

            const content = result.content as Array<{ type: string; text: string }>;
            const text = content.map(c => c.text).join("\n");
            expect(text).toContain(`Successfully navigated to ${playgroundUrl}`);

            const snapshotPathMatch = text.match(/(?:Saved to:|The snapshot was saved to:) (\S+\.(?:yml|html))/);
            expect(snapshotPathMatch, "navigate response should reference a saved snapshot file").not.toBeNull();
            const snapshotContent = fs.readFileSync(snapshotPathMatch![1], "utf8");
            expect(snapshotContent).toContain("server-wiring-ok");
        });

        it("lists, inspects, and reads a live browser response", async () => {
            const navigate = await client.callTool({ name: "navigate", arguments: { url: playgroundUrl } });
            expect(navigate.isError).toBeFalsy();

            const fetchResponse = await client.callTool({
                name: "run-code",
                arguments: {
                    code: `await browser.execute(async () => {
                        const response = await fetch("/network-fixture", { headers: { "X-Api-Key": "fixture-key" } });
                        return response.text();
                    })`,
                },
            });
            expect(fetchResponse.isError).toBeFalsy();

            const url = new URL("/network-fixture", playgroundUrl).href;
            const list = await client.callTool({ name: "network-list", arguments: { url, json: true } });
            const [listing] = list.content as Array<{ type: "text"; text: string }>;
            const { requests } = JSON.parse(listing.text);
            const { requestId } = requests.find((request: { url: string }) => request.url === url);

            const inspect = await client.callTool({ name: "network-inspect", arguments: { requestId, json: true } });
            const [details] = inspect.content as Array<{ type: "text"; text: string }>;
            const recorded = JSON.parse(details.text);
            expect(recorded).toMatchObject({ method: "GET", response: { status: 200 } });
            const headers = (entries: { name: string; value: string }[]) =>
                Object.fromEntries(entries.map(({ name, value }) => [name.toLowerCase(), value]));
            expect(headers(recorded.headers)["x-api-key"]).toBe("fixtu...");
            expect(headers(recorded.response.headers)).toMatchObject({
                "set-cookie": "fixtu...",
                "x-debug": "Beare...",
            });

            // The recorder writes the body asynchronously after the response arrives.
            await expect
                .poll(() => client.callTool({ name: "network-body", arguments: { requestId } }), { timeout: 5000 })
                .toMatchObject({ isError: false, content: [{ type: "text", text: "server-wiring-ok" }] });
        });

        it("closeBrowser ends the session cleanly", async () => {
            const result = await client.callTool({ name: "close-browser", arguments: {} });
            expect(result.isError).toBe(false);

            const content = result.content as Array<{ type: string; text: string }>;
            const text = content.map(c => c.text).join("\n");
            expect(text.toLowerCase()).toContain("browser session closed");
        });

        it("re-auto-launches after a closeBrowser", async () => {
            const result = await client.callTool({ name: "navigate", arguments: { url: playgroundUrl } });
            expect(result.isError).toBe(false);
        });

        it("returns browser-side console messages from a real page", async () => {
            const consolePageUrl = `${playgroundUrl}/console.html`;
            const navigateResult = await client.callTool({ name: "navigate", arguments: { url: consolePageUrl } });
            expect(navigateResult.isError).toBe(false);

            const result = await client.callTool({ name: "console", arguments: {} });
            expect(result.isError).toBe(false);

            const content = result.content as Array<{ type: string; text: string }>;
            const text = content.map(c => c.text).join("\n");
            expect(text).toContain("Retrieved");
            expect(text).toContain('const consoleMessages = await browser.getLogs("browser");');
            expect(text).toContain("testplane-mcp-console-e2e warning");
            expect(text).toContain("testplane-mcp-console-e2e error");
        });

        it("surfaces tool-level errors as isError responses", async () => {
            const result = await client.callTool({
                name: "click",
                arguments: {
                    selector: "#does-not-exist-1234",
                },
            });
            expect(result.isError).toBe(true);
        });
    },
    E2E_TEST_TIMEOUT,
);
