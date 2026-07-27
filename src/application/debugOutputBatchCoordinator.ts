import type { DebugOutputLine } from "./debugSessionContracts";

export const MAX_DEBUG_OUTPUT_RETAINED_EVENTS = 5_000;
export const MAX_DEBUG_OUTPUT_RETAINED_BYTES = 5 * 1_024 * 1_024;
export const MAX_DEBUG_OUTPUT_RETAINED_LINES = 5_000;
export const MAX_PENDING_DEBUG_OUTPUT_EVENTS = 5_500;
export const MAX_PENDING_DEBUG_OUTPUT_BYTES = 5 * 1_024 * 1_024;
export const MAX_PENDING_DEBUG_OUTPUT_LINES = 5_500;
export const MAX_DEBUG_OUTPUT_EVENT_BYTES = 64 * 1_024;
export const MAX_DEBUG_OUTPUT_EVENT_LINES = 2_000;
export const MAX_DEBUG_OUTPUT_RETAINED_OWNERS = 4;
export const DEBUG_OUTPUT_BATCH_DELAY_MS = 16;
export const DEBUG_OUTPUT_OVERFLOW_MARKER =
  "[Earlier debugger output was omitted because the retained output limit was reached.]";

export interface DebugOutputOwner {
  readonly rootKey: string;
  readonly rootPath: string;
  readonly sessionId: number;
  readonly workspaceEpoch: number;
  readonly workspaceId: string | null;
}

export interface DebugOutputBatch {
  readonly lines: readonly DebugOutputLine[];
  readonly overflowed: boolean;
  readonly owner: DebugOutputOwner;
}

export interface DebugOutputBatchScheduler {
  cancel(handle: unknown): void;
  schedule(callback: () => void): unknown;
}

export interface DebugOutputBatchCoordinator {
  dispose(): void;
  enqueue(owner: DebugOutputOwner, line: DebugOutputLine): void;
  flushOwner(owner: DebugOutputOwner): void;
}

interface BufferedLine {
  readonly bytes: number;
  readonly line: DebugOutputLine;
  readonly lines: number;
}

interface PendingOwnerBatch {
  bytes: number;
  readonly items: BufferedLine[];
  lines: number;
  overflowed: boolean;
  readonly owner: DebugOutputOwner;
  start: number;
}

interface RetainedOwnerBuffer extends PendingOwnerBatch {
  touched: number;
}

interface CoordinatorOptions {
  readonly isOwnerCurrent: (owner: DebugOutputOwner) => boolean;
  readonly publish: (batches: readonly DebugOutputBatch[]) => void;
  readonly scheduler?: DebugOutputBatchScheduler;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");
const overflowMarkerLine: DebugOutputLine = Object.freeze({
  stream: "stderr",
  text: DEBUG_OUTPUT_OVERFLOW_MARKER,
  truncated: true,
});
const overflowMarkerBytes = textEncoder.encode(DEBUG_OUTPUT_OVERFLOW_MARKER).byteLength;

export function createDebugOutputBatchCoordinator({
  isOwnerCurrent,
  publish,
  scheduler = timeoutScheduler,
}: CoordinatorOptions): DebugOutputBatchCoordinator {
  const pending = new Map<string, PendingOwnerBatch>();
  const retained = new Map<string, RetainedOwnerBuffer>();
  let nextTouch = 1;
  let disposed = false;
  let scheduledHandle: unknown = null;

  const cancelScheduledFlush = () => {
    if (scheduledHandle === null) return;
    scheduler.cancel(scheduledHandle);
    scheduledHandle = null;
  };

  const publishPending = (selectedKey: string | null) => {
    if (disposed) return;
    const batches: DebugOutputBatch[] = [];
    for (const [key, batch] of pending) {
      if (selectedKey !== null && key !== selectedKey) continue;
      pending.delete(key);
      if (!isOwnerCurrent(batch.owner)) continue;
      const items = batch.items.slice(batch.start);
      if (items.length === 0 && !batch.overflowed) continue;
      const buffer = retained.get(key) ?? {
        bytes: 0,
        items: [],
        lines: 0,
        overflowed: false,
        owner: batch.owner,
        start: 0,
        touched: 0,
      };
      buffer.touched = nextTouch;
      nextTouch += 1;
      buffer.overflowed ||= batch.overflowed;
      for (const item of items) {
        buffer.items.push(item);
        buffer.bytes += item.bytes;
        buffer.lines += item.lines;
      }
      trimRetainedBuffer(buffer);
      retained.set(key, buffer);
      evictRetainedOwners(retained);
      batches.push({
        lines: retainedSnapshot(buffer),
        overflowed: buffer.overflowed,
        owner: batch.owner,
      });
    }
    if (batches.length > 0) publish(batches);
  };

  const flushAll = () => {
    scheduledHandle = null;
    publishPending(null);
  };

  const ensureScheduled = () => {
    if (scheduledHandle !== null) return;
    scheduledHandle = scheduler.schedule(flushAll);
  };

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelScheduledFlush();
      pending.clear();
      retained.clear();
    },

