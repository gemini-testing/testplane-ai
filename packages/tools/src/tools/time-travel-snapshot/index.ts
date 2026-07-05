import { createErrorResponse, createSimpleResponse } from "../../responses/index.js";
import {
    type CaptureSnapshotOptions,
    getPageSnapshot,
    type PageSnapshotResult,
    convertSnapshotToResponse,
} from "../../responses/browser-helpers.js";
import { StandaloneTool, ToolKind } from "../../types.js";
import { loadTimeTravelArchive, resolveTargetTime, type TimeTravelArchive } from "./rrweb-snapshots.js";
import { getSnapshotInput, withRenderedTimeTravelFrame } from "./rendered-frame.js";
import { timeTravelSnapshotObjectSchema, timeTravelSnapshotSchema, type TimeTravelSnapshotArgs } from "./schema.js";
import { diffPageSnapshots } from "./snapshot-diff.js";
import { SelectedSnapshotTime } from "./types.js";
import { formatResponse } from "./formatters.js";

export { timeTravelExportHtml, timeTravelExportHtmlObjectSchema, timeTravelExportHtmlSchema } from "./export-html.js";
export { timeTravelSnapshotObjectSchema, timeTravelSnapshotSchema } from "./schema.js";
export {
    loadTimeTravelArchive as loadRrwebSnapshotArchive,
    resolveTargetTime,
    resolveViewportSizeAt,
} from "./rrweb-snapshots.js";
export {
    findReportTestResult,
    getReportDefaultTime,
    getSnapshotAttachment,
    resolveSnapshotAttachmentSource,
} from "./report.js";
export { diffPageSnapshots } from "./snapshot-diff.js";

function getSnapshotOptions(args: TimeTravelSnapshotArgs): CaptureSnapshotOptions {
    return {
        includeTags: args.includeTags,
        includeAttrs: args.includeAttrs,
        excludeTags: args.excludeTags,
        excludeAttrs: args.excludeAttrs,
        truncateText: args.truncateText,
        maxTextLength: args.maxTextLength,
    };
}

async function captureRenderedSnapshot(
    archive: TimeTravelArchive,
    selectedTime: SelectedSnapshotTime,
    snapshotOptions: CaptureSnapshotOptions,
): Promise<PageSnapshotResult> {
    return withRenderedTimeTravelFrame(archive, selectedTime, async browser => {
        const snapshot = await getPageSnapshot(browser, snapshotOptions);
        if (!snapshot) {
            throw new Error("Failed to capture DOM snapshot from rrweb iframe.");
        }

        return snapshot;
    });
}

const timeTravelSnapshotCb: StandaloneTool<typeof timeTravelSnapshotSchema>["cb"] = async rawArgs => {
    try {
        const args = timeTravelSnapshotObjectSchema.parse(rawArgs);
        const input = await getSnapshotInput(args);
        const archive = await loadTimeTravelArchive(input.source);
        const selectedTime = resolveTargetTime(archive.metadata, {
            time: args.time,
            defaultAbsoluteTime: input.defaultTime?.absoluteTime,
            defaultReason: input.defaultTime?.reason,
        });
        const snapshotOptions = getSnapshotOptions(args);

        const currentSnapshot = await captureRenderedSnapshot(archive, selectedTime, snapshotOptions);
        let outputSnapshot = currentSnapshot;

        const diffFromTime =
            args.diffFrom === undefined
                ? undefined
                : resolveTargetTime(archive.metadata, {
                      time: args.diffFrom,
                  });
        if (diffFromTime) {
            const baselineSnapshot = await captureRenderedSnapshot(archive, diffFromTime, snapshotOptions);
            outputSnapshot = diffPageSnapshots(baselineSnapshot, currentSnapshot);
        }
        const snapshotResponse = await convertSnapshotToResponse(outputSnapshot);

        return createSimpleResponse(formatResponse(args, input, archive, selectedTime, diffFromTime, snapshotResponse));
    } catch (error) {
        console.error("Error capturing time travel snapshot:", error);

        return createErrorResponse("Error capturing time travel snapshot", error instanceof Error ? error : undefined);
    }
};

export const timeTravelSnapshot: StandaloneTool<typeof timeTravelSnapshotSchema> = {
    kind: ToolKind.Standalone,
    name: "time-travel-snapshot",
    description:
        "Inspect Testplane Time Travel rrweb snapshot at a selected time and return a DOM snapshot of the replayed page, optionally with a diff from a previous time",
    schema: timeTravelSnapshotSchema,
    cb: timeTravelSnapshotCb,
    cli: {
        section: "Reports",
        examples: [
            'testplane-cli time-travel-snapshot /path/to/html-report --name "checkout submits order" --browser chrome',
            'testplane-cli time-travel-snapshot /path/to/html-report --name "checkout submits order" --browser chrome --time 250',
            'testplane-cli time-travel-snapshot /path/to/html-report --name "checkout submits order" --browser chrome --time 250 --diff-from 100',
            "testplane-cli time-travel-snapshot --snapshot-file /path/to/snapshot.zip --time 100",
        ],
        positional: ["report"],
    },
};
