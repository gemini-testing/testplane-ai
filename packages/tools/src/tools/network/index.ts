import { z } from "zod";
import { createErrorResponse, createSimpleResponse } from "../../responses/index.js";
import { type NetworkTool, ToolKind } from "../../types.js";
import { truncateText } from "../../utils/strings.js";
import { timeTravelSourceSchema } from "../../schemas/time-travel.js";
import { type CapturedRequest, readNetworkArchive, resolveNetworkArchivePath } from "./archive.js";
import { getLiveNetworkSnapshot } from "./live-snapshot.js";

export { inspectNetwork, networkBody } from "./details.js";

const MAX_DISPLAY_URL_LENGTH = 120;

const split = (value?: string): string[] =>
    value
        ?.split(",")
        .map(part => part.trim().toLowerCase())
        .filter(Boolean) ?? [];

const listNetworkSchema = {
    ...timeTravelSourceSchema,
    url: z.string().optional().describe("Filter by a literal substring of the URL"),
    method: z.string().optional().describe("Filter by HTTP method, e.g. GET or POST"),
    type: z.string().optional().describe("Filter by comma-separated resource types, e.g. fetch,xhr"),
    status: z
        .string()
        .refine(
            value => split(value).length > 0 && split(value).every(status => /^[1-5](?:[0-9]{2}|xx)$/.test(status)),
            "Use HTTP status codes or classes, e.g. 404 or 4xx,5xx",
        )
        .optional()
        .describe("Filter by HTTP status codes or classes, e.g. 404 or 4xx,5xx"),
    errors: z.boolean().default(false).describe("Show HTTP 4xx/5xx responses and network failures"),
    limit: z
        .number()
        .int()
        .nonnegative()
        .default(50)
        .describe("Maximum requests to show. 0 means all retained requests"),
    json: z.boolean().default(false).describe("Return structured JSON"),
};

type ListNetwork = NetworkTool<typeof listNetworkSchema>;

const listNetworkCb: ListNetwork["cb"] = async (args, recorder) => {
    try {
        const archivePath = await resolveNetworkArchivePath(args);
        let requests: CapturedRequest[];
        if (archivePath !== undefined) {
            const archive = await readNetworkArchive(archivePath);
            requests = archive.requests;
        } else if (recorder) {
            requests = getLiveNetworkSnapshot(recorder);
        } else {
            return createErrorResponse(
                "No live network recording. Launch a supported browser or select a saved recording",
            );
        }

        const types = split(args.type);
        const statuses = split(args.status);
        const method = args.method?.toUpperCase();
        const matching = requests.flatMap((request, index) => {
            const { url, resourceType, failure, response, timestamp, finishedAt } = request;
            const status = response?.status;
            if (
                (args.url && !url.includes(args.url)) ||
                (method && request.method.toUpperCase() !== method) ||
                (types.length && (!resourceType || !types.includes(resourceType.toLowerCase()))) ||
                (statuses.length &&
                    (status === undefined ||
                        !statuses.some(
                            filter => filter === String(status) || filter === Math.floor(status / 100) + "xx",
                        ))) ||
                (args.errors && failure === undefined && (status === undefined || status < 400 || status >= 600))
            ) {
                return [];
            }

            return [
                {
                    requestId: String(index + 1),
                    method: request.method,
                    url,
                    resourceType,
                    status,
                    networkStatus: response?.networkStatus,
                    failure,
                    durationMs: finishedAt === undefined ? undefined : finishedAt - timestamp,
                },
            ];
        });
        const listed = args.limit === 0 ? matching : matching.slice(0, args.limit);
        if (args.json) {
            return createSimpleResponse(
                JSON.stringify({ total: requests.length, matched: matching.length, requests: listed }, null, 2),
            );
        }
        return createSimpleResponse(
            [
                `Showing ${listed.length} of ${matching.length} matching requests (${requests.length} captured)`,
                ...listed.map(request =>
                    [
                        request.requestId,
                        request.method,
                        request.status ?? "-",
                        request.resourceType ?? "-",
                        truncateText(request.url, MAX_DISPLAY_URL_LENGTH),
                        request.failure,
                    ]
                        .filter(value => value !== undefined)
                        .join("\t"),
                ),
            ].join("\n"),
        );
    } catch (error) {
        return createErrorResponse(error instanceof Error ? error.message : "Error listing network requests");
    }
};

export const listNetwork: ListNetwork = {
    kind: ToolKind.Network,
    name: "network-list",
    description: "List captured requests from the active browser session or a saved Time Travel recording",
    schema: listNetworkSchema,
    cli: {
        resolvePaths: { report: "path-or-url", snapshotFile: "path-or-url" },
        section: "Network",
        examples: [
            "testplane-cli network-list --type fetch,xhr --errors",
            "testplane-cli network-list --snapshot-file ./snapshot.zip --json",
        ],
    },
    cb: listNetworkCb,
};
