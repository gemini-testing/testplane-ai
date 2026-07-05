import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { createErrorResponse, createSimpleResponse } from "../../responses/index.js";
import { StandaloneTool, ToolKind } from "../../types.js";
import { formatFileSize, formatTimestamp } from "../../utils/formatters.js";
import { loadTimeTravelArchive, resolveTargetTime, type TimeTravelArchive } from "./rrweb-snapshots.js";
import { formatBrowserWindow, formatReportTestSteps, formatSelectedTime, formatSourceInfo } from "./formatters.js";
import { getSnapshotInput, withRenderedTimeTravelFrame } from "./rendered-frame.js";
import { timeTravelSelectionSchema, validateTimeTravelSelection } from "./schema.js";
import type { SelectedSnapshotTime, SnapshotInputSelection } from "./types.js";

export const timeTravelExportHtmlSchema = {
    ...timeTravelSelectionSchema,
    filePath: z
        .string()
        .min(1)
        .transform(value => value.trim())
        .optional()
        .describe("Path to save the exported HTML file. Defaults to os.tmpdir()/.testplane/time-travel-snapshots"),
};

export const timeTravelExportHtmlObjectSchema = z
    .object(timeTravelExportHtmlSchema)
    .superRefine(validateTimeTravelSelection);

export type TimeTravelExportHtmlArgs = z.output<typeof timeTravelExportHtmlObjectSchema>;

interface SavedHtmlFile {
    filePath: string;
    fileSize: number;
}

async function saveHtmlFile(pageSource: string, filePath?: string): Promise<SavedHtmlFile> {
    const timestamp = formatTimestamp();
    const resolvedFilePath =
        filePath ?? path.join(os.tmpdir(), ".testplane", "time-travel-snapshots", `${timestamp}-${randomUUID()}.html`);
    const html = pageSource.trimStart().toLowerCase().startsWith("<!doctype")
        ? pageSource
        : `<!doctype html>\n${pageSource}`;

    await fs.mkdir(path.dirname(resolvedFilePath), { recursive: true });
    await fs.writeFile(resolvedFilePath, html, "utf8");

    const fileStats = await fs.stat(resolvedFilePath);

    return {
        filePath: resolvedFilePath,
        fileSize: fileStats.size,
    };
}

function formatResponse(
    args: TimeTravelExportHtmlArgs,
    input: SnapshotInputSelection,
    archive: TimeTravelArchive,
    selectedTime: SelectedSnapshotTime,
    saved: SavedHtmlFile,
): string {
    const sections = [
        "Time travel HTML exported",
        "## Source",
        formatSourceInfo(args, input, archive),
        "## Selected Time",
        formatSelectedTime(selectedTime),
        "## Browser Window",
        formatBrowserWindow(archive, selectedTime),
    ];

    if (input.result) {
        const testSteps = formatReportTestSteps(input.result, archive.metadata.startTime);
        if (testSteps) {
            sections.push("## Test Steps", testSteps);
        }
    }

    sections.push(
        "## HTML File",
        [
            `Saved to: ${saved.filePath}`,
            `Size: ${formatFileSize(saved.fileSize)}`,
            "Contains rrweb-reconstructed HTML plus captured inline CSS. External assets may still point to their original URLs.",
        ].join("\n"),
    );

    return sections.join("\n\n");
}

const timeTravelExportHtmlCb: StandaloneTool<typeof timeTravelExportHtmlSchema>["cb"] = async rawArgs => {
    try {
        const args = timeTravelExportHtmlObjectSchema.parse(rawArgs);
        const input = await getSnapshotInput(args);
        const archive = await loadTimeTravelArchive(input.source);
        const selectedTime = resolveTargetTime(archive.metadata, {
            time: args.time,
            defaultAbsoluteTime: input.defaultTime?.absoluteTime,
            defaultReason: input.defaultTime?.reason,
        });
        const pageSource = await withRenderedTimeTravelFrame(archive, selectedTime, browser => browser.getPageSource());
        const saved = await saveHtmlFile(pageSource, args.filePath);

        return createSimpleResponse(formatResponse(args, input, archive, selectedTime, saved));
    } catch (error) {
        console.error("Error exporting time travel HTML:", error);

        return createErrorResponse("Error exporting time travel HTML", error instanceof Error ? error : undefined);
    }
};

export const timeTravelExportHtml: StandaloneTool<typeof timeTravelExportHtmlSchema> = {
    kind: ToolKind.Standalone,
    name: "time-travel-export-html",
    description:
        "Export a Testplane Time Travel rrweb snapshot at a selected time as a browser-openable HTML file with captured inline styles",
    schema: timeTravelExportHtmlSchema,
    cb: timeTravelExportHtmlCb,
    cli: {
        section: "Reports",
        examples: [
            'testplane-cli time-travel-export-html /path/to/html-report --name "checkout submits order" --browser chrome',
            'testplane-cli time-travel-export-html /path/to/html-report --name "checkout submits order" --browser chrome --time 250',
            'testplane-cli time-travel-export-html /path/to/html-report --name "checkout submits order" --browser chrome --time 250 --file-path /tmp/snapshot.html',
            "testplane-cli time-travel-export-html --snapshot-file /path/to/snapshot.zip --time 100",
        ],
        positional: ["report"],
    },
};
