import type { ReporterTestResult } from "html-reporter/experimental/sdk";

export type ReporterTestStep = NonNullable<ReporterTestResult["history"]>[number];

export interface SelectedSnapshotTime {
    absoluteTime: number;
    offsetMs: number;
    reason: string;
    requestedTime?: number;
    requestedKind?: "offset" | "timestamp" | "default";
    unclampedTime?: number;
    wasClamped: boolean;
}