    enqueue(owner: DebugOutputOwner, line: DebugOutputLine): void {
      if (disposed || !isOwnerCurrent(owner)) return;
      discardReplacedRootOwners(retained, owner);
      const normalized = normalizeDebugOutputLine(line);
      if (normalized === null) return;
      const key = ownerKey(owner);
      let batch = pending.get(key);
      if (!batch) {
        batch = {
          bytes: 0,
          items: [],
          lines: 0,
          overflowed: false,
          owner,
          start: 0,
        };
        pending.set(key, batch);
      }
      batch.items.push(normalized);
      batch.bytes += normalized.bytes;
      batch.lines += normalized.lines;

      while (
        batch.items.length - batch.start > MAX_PENDING_DEBUG_OUTPUT_EVENTS ||
        batch.bytes > MAX_PENDING_DEBUG_OUTPUT_BYTES ||
        batch.lines > MAX_PENDING_DEBUG_OUTPUT_LINES
      ) {
        const removed = batch.items[batch.start];
        if (!removed) break;
        batch.start += 1;
        batch.bytes -= removed.bytes;
        batch.lines -= removed.lines;
        batch.overflowed = true;
      }
      if (batch.start >= 2_048 && batch.start * 2 >= batch.items.length) {
        batch.items.splice(0, batch.start);
        batch.start = 0;
      }
      ensureScheduled();
    },

    flushOwner(owner: DebugOutputOwner): void {
      if (disposed) return;
      publishPending(ownerKey(owner));
      if (pending.size === 0) cancelScheduledFlush();
    },
  };
}

function trimRetainedBuffer(buffer: RetainedOwnerBuffer): void {
  while (
    buffer.items.length - buffer.start + (buffer.overflowed ? 1 : 0) >
      MAX_DEBUG_OUTPUT_RETAINED_EVENTS ||
    buffer.bytes + (buffer.overflowed ? overflowMarkerBytes : 0) >
      MAX_DEBUG_OUTPUT_RETAINED_BYTES ||
    buffer.lines + (buffer.overflowed ? 1 : 0) > MAX_DEBUG_OUTPUT_RETAINED_LINES
  ) {
    const removed = buffer.items[buffer.start];
    if (!removed) break;
    buffer.start += 1;
    buffer.bytes -= removed.bytes;
    buffer.lines -= removed.lines;
    buffer.overflowed = true;
  }
  if (buffer.start >= 2_048 && buffer.start * 2 >= buffer.items.length) {
    buffer.items.splice(0, buffer.start);
    buffer.start = 0;
  }
}

function retainedSnapshot(buffer: RetainedOwnerBuffer): DebugOutputLine[] {
  const lines = buffer.items.slice(buffer.start).map(({ line }) => line);
  if (buffer.overflowed) lines.unshift(overflowMarkerLine);
  return lines;
}

function discardReplacedRootOwners(
  retained: Map<string, RetainedOwnerBuffer>,
  owner: DebugOutputOwner,
): void {
  for (const [key, candidate] of retained) {
    if (
      candidate.owner.rootKey === owner.rootKey &&
      (candidate.owner.workspaceEpoch !== owner.workspaceEpoch ||
        candidate.owner.workspaceId !== owner.workspaceId)
    ) {
      retained.delete(key);
    }
  }
}

function evictRetainedOwners(retained: Map<string, RetainedOwnerBuffer>): void {
  while (retained.size > MAX_DEBUG_OUTPUT_RETAINED_OWNERS) {
    let oldest: [string, RetainedOwnerBuffer] | null = null;
    for (const candidate of retained) {
      if (!oldest || candidate[1].touched < oldest[1].touched) oldest = candidate;
    }
    if (!oldest) return;
    retained.delete(oldest[0]);
  }
}

function normalizeDebugOutputLine(line: DebugOutputLine): BufferedLine | null {
  if (
    (line.stream !== "stdout" && line.stream !== "stderr") ||
    typeof line.text !== "string" ||
    line.text.length === 0 ||
    typeof line.truncated !== "boolean"
  ) {
    return null;
  }

  const lineBounded = retainLastLogicalLines(line.text, MAX_DEBUG_OUTPUT_EVENT_LINES);
  const byteBounded = retainLastUtf8Bytes(lineBounded.value, MAX_DEBUG_OUTPUT_EVENT_BYTES);
  const text = byteBounded.value;
  if (text.length === 0) return null;
  return {
    bytes: utf8ByteLength(text),
    line:
      text === line.text && !lineBounded.truncated && !byteBounded.truncated
        ? line
        : {
            stream: line.stream,
            text,
            truncated: true,
          },
    lines: logicalLineCount(text),
  };
}

function retainLastLogicalLines(
  value: string,
  maximumLines: number,
): { readonly truncated: boolean; readonly value: string } {
  let lines = logicalLineCount(value);
  if (lines <= maximumLines) return { truncated: false, value };
  let index = 0;
  while (lines > maximumLines) {
    const newline = value.indexOf("\n", index);
    if (newline < 0) break;
    index = newline + 1;
    lines -= 1;
  }
  return { truncated: index > 0, value: value.slice(index) };
}

function retainLastUtf8Bytes(
  value: string,
  maximumBytes: number,
): { readonly truncated: boolean; readonly value: string } {
  const encoded = textEncoder.encode(value);
  if (encoded.byteLength <= maximumBytes) return { truncated: false, value };
  let start = encoded.byteLength - maximumBytes;
  while (start < encoded.byteLength && (encoded[start]! & 0xc0) === 0x80) start += 1;
  return {
    truncated: true,
    value: textDecoder.decode(encoded.subarray(start)),
  };
}

function logicalLineCount(value: string): number {
  let count = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function ownerKey(owner: DebugOutputOwner): string {
  return JSON.stringify([
    owner.rootKey,
    owner.rootPath,
    owner.workspaceId,
    owner.workspaceEpoch,
    owner.sessionId,
  ]);
}

const timeoutScheduler: DebugOutputBatchScheduler = {
  cancel(handle): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  schedule(callback): unknown {
    return setTimeout(callback, DEBUG_OUTPUT_BATCH_DELAY_MS);
  },
};
