import { describe, expect, it, vi } from "vitest";
import {
  DEBUG_OUTPUT_OVERFLOW_MARKER,
  MAX_DEBUG_OUTPUT_RETAINED_BYTES,
  MAX_DEBUG_OUTPUT_RETAINED_EVENTS,
  MAX_DEBUG_OUTPUT_RETAINED_LINES,
  createDebugOutputBatchCoordinator,
  type DebugOutputBatch,
  type DebugOutputBatchScheduler,
  type DebugOutputOwner,
} from "./debugOutputBatchCoordinator";
import type { DebugOutputLine } from "./debugSessionContracts";

const owner: DebugOutputOwner = {
  rootKey: "/workspace",
  rootPath: "/workspace",
  sessionId: 7,
  workspaceEpoch: 1,
  workspaceId: "workspace-a",
};

describe("debug output batch coordinator", () => {
  it("coalesces 50k ordered stdout/stderr events into one publish", () => {
    const scheduler = manualScheduler();
    const publish = vi.fn<(batches: readonly DebugOutputBatch[]) => void>();
    const coordinator = createDebugOutputBatchCoordinator({
      isOwnerCurrent: (candidate) => ownersEqual(candidate, owner),
      publish,
      scheduler,
    });

    for (let index = 0; index < 50_000; index += 1) {
      coordinator.enqueue(owner, {
        stream: index % 2 === 0 ? "stdout" : "stderr",
        text: `line-${index}`,
        truncated: false,
      });
    }

    expect(publish).not.toHaveBeenCalled();
    expect(scheduler.pending()).toBe(1);
    scheduler.flush();
    expect(publish).toHaveBeenCalledTimes(1);

    const batch = publish.mock.calls[0]?.[0]?.[0];
    expect(batch?.overflowed).toBe(true);
    const output = [...batch!.lines];
    expect(output).toHaveLength(MAX_DEBUG_OUTPUT_RETAINED_EVENTS);
    expect(output[0]).toEqual({
      stream: "stderr",
      text: DEBUG_OUTPUT_OVERFLOW_MARKER,
      truncated: true,
    });
    expect(output.filter(({ text }) => text === DEBUG_OUTPUT_OVERFLOW_MARKER)).toHaveLength(1);
    expect(output[1]).toMatchObject({ stream: "stderr", text: "line-45001" });
    expect(output[output.length - 2]).toMatchObject({ stream: "stdout", text: "line-49998" });
    expect(output[output.length - 1]).toMatchObject({ stream: "stderr", text: "line-49999" });
    coordinator.dispose();
  });

  it("flushes an exact owner's queued output before termination invalidates its lease", () => {
    const scheduler = manualScheduler();
    let currentOwner: DebugOutputOwner | null = owner;
    const publish = vi.fn<(batches: readonly DebugOutputBatch[]) => void>();
    const coordinator = createDebugOutputBatchCoordinator({
      isOwnerCurrent: (candidate) => currentOwner !== null && ownersEqual(candidate, currentOwner),
      publish,
      scheduler,
    });

    coordinator.enqueue(owner, { stream: "stdout", text: "last output", truncated: false });
    coordinator.flushOwner(owner);
    currentOwner = null;
    scheduler.flush();

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]?.[0]?.lines).toEqual([
      { stream: "stdout", text: "last output", truncated: false },
    ]);
    coordinator.dispose();
  });

  it("rejects stale A-B-A epochs at enqueue and again at delayed flush", () => {
    const scheduler = manualScheduler();
    let currentOwner = owner;
    const publish = vi.fn<(batches: readonly DebugOutputBatch[]) => void>();
    const coordinator = createDebugOutputBatchCoordinator({
      isOwnerCurrent: (candidate) => ownersEqual(candidate, currentOwner),
      publish,
      scheduler,
    });
    const staleOwner = { ...owner, workspaceEpoch: 0 };

    coordinator.enqueue(staleOwner, { stream: "stdout", text: "already stale", truncated: false });
    coordinator.enqueue(owner, { stream: "stdout", text: "becomes stale", truncated: false });
    currentOwner = { ...owner, workspaceEpoch: 2 };
    scheduler.flush();
    currentOwner = owner;

    expect(publish).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it("bounds aggregate UTF-8 bytes, logical lines, and events with one marker", () => {
    const scheduler = manualScheduler();
    let output: readonly DebugOutputLine[] = [];
    const coordinator = createDebugOutputBatchCoordinator({
      isOwnerCurrent: (candidate) => ownersEqual(candidate, owner),
      publish: (batches) => {
        output = batches[0]?.lines ?? [];
      },
      scheduler,
    });
    const huge = `${"🙂".repeat(20_000)}${"\nrow".repeat(3_000)}`;
    coordinator.enqueue(owner, { stream: "stdout", text: huge, truncated: false });
    for (let index = 0; index < 6_000; index += 1) {
      coordinator.enqueue(owner, {
        stream: "stdout",
        text: `tail-${index}`,
        truncated: false,
      });
    }
    scheduler.flush();
    const bytes = output.reduce(
      (total, line) => total + new TextEncoder().encode(line.text).byteLength,
      0,
    );
    const lines = output.reduce((total, line) => total + logicalLineCount(line.text), 0);

    expect(output.length).toBeLessThanOrEqual(MAX_DEBUG_OUTPUT_RETAINED_EVENTS);
    expect(bytes).toBeLessThanOrEqual(MAX_DEBUG_OUTPUT_RETAINED_BYTES);
    expect(lines).toBeLessThanOrEqual(MAX_DEBUG_OUTPUT_RETAINED_LINES);
    expect(output.filter(({ text }) => text === DEBUG_OUTPUT_OVERFLOW_MARKER)).toHaveLength(1);
    expect(output[output.length - 1]?.text).toBe("tail-5999");
    expect(output.every(({ text }) => !text.includes("�"))).toBe(true);
    coordinator.dispose();
  });

  it("preserves retained line identities so downstream console projection sees only new output", () => {
    const scheduler = manualScheduler();
    const snapshots: (readonly DebugOutputLine[])[] = [];
    const coordinator = createDebugOutputBatchCoordinator({
      isOwnerCurrent: (candidate) => ownersEqual(candidate, owner),
      publish: (batches) => {
        const output = batches[0]?.lines;
        if (output) snapshots.push(output);
      },
      scheduler,
    });
    const first = { stream: "stdout" as const, text: "first", truncated: false };
    const second = { stream: "stderr" as const, text: "second", truncated: false };
    const third = { stream: "stdout" as const, text: "third", truncated: false };

    coordinator.enqueue(owner, first);
    coordinator.enqueue(owner, second);
    scheduler.flush();
    coordinator.enqueue(owner, third);
    scheduler.flush();
    const twice = snapshots[1]!;

    expect(twice[0]).toBe(first);
    expect(twice[1]).toBe(second);
    expect(twice[2]).toBe(third);
    coordinator.dispose();
  });

  it("does not re-encode the full retained buffer during steady-state flushes", () => {
    const scheduler = manualScheduler();
    const snapshots: (readonly DebugOutputLine[])[] = [];
    const coordinator = createDebugOutputBatchCoordinator({
      isOwnerCurrent: (candidate) => ownersEqual(candidate, owner),
      publish: (batches) => {
        const output = batches[0]?.lines;
        if (output) snapshots.push(output);
      },
      scheduler,
    });
    for (let index = 0; index < MAX_DEBUG_OUTPUT_RETAINED_EVENTS; index += 1) {
      coordinator.enqueue(owner, {
        stream: "stdout",
        text: `initial-${index}`,
        truncated: false,
      });
    }
    scheduler.flush();
    const retainedLine = snapshots[0]?.[100];
    const encode = vi.spyOn(TextEncoder.prototype, "encode");

    for (let index = 0; index < 60; index += 1) {
      coordinator.enqueue(owner, {
        stream: "stderr",
        text: `steady-${index}`,
        truncated: false,
      });
      scheduler.flush();
    }

    expect(encode).toHaveBeenCalledTimes(120);
    expect(snapshots).toHaveLength(61);
    expect(snapshots[1]?.filter(({ text }) => text === DEBUG_OUTPUT_OVERFLOW_MARKER)).toHaveLength(
      1,
    );
    expect(snapshots[60]?.[snapshots[60]!.length - 1]?.text).toBe("steady-59");
    expect(retainedLine).toBeDefined();
    expect(snapshots[1]?.includes(retainedLine!)).toBe(true);
    encode.mockRestore();
    coordinator.dispose();
  });
});

function manualScheduler(): DebugOutputBatchScheduler & {
  flush(): void;
  pending(): number;
} {
  const callbacks = new Set<() => void>();
  return {
    cancel(handle): void {
      callbacks.delete(handle as () => void);
    },
    flush(): void {
      for (const callback of [...callbacks]) {
        callbacks.delete(callback);
        callback();
      }
    },
    pending(): number {
      return callbacks.size;
    },
    schedule(callback): unknown {
      callbacks.add(callback);
      return callback;
    },
  };
}

function ownersEqual(left: DebugOutputOwner, right: DebugOutputOwner): boolean {
  return (
    left.rootKey === right.rootKey &&
    left.rootPath === right.rootPath &&
    left.sessionId === right.sessionId &&
    left.workspaceEpoch === right.workspaceEpoch &&
    left.workspaceId === right.workspaceId
  );
}

function logicalLineCount(value: string): number {
  return value.split("\n").length;
}
