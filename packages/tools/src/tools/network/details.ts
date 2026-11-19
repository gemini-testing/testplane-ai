import { readFile, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { z } from "zod";
import { createErrorResponse, createSimpleResponse } from "../../responses/index.js";
import { type NetworkTool, type ToolResponse, ToolKind } from "../../types.js";
import { timeTravelSourceSchema } from "../../schemas/time-travel.js";
import { type CapturedRequest, readNetworkArchive, resolveNetworkArchivePath } from "./archive.js";
import { getLiveNetworkSnapshot } from "./live-snapshot.js";

const MAX_PREVIEW_BYTES = 4096;
const requestSchema = {
    ...timeTravelSourceSchema,
    requestId: z.string().describe("Request ID returned by network-list"),
};
const inspectSchema = {
    ...requestSchema,
    json: z.boolean().default(false).describe("Return structured JSON"),
};
const bodySchema = {
    ...requestSchema,
    request: z.boolean().default(false).describe("Retrieve the request body instead of the response body"),
    output: z.string().min(1).optional().describe("Write the body to a file. Required for binary bodies"),
};

type Headers = ReadonlyArray<{ name: string; value: string }>;
interface BodyRecord {
    headers: Headers;
    bodyFilePath?: string;
    bodyHash?: string;
    bodyError?: string;
}

function contentType(headers: Headers): string | undefined {
    return headers
        .find(header => header.name.toLowerCase() === "content-type")
        ?.value.split(";")[0]
        .trim()
        .toLowerCase();
}

function decodeTextBody(bytes: Uint8Array, mimeType?: string, truncated = false): string | undefined {
    if (mimeType && !/^(?:text\/|.*(?:json|xml|javascript|x-www-form-urlencoded)$)/.test(mimeType)) {
        return;
    }

    try {
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes, { stream: truncated });
        for (const char of text) {
            if (char < " " && !"\t\r\n".includes(char)) {
                return;
            }
        }
        return text;
    } catch {
        return;
    }
}

type BodyPreview =
    | { error: string }
    | ({ mimeType?: string; sha256?: string; sizeBytes: number } & (
          | { binary: true }
          | { preview: string; truncated: boolean }
      ));

async function previewBody(record: BodyRecord, zip?: Uint8Array): Promise<BodyPreview | undefined> {
    if (!record.bodyFilePath) {
        return record.bodyError ? { error: record.bodyError } : undefined;
    }

    const mimeType = contentType(record.headers);
    const metadata = { mimeType, sha256: record.bodyHash };
    let bytes: Uint8Array | undefined;
    try {
        const path = record.bodyFilePath;
        if (zip) {
            bytes = unzipSync(zip, { filter: entry => entry.name === path })[path];
        } else {
            bytes = await readFile(path);
        }
    } catch {
        return { error: "Captured body could not be read" };
    }

    if (!(bytes instanceof Uint8Array)) {
        return { error: "Captured body is missing from the snapshot archive" };
    }

    const sizeBytes = bytes.byteLength;
    const truncated = sizeBytes > MAX_PREVIEW_BYTES;
    const preview = decodeTextBody(bytes.subarray(0, MAX_PREVIEW_BYTES), mimeType, truncated);
    return preview === undefined
        ? { ...metadata, sizeBytes, binary: true }
        : { ...metadata, sizeBytes, preview, truncated };
}

function formatBody(body: BodyPreview | undefined): string {
    if (!body) {
        return "Body: unavailable";
    }
    if ("error" in body) {
        return `Body: ${body.error}`;
    }
    const details = [body.mimeType, `${body.sizeBytes} bytes`].filter(Boolean).join(", ");
    if ("binary" in body) {
        return `Body: binary (${details})`;
    }
    return `Body (${details})${body.truncated ? " (preview truncated)" : ""}:\n${body.preview}`;
}

function getNetworkRequest(requests: CapturedRequest[], requestId: string): CapturedRequest {
    const index = Number(requestId);
    const request = String(index) === requestId ? requests[index - 1] : undefined;
    if (!request) {
        throw new Error(`Request ${requestId} was not found in this recording`);
    }
    return request;
}

function createNetworkDetailsResponse(
    request: CapturedRequest,
    durationMs: number | undefined,
    requestBody: BodyPreview | undefined,
    responseBody: BodyPreview | undefined,
): ToolResponse {
    const { url, method, headers, resourceType, failure, failureDetails, response } = request;
    const lines = [`${method} ${url}`];
    if (resourceType) {
        lines.push(`Resource type: ${resourceType}`);
    }
    if (durationMs !== undefined) {
        lines.push(`Duration: ${durationMs.toFixed(2)} ms`);
    }
    if (failure) {
        lines.push(`Network failure: ${failure}`);
    }
    for (const [name, value] of Object.entries(failureDetails ?? {})) {
        lines.push(`${name}: ${value}`);
    }

    lines.push("", "Request headers:");
    lines.push(...headers.map(({ name, value }) => `${name}: ${value}`));
    lines.push(formatBody(requestBody));

    if (response) {
        const status = response.statusText ? `${response.status} ${response.statusText}` : response.status;
        lines.push("", `Response: ${status}`);
        if (response.networkStatus !== undefined) {
            lines.push(`Network status: ${response.networkStatus}`);
        }
        lines.push(...response.headers.map(({ name, value }) => `${name}: ${value}`));
        if (response.timing) {
            lines.push("", "Timing (ms):");
            for (const [name, value] of Object.entries(response.timing)) {
                if (value !== undefined) {
                    lines.push(`${name}: ${value}`);
                }
            }
        }
        lines.push(formatBody(responseBody));
    }

    return createSimpleResponse(lines.join("\n"));
}

