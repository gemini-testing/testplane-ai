import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { expect, it } from "vitest";
import { runCli } from "./utils.js";

const bodyPath = (bytes: Uint8Array) => "network/bodies/" + createHash("sha256").update(bytes).digest("hex");

it("shows the network commands in CLI help", async () => {
    const help = await runCli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("network-list [options]");
    expect(help.stdout).toContain("network-inspect [options] <requestId>");
    expect(help.stdout).toContain("network-body [options] <requestId>");
});

it("lists, inspects, and reads exact bytes from a saved recording without a browser", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tp-network-"));
    try {
        const requestBody = strToU8("request payload");
        const responseBody = Uint8Array.of(0, 255, 128, 10, 42);
        const requests = [
            { url: "http://localhost/page", method: "GET", timestamp: 1, response: { status: 200 } },
            {
                url: "http://localhost/api?q=a+b",
                method: "POST",
                resourceType: "fetch",
                timestamp: 2,
                headers: [{ name: "X-Fixture", value: "recorded" }],
                bodyFilePath: bodyPath(requestBody),
                response: {
                    status: 404,
                    headers: [{ name: "Content-Type", value: "application/octet-stream" }],
                    timing: { startTime: 2, responseHeadersStart: 5 },
                    bodyFilePath: bodyPath(responseBody),
                },
            },
            { url: "http://localhost/failed", method: "GET", timestamp: 3, failure: "net::ERR_FAILED" },
        ];
        const env = { TESTPLANE_CLI_SOCKET_OVERRIDE: path.join(dir, "cli.sock"), TESTPLANE_CLI_DAEMON_IDLE_MS: "1000" };
        await writeFile(
            path.join(dir, "capture.zip"),
            zipSync({
                "network.json": strToU8(JSON.stringify({ version: 1, requests })),
                [bodyPath(requestBody)]: requestBody,
                [bodyPath(responseBody)]: responseBody,
            }),
        );
        const daemonDir = path.join(dir, "daemon-cwd");
        await mkdir(daemonDir);
        const source = ["--snapshot-file", "capture.zip", "--json"];
        const listing = await runCli(
            ["network-list", "--snapshot-file", path.join(dir, "capture.zip"), "--json", "--errors", "--limit", "0"],
            env,
            daemonDir,
        );
        expect(listing.code).toBe(0);
        expect(JSON.parse(listing.stdout).requests.map((request: { requestId: string }) => request.requestId)).toEqual([
            "2",
            "3",
        ]);

        const filtered = await runCli(
            ["network-list", ...source, "--url", "a+b", "--method", "post", "--type", "fetch,xhr", "--status", "4xx"],
            env,
            dir,
        );
        expect(filtered.code).toBe(0);
        expect(JSON.parse(filtered.stdout)).toMatchObject({
            matched: 1,
            requests: [{ requestId: "2", resourceType: "fetch", status: 404 }],
        });

        const inspected = await runCli(["network-inspect", "2", ...source], env, dir);
        expect(inspected.code).toBe(0);
        const details = JSON.parse(inspected.stdout);
        expect(details).toMatchObject({
            url: requests[1].url,
            headers: [{ name: "X-Fixture", value: "recorded" }],
            body: { preview: "request payload" },
            response: {
                timing: { startTime: 2, responseHeadersStart: 5 },
                body: { binary: true, sizeBytes: responseBody.length },
            },
        });

        expect(details).not.toHaveProperty("bodyFilePath");
        expect(details.response).not.toHaveProperty("bodyFilePath");

        const printed = await runCli(["network-inspect", "2", "--snapshot-file", "capture.zip"], env, dir);
        expect(printed.code).toBe(0);
        expect(printed.stdout).toContain("Request headers:\nX-Fixture: recorded");
        expect(printed.stdout).toContain("Response: 404\nContent-Type: application/octet-stream");
        expect(printed.stdout).toContain("Timing (ms):\nstartTime: 2\nresponseHeadersStart: 5");

        const bodyArgs = ["network-body", "2", "--snapshot-file", "capture.zip"];
        const binary = await runCli(bodyArgs, env, dir);
        expect(binary.code).toBe(1);
        expect(binary.stdout).toContain("Binary bodies require an output path");

        const saved = await runCli([...bodyArgs, "--output", "response.bin"], env, dir);
        expect(saved.code).toBe(0);
        expect(saved.stdout).toContain("Saved to:");
        expect(await readFile(path.join(dir, "response.bin"))).toEqual(Buffer.from(responseBody));

        const text = await runCli([...bodyArgs, "--request"], env, dir);
        expect(text).toMatchObject({ code: 0, stdout: "request payload\n" });

        const savedText = await runCli([...bodyArgs, "--request", "--output", "request.txt"], env, dir);
        expect(savedText.code).toBe(0);
        expect(await readFile(path.join(dir, "request.txt"))).toEqual(Buffer.from(requestBody));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
