import type { ReporterTestResult } from "html-reporter/experimental/sdk";
import type { ReporterTestStep } from "./types.js";

export interface ReportDefaultTime {
    absoluteTime: number;
    reason: string;
}

function findFirstFailedStep(steps: readonly ReporterTestStep[] | undefined): ReporterTestStep | null {
    for (const step of steps ?? []) {
        if (step.f) {
            return step;
        }

        const childFailedStep = findFirstFailedStep(step.c);
        if (childFailedStep) {
            return childFailedStep;
        }
    }

    return null;
}

export function getReportDefaultTime(result: ReporterTestResult): ReportDefaultTime | undefined {
    const failedStep = findFirstFailedStep(result.history);
    if (failedStep) {
        return {
            absoluteTime: failedStep.ts + failedStep.d,
            reason: `default failed step "${failedStep.n}" end`,
        };
    }

    if (result.status === "fail" || result.status === "error") {
        return {
            absoluteTime: result.timestamp + result.duration,
            reason: `default ${result.status} result end`,
        };
    }

    return undefined;
}