const inspectNetworkCb: NetworkTool<typeof inspectSchema>["cb"] = async (args, recorder) => {
    try {
        const archivePath = await resolveNetworkArchivePath(args);
        let request: CapturedRequest;
        let zip: Uint8Array | undefined;
        if (archivePath !== undefined) {
            const archive = await readNetworkArchive(archivePath);
            request = getNetworkRequest(archive.requests, args.requestId);
            zip = archive.zip;
        } else if (recorder) {
            request = getNetworkRequest(getLiveNetworkSnapshot(recorder), args.requestId);
        } else {
            return createErrorResponse(
                "No live network recording. Launch a supported browser or select a saved recording",
            );
        }

        const [requestBody, responseBody] = await Promise.all([
            previewBody(request, zip),
            request.response && previewBody(request.response, zip),
        ]);
        const { timestamp, finishedAt, response } = request;
        const durationMs = finishedAt === undefined ? undefined : finishedAt - timestamp;
        if (args.json) {
            return createSimpleResponse(
                JSON.stringify(
                    {
                        requestId: args.requestId,
                        ...request,
                        durationMs,
                        body: requestBody,
                        response: response && { ...response, body: responseBody },
                    },
                    (key, value) =>
                        key === "bodyFilePath" || key === "bodyHash" || key === "bodyError" ? undefined : value,
                    2,
                ),
            );
        }

        return createNetworkDetailsResponse(request, durationMs, requestBody, responseBody);
    } catch (error) {
        return createErrorResponse(error instanceof Error ? error.message : "Error inspecting network request");
    }
};

export const inspectNetwork: NetworkTool<typeof inspectSchema> = {
    kind: ToolKind.Network,
    name: "network-inspect",
    description: "Inspect a request and its response, including headers and body previews",
    schema: inspectSchema,
    cli: {
        section: "Network",
        positional: ["requestId"],
        resolvePaths: { report: "path-or-url", snapshotFile: "path-or-url" },
    },
    cb: inspectNetworkCb,
};

const networkBodyCb: NetworkTool<typeof bodySchema>["cb"] = async (args, recorder) => {
    try {
        const archivePath = await resolveNetworkArchivePath(args);
        let request: CapturedRequest;
        let zip: Uint8Array | undefined;
        if (archivePath !== undefined) {
            const archive = await readNetworkArchive(archivePath);
            request = getNetworkRequest(archive.requests, args.requestId);
            zip = archive.zip;
        } else if (recorder) {
            request = getNetworkRequest(getLiveNetworkSnapshot(recorder), args.requestId);
        } else {
            return createErrorResponse(
                "No live network recording. Launch a supported browser or select a saved recording",
            );
        }

        const body = args.request ? request : request.response;
        const direction = args.request ? "request" : "response";
        if (!body?.bodyFilePath) {
            const reason = body?.bodyError;
            return createErrorResponse(`Captured ${direction} body is unavailable${reason ? `: ${reason}` : ""}`);
        }

        const path = body.bodyFilePath;
        let bytes: Uint8Array;
        if (zip) {
            bytes = unzipSync(zip, { filter: entry => entry.name === path })[path];
            if (!(bytes instanceof Uint8Array)) {
                return createErrorResponse("Captured body is missing from the snapshot archive");
            }
        } else {
            bytes = await readFile(path);
        }
        if (args.output !== undefined) {
            await writeFile(args.output, bytes);
            return createSimpleResponse(`Saved to: ${args.output}`);
        }

        const text = decodeTextBody(bytes, contentType(body.headers));
        if (text === undefined) {
            return createErrorResponse("Binary bodies require an output path.");
        }
        return createSimpleResponse(text);
    } catch (error) {
        return createErrorResponse(error instanceof Error ? error.message : "Error retrieving network body");
    }
};

export const networkBody: NetworkTool<typeof bodySchema> = {
    kind: ToolKind.Network,
    name: "network-body",
    description: "Retrieve the complete captured response body, or the request body when requested",
    schema: bodySchema,
    cli: {
        section: "Network",
        positional: ["requestId"],
        resolvePaths: { report: "path-or-url", snapshotFile: "path-or-url", output: "path" },
    },
    cb: networkBodyCb,
};
