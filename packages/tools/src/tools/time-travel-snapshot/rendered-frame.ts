import { readResultsFromReport } from "html-reporter/experimental/sdk";
import type { WdioBrowser } from "testplane";
import { downloadReportIfNeeded } from "../../utils/html-report.js";
import { launchBrowserWithOptions } from "../launch-browser.js";
import type { TimeTravelArchive } from "./rrweb-snapshots.js";
import {
    findReportTestResult,
    getReportDefaultTime,
    getSnapshotAttachment,
    resolveSnapshotAttachmentSource,
} from "./report.js";
import { startTimeTravelRenderServer, type TimeTravelRenderServer } from "./render-server.js";
import type { SnapshotInputSelection, SelectedSnapshotTime } from "./types.js";

const RENDER_TIMEOUT_MS = 15_000;

interface TimeTravelInputArgs {
    report?: string;
    name?: string;
    browser?: string;
    attempt?: number;
    snapshotFile?: string;
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
        defaultTime: getReportDefaultTime(result),
    };
}

function getWindowSize(archive: TimeTravelArchive): { width: number; height: number } {
    return {
        width: Math.min(Math.max(Math.ceil(archive.metadata.width ?? 1280), 800), 1920),
        height: Math.min(Math.max(Math.ceil(archive.metadata.height ?? 720), 600), 1080),
    };
}

async function waitForRender(browser: WdioBrowser): Promise<void> {
    let renderError: string | undefined;

    await browser.waitUntil(
        async () => {
            const status = (await browser.execute(() => {
                const root = document.documentElement;

                return {
                    ready: root.dataset.timeTravelReady === "true",
                    error: root.dataset.timeTravelError,
                };
            })) as { ready: boolean; error?: string };

            renderError = status.error;

            return status.ready || Boolean(status.error);
        },
        {
            timeout: RENDER_TIMEOUT_MS,
            interval: 100,
            timeoutMsg: `Time travel snapshot renderer did not become ready within ${RENDER_TIMEOUT_MS}ms.`,
        },
    );

    if (renderError) {
        throw new Error(`Time travel snapshot renderer failed: ${renderError}`);
    }
}

export async function withRenderedTimeTravelFrame<T>(
    archive: TimeTravelArchive,
    selectedTime: SelectedSnapshotTime,
    cb: (browser: WdioBrowser) => Promise<T>,
): Promise<T> {
    let server: TimeTravelRenderServer | null = null;
    let browser: WdioBrowser | null = null;

    try {
        server = await startTimeTravelRenderServer(archive.events, selectedTime.offsetMs);
        browser = await launchBrowserWithOptions({
            headless: true,
            windowSize: getWindowSize(archive),
        });

        await browser.openAndWait(server.url, { ignoreNetworkErrorsPatterns: [/.*/], timeout: RENDER_TIMEOUT_MS });
        await waitForRender(browser);

        const iframe = await browser.$('iframe[data-time-travel-target="true"]');
        await iframe.waitForExist({ timeout: 5_000 });
        await browser.switchFrame(iframe);

        return await cb(browser);
    } finally {
        if (browser) {
            try {
                await browser.switchFrame(null);
            } catch {
                // The browser may already be closed or not inside a frame.
            }

            try {
                await browser.deleteSession();
            } catch (error) {
                console.error("Error closing time travel snapshot browser:", error);
            }
        }

        if (server) {
            try {
                await server.close();
            } catch (error) {
                console.error("Error closing time travel snapshot render server:", error);
            }
        }
    }
}
