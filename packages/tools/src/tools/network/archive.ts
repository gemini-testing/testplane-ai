import { unzipSync, strFromU8 } from "fflate";
import { z } from "zod";
import type { ToolArgs } from "../../types.js";
import { getSnapshotInput, readTimeTravelZip } from "../../utils/time-travel.js";
import { timeTravelSourceSchema } from "../../schemas/time-travel.js";

const headers = z
    .array(z.object({ name: z.string(), value: z.string() }))
    .readonly()
    .default([]);
const bodyFields = {
    bodyFilePath: z.string().optional(),
    bodyHash: z.string().optional(),
    bodyError: z.string().optional(),
};

const timing = {
    startTime: z.number(),
    dnsStart: z.number().optional(),
    dnsEnd: z.number().optional(),
    connectStart: z.number().optional(),
    connectEnd: z.number().optional(),
    tlsStart: z.number().optional(),
    tlsEnd: z.number().optional(),
    sendStart: z.number().optional(),
    sendEnd: z.number().optional(),
    responseHeadersStart: z.number().optional(),
    responseHeadersEnd: z.number().optional(),
};

const archiveSchema = z.object({
    version: z.literal(1),
    requests: z.array(
        z.object({
            ...bodyFields,
            url: z.string(),
            method: z.string(),
            headers,
            timestamp: z.number(),
            resourceType: z.string().optional(),
            finishedAt: z.number().optional(),
            failure: z.string().optional(),
            failureDetails: z
                .object({
                    blockedReason: z.string().optional(),
                    corsError: z.string().optional(),
                    failedParameter: z.string().optional(),
                })
                .optional(),
            response: z
                .object({
                    ...bodyFields,
                    status: z.number(),
                    statusText: z.string().optional(),
                    headers,
                    networkStatus: z.number().optional(),
                    timestamp: z.number().optional(),
                    timing: z.object(timing).optional(),
                })
                .optional(),
        }),
    ),
});
type SourceArgs = ToolArgs<typeof timeTravelSourceSchema>;
export type CapturedRequest = z.output<typeof archiveSchema>["requests"][number];

export async function resolveNetworkArchivePath(args: SourceArgs): Promise<string | undefined> {
    const reportSelected = [args.report, args.name, args.browser, args.attempt].some(value => value !== undefined);
    if (args.snapshotFile === undefined && !reportSelected) {
        return;
    }
    if (
        reportSelected
            ? args.snapshotFile !== undefined || !args.report || !args.name || !args.browser
            : !args.snapshotFile
    ) {
        throw new Error("Provide either --snapshot-file or all of --report, --name and --browser");
    }

    const { source } = await getSnapshotInput(args);
    return source;
}

export async function readNetworkArchive(source: string): Promise<{ requests: CapturedRequest[]; zip: Uint8Array }> {
    const zip = await readTimeTravelZip(source);
    const entries = unzipSync(zip, { filter: entry => entry.name === "network.json" });
    const network = entries["network.json"];
    if (!network) {
        throw new Error("This snapshot archive has no network recording");
    }

    const { requests } = archiveSchema.parse(JSON.parse(strFromU8(network)));
    return { zip, requests };
}
