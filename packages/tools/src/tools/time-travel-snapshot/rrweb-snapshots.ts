import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { type eventWithTime as RrwebEvent, IncrementalSource } from "@rrweb/types";
import { SelectedSnapshotTime } from "./types.js";

export type NumberedRrwebEvent = RrwebEvent & { seqNo: number };

export interface TimeTravelArchive {
    source: string;
    events: NumberedRrwebEvent[];
    metadata: RrwebSnapshotMetadata;
}

export interface RrwebSnapshotMetadata {
    startTime: number;
    endTime: number;
    totalTime: number;
    width?: number;
    height?: number;
}

export interface ResolveTargetTimeOptions {
    time?: number;
    defaultAbsoluteTime?: number;
    defaultReason?: string;
}

export interface TimeTravelViewportSize {
    width: number;
    height: number;
    source: "meta" | "resize";
    timestamp: number;
    offsetMs: number;
}

const SNAPSHOTS_FILE_NAME = "snapshots.json";
const RRWEB_INCREMENTAL_SNAPSHOT_EVENT = 3;
const RRWEB_META_EVENT = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRemoteSource(source: string): boolean {
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

async function readTimeTravelZip(source: string): Promise<Uint8Array> {
    if (isRemoteSource(source)) {
        const response = await fetch(source);
        if (!response.ok) {
            throw new Error(`Failed to fetch snapshot archive "${source}": ${response.status} ${response.statusText}`);
        }

        return new Uint8Array(await response.arrayBuffer());
    }

    return new Uint8Array(await readFile(sourceToLocalPath(source)));
}

function getViewportSizeData(data: unknown): Pick<TimeTravelViewportSize, "width" | "height"> | null {
    if (!isRecord(data) || typeof data.width !== "number" || typeof data.height !== "number") {
        return null;
    }

    return {
        width: data.width,
        height: data.height,
    };
}

function getViewportMetadata(events: readonly NumberedRrwebEvent[]): Pick<RrwebSnapshotMetadata, "width" | "height"> {
    const metaEvent = events.find(event => event.type === RRWEB_META_EVENT);
    const size = getViewportSizeData(metaEvent?.data);
    const width = size?.width;
    const height = size?.height;

    return { width, height };
}

export function resolveViewportSizeAt(
    archive: TimeTravelArchive,
    selectedTime: SelectedSnapshotTime,
): TimeTravelViewportSize | null {
    let viewport: TimeTravelViewportSize | null = null;

    for (const event of archive.events) {
        if (event.type === RRWEB_META_EVENT && viewport === null) {
            const size = getViewportSizeData(event.data);
            if (size) {
                viewport = {
                    ...size,
                    source: "meta",
                    timestamp: event.timestamp,
                    offsetMs: event.timestamp - archive.metadata.startTime,
                };
            }
            continue;
        }

        if (event.timestamp > selectedTime.absoluteTime || event.type !== RRWEB_INCREMENTAL_SNAPSHOT_EVENT) {
            continue;
        }

        const data = isRecord(event.data) ? event.data : undefined;
        if (data?.source !== IncrementalSource.ViewportResize) {
            continue;
        }

        const size = getViewportSizeData(data);
        if (size) {
            viewport = {
                ...size,
                source: "resize",
                timestamp: event.timestamp,
                offsetMs: event.timestamp - archive.metadata.startTime,
            };
        }
    }

    return viewport;
}

export async function loadTimeTravelArchive(source: string): Promise<TimeTravelArchive> {
    const zipData = await readTimeTravelZip(source);
    const files = unzipSync(zipData);
    const snapshotsFile = files[SNAPSHOTS_FILE_NAME];
    if (!snapshotsFile) {
        throw new Error(`Couldn't find ${SNAPSHOTS_FILE_NAME} in "${source}".`);
    }

    const jsonl = new TextDecoder("utf-8").decode(snapshotsFile);
    const events = jsonl.split("\n").map(line => JSON.parse(line) as NumberedRrwebEvent);

    if (events.length < 2) {
        throw new Error(`Snapshot archive "${source}" is empty (contains less than 2 events).`);
    }

    const startTime = events[0].timestamp;
    const endTime = events[events.length - 1].timestamp;

    return {
        source,
        events,
        metadata: {
            startTime,
            endTime,
            totalTime: endTime - startTime,
            ...getViewportMetadata(events),
        },
    };
}

function clampTime(time: number, metadata: RrwebSnapshotMetadata): number {
    return Math.min(Math.max(time, metadata.startTime), metadata.endTime);
}

export function resolveTargetTime(
    metadata: RrwebSnapshotMetadata,
    { time, defaultAbsoluteTime, defaultReason }: ResolveTargetTimeOptions,
): SelectedSnapshotTime {
    let requestedKind: SelectedSnapshotTime["requestedKind"];
    let requestedTime: number | undefined;
    let unclampedTime: number;
    let reason: string;

    if (time !== undefined) {
        requestedTime = time;
        if (time <= metadata.totalTime) {
            requestedKind = "offset";
            unclampedTime = metadata.startTime + time;
            reason = `provided offset ${time}ms from first rrweb event`;
        } else {
            requestedKind = "timestamp";
            unclampedTime = time;
            reason = `provided absolute timestamp ${time}`;
        }
    } else if (defaultAbsoluteTime !== undefined) {
        requestedKind = "default";
        unclampedTime = defaultAbsoluteTime;
        reason = defaultReason ?? "default time";
    } else {
        requestedKind = "default";
        unclampedTime = metadata.endTime;
        reason = "default snapshot end";
    }

    const absoluteTime = clampTime(unclampedTime, metadata);
    const wasClamped = absoluteTime !== unclampedTime;

    return {
        absoluteTime,
        offsetMs: absoluteTime - metadata.startTime,
        reason: wasClamped ? `${reason}; clamped to available snapshot range` : reason,
        requestedTime,
        requestedKind,
        unclampedTime,
        wasClamped,
    };
}
