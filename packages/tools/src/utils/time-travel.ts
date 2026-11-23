import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readResultsFromReport, type ReporterTestResult } from "html-reporter/experimental/sdk";
import type { timeTravelSourceSchema } from "../schemas/time-travel.js";
import type { ToolArgs } from "../types.js";
import { downloadReportIfNeeded } from "./html-report.js";

type TimeTravelInputArgs = ToolArgs<typeof timeTravelSourceSchema>;

export interface SnapshotInputSelection {
    mode: "report" | "direct";
    source: string;
    result?: ReporterTestResult;
}

interface SnapshotAttachment {
    type: 0; // AttachmentType.Snapshot in html-reporter
    path: string;
    maxWidth?: number;
    maxHeight?: number;
}

export interface ReportResultSelection {
    name: string;
    browser: string;
    attempt?: number;
}

function getLatestAttempt<T extends ReporterTestResult>(results: readonly T[]): T {
    return results.reduce((latest, result) => {
        if (
            result.attempt > latest.attempt ||
            (result.attempt === latest.attempt && (result.timestamp ?? 0) >= (latest.timestamp ?? 0))
        ) {
            return result;
        }

        return latest;
    });
}

function getSelectionErrorMessage(results: readonly ReporterTestResult[], args: ReportResultSelection): string {
    const resultsWithMatchingName = results.filter(result => result.fullName === args.name);

    if (!resultsWithMatchingName.length) {
        return `No test result found with name "${args.name}". You can check what tests are available with the "test-results" tool.`;
    }

    const resultsWithMatchingBrowser = resultsWithMatchingName.filter(result => result.browserId === args.browser);
    if (!resultsWithMatchingBrowser.length) {
        const availableBrowsers = [...new Set(resultsWithMatchingName.map(result => result.browserId))].sort();

        return `No test result found with name "${args.name}" in browser "${args.browser}". Available browsers: ${availableBrowsers.join(", ")}.`;
    }

    const availableAttempts = [...new Set(resultsWithMatchingBrowser.map(result => result.attempt))].sort();

    return `No attempt ${args.attempt} found for test "${args.name}" in browser "${args.browser}". Available attempts: ${availableAttempts.join(", ")}.`;
}

export function findReportTestResult(
    results: readonly ReporterTestResult[],
    args: ReportResultSelection,
): ReporterTestResult {
    const matchingAttempts = results.filter(
        result => result.fullName === args.name && result.browserId === args.browser,
    );

    if (!matchingAttempts.length) {
        throw new Error(getSelectionErrorMessage(results, args));
    }

    if (args.attempt === undefined) {
        return getLatestAttempt(matchingAttempts);
    }

    const matchingAttempt = matchingAttempts.find(result => result.attempt === args.attempt);
    if (!matchingAttempt) {
        throw new Error(getSelectionErrorMessage(results, args));
    }

    return matchingAttempt;
}

function isSnapshotAttachment(attachment: unknown): attachment is SnapshotAttachment {
    return (
        typeof attachment === "object" &&
        attachment !== null &&
        "path" in attachment &&
        typeof attachment.path === "string" &&
        "type" in attachment &&
        attachment.type === 0
    );
}

export function getSnapshotAttachment(result: ReporterTestResult): SnapshotAttachment {
    const attachment = result.attachments?.find(candidate => isSnapshotAttachment(candidate));
    if (!isSnapshotAttachment(attachment)) {
        throw new Error(
            `No time travel snapshot attachment found for "${result.fullName}" in browser "${result.browserId}" attempt ${result.attempt}.`,
        );
    }

    return attachment;
}

function resolveRemoteSnapshotPath(report: string, attachmentPath: string): string {
    if (isRemoteSource(attachmentPath)) {
        return attachmentPath;
    }

    const reportUrl = new URL(report);
    if (!path.posix.extname(reportUrl.pathname) && !reportUrl.pathname.endsWith("/")) {
        reportUrl.pathname += "/";
    }

    return new URL(attachmentPath, reportUrl).toString();
}

async function getLocalReportDir(reportPath: string): Promise<string> {
    try {
        const reportStat = await stat(reportPath);

        return reportStat.isDirectory() ? reportPath : path.dirname(reportPath);
    } catch {
        return path.dirname(reportPath);
    }
}

export async function resolveSnapshotAttachmentSource(
    originalReport: string,
    resolvedReportPath: string,
    attachmentPath: string,
): Promise<string> {
    if (isRemoteSource(originalReport)) {
        return resolveRemoteSnapshotPath(originalReport, attachmentPath);
    }

    if (isRemoteSource(attachmentPath)) {
        return attachmentPath;
    }

    const reportDir = await getLocalReportDir(resolvedReportPath);

    return path.resolve(reportDir, attachmentPath);
}

export async function getSnapshotInput(args: TimeTravelInputArgs): Promise<SnapshotInputSelection> {
    if (args.snapshotFile) {
        return {
            mode: "direct",
            source: args.snapshotFile,
        };
    }

    const reportPath = await downloadReportIfNeeded(args.report!);
    const results = await readResultsFromReport(reportPath);
    const result = findReportTestResult(results, {
        name: args.name!,
        browser: args.browser!,
        attempt: args.attempt,
    });
    const attachment = getSnapshotAttachment(result);
    const source = await resolveSnapshotAttachmentSource(args.report!, reportPath, attachment.path);

    return {
        mode: "report",
        source,
        result,
    };
}

function isRemoteSource(source: string): boolean {
    try {
        const url = new URL(source);

        return Boolean(url.host && url.protocol !== "file:");
    } catch {
        return false;
    }
}

function sourceToLocalPath(source: string): string {
    try {
        const url = new URL(source);

        if (url.protocol === "file:") {
            return fileURLToPath(url);
        }
    } catch {
        // Not a URL, treat it as a local path.
    }

    return source;
}

export async function readTimeTravelZip(source: string): Promise<Uint8Array> {
    if (isRemoteSource(source)) {
        const response = await fetch(source);
        if (!response.ok) {
            throw new Error(`Failed to fetch snapshot archive "${source}": ${response.status} ${response.statusText}`);
        }

        return new Uint8Array(await response.arrayBuffer());
    }

    return new Uint8Array(await readFile(sourceToLocalPath(source)));
}
