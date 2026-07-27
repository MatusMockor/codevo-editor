import { describe, expect, it, vi } from "vitest";
import {
  MAX_DEBUG_CONSOLE_BYTES,
  MAX_DEBUG_CONSOLE_ENTRIES,
  MAX_DEBUG_CONSOLE_HISTORY,
  MAX_DEBUG_CONSOLE_OUTPUT_BATCH_ENTRIES,
  MAX_DEBUG_CONSOLE_OUTPUT_BYTES,
  createDebugConsoleState,
  deserializeDebugConsoleHistory,
  reduceDebugConsoleState,
  serializeDebugConsoleHistory,
} from "./debugConsoleState";

const owner = { sessionId: 7, pauseGeneration: 2 };

describe("debug console state", () => {
  it("captures only a bounded exact result owner and carries it to settlement", () => {
    const resultOwner = {
      epoch: 3,
      frameId: 11,
      pauseGeneration: owner.pauseGeneration,
      rootKey: "/workspace",
      sessionId: owner.sessionId,
      workspaceOwnerKey: "workspace-owner",
    };
    let state = createDebugConsoleState(owner);
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId: "owned-result",
      expression: "value",
      resultOwner,
    });
    state = reduceDebugConsoleState(state, {
      type: "evaluation-settled",
      owner,
      requestId: "owned-result",
      result: { status: "ok", value: "captured" },
    });
    expect(state.entries.find((entry) => entry.kind === "result")?.resultOwner).toEqual(
      resultOwner,
    );

    let malformed = createDebugConsoleState(owner);
    malformed = reduceDebugConsoleState(malformed, {
      type: "evaluation-pending",
      owner,
      requestId: "malformed-owner",
      expression: "value",
      resultOwner: { ...resultOwner, rootKey: "bad\nroot" },
    });
    malformed = reduceDebugConsoleState(malformed, {
      type: "evaluation-settled",
      owner,
      requestId: "malformed-owner",
      result: { status: "ok", value: "captured" },
    });
    expect(malformed.entries.find((entry) => entry.kind === "result")?.resultOwner).toBeUndefined();
  });

  it("keeps output and evaluation lifecycle entries in chronological order", () => {
    let state = createDebugConsoleState(owner);
    state = reduceDebugConsoleState(state, {
      type: "output",
      owner,
      stream: "stdout",
      text: "ready\n",
    });
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId: "request-1",
      expression: "count",
    });
    state = reduceDebugConsoleState(state, {
      type: "output",
      owner,
      stream: "stderr",
      text: "warning\n",
    });
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId: "request-2",
      expression: "broken()",
    });
    state = reduceDebugConsoleState(state, {
      type: "evaluation-settled",
      owner,
      requestId: "request-1",
      result: { status: "ok", value: "3", type: "number", variablesReference: 0 },
    });
    state = reduceDebugConsoleState(state, {
      type: "evaluation-settled",
      owner,
      requestId: "request-2",
      result: { status: "error", kind: "exception", message: "boom" },
    });
    expect(state.entries.map(({ kind }) => kind)).toEqual([
      "stdout",
      "pending",
      "stderr",
      "pending",
      "result",
      "error",
    ]);
    expect(state.entries.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(state.history).toEqual(["count", "broken()"]);
  });

  it("appends a bounded output burst in one chronological batch", () => {
    let state = createDebugConsoleState(owner);
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId: "pending",
      expression: "slow()",
    });
    state = reduceDebugConsoleState(state, {
      type: "output-batch",
      owner,
      lines: Array.from({ length: 5_000 }, (_, index) => ({
        stream: index % 2 === 0 ? ("stdout" as const) : ("stderr" as const),
        text: `line-${index}`,
        truncated: false,
      })),
    });

    expect(state.entries).toHaveLength(MAX_DEBUG_CONSOLE_ENTRIES);
    expect(state.entries[0]).toMatchObject({
      kind: "truncated",
      omittedEntries: 4_002,
    });
    expect(state.entries.filter(({ kind }) => kind === "truncated")).toHaveLength(1);
    expect(state.entries[state.entries.length - 2]).toMatchObject({
      kind: "stdout",
      text: "line-4998",
    });
    expect(state.entries[state.entries.length - 1]).toMatchObject({
      kind: "stderr",
      text: "line-4999",
    });
    expect(state.nextSequence).toBe(5_002);
    expect(state.pendingRequestIds).toEqual([]);
    expect(state.totalBytes).toBeLessThanOrEqual(MAX_DEBUG_CONSOLE_BYTES);
  });

  it("keeps batch truncation UTF-8-safe and rejects stale or malformed lines", () => {
    const state = createDebugConsoleState(owner);
    const stale = reduceDebugConsoleState(state, {
      type: "output-batch",
      owner: { ...owner, pauseGeneration: owner.pauseGeneration + 1 },
      lines: [{ stream: "stdout", text: "stale", truncated: false }],
    });
    expect(stale).toBe(state);

    const malformed = reduceDebugConsoleState(state, {
      type: "output-batch",
      owner,
      lines: [
        { stream: "stdout", text: "", truncated: false },
        {
          stream: "stdout",
          text: "ž".repeat(MAX_DEBUG_CONSOLE_OUTPUT_BYTES / 2 + 1),
          truncated: false,
        },
        { stream: "stderr", text: "tail", truncated: false },
      ],
    });

    expect(malformed.entries).toHaveLength(3);
    expect(malformed.entries[0]).toMatchObject({
      kind: "truncated",
      omittedBytes: 2,
    });
    expect(malformed.entries[1]).toMatchObject({ kind: "stdout" });
    expect(
      new TextEncoder().encode(
        malformed.entries[1]?.kind === "stdout" ? malformed.entries[1].text : "",
      ),
    ).toHaveLength(MAX_DEBUG_CONSOLE_OUTPUT_BYTES);
    expect(malformed.entries[2]).toMatchObject({ kind: "stderr", text: "tail" });
    expect(malformed.nextSequence).toBe(3);

    const oversizedBatch = reduceDebugConsoleState(state, {
      type: "output-batch",
      owner,
      lines: Array.from({ length: MAX_DEBUG_CONSOLE_OUTPUT_BATCH_ENTRIES + 1 }, () => ({
        stream: "stdout",
        text: "over limit",
        truncated: false,
      })),
    });
    expect(oversizedBatch).toBe(state);

    const byteBounded = reduceDebugConsoleState(state, {
      type: "output-batch",
      owner,
      lines: Array.from({ length: 90 }, () => ({
        stream: "stdout",
        text: "x".repeat(MAX_DEBUG_CONSOLE_OUTPUT_BYTES),
        truncated: false,
      })),
    });
    expect(byteBounded.totalBytes).toBeLessThanOrEqual(MAX_DEBUG_CONSOLE_BYTES);
    expect(byteBounded.entries[0]).toMatchObject({
      kind: "truncated",
      omittedEntries: 11,
    });
    expect(byteBounded.entries).toHaveLength(80);
  });

  it("preserves truthful upstream truncation metadata without inventing byte precision", () => {
    const state = reduceDebugConsoleState(createDebugConsoleState(owner), {
      type: "output-batch",
      owner,
      lines: [
        {
          stream: "stdout",
          text: "partial\n[Debugger output truncated]",
          truncated: true,
        },
      ],
    });

    expect(state.entries).toEqual([
      expect.objectContaining({
        kind: "stdout",
        text: "partial\n[Debugger output truncated]",
        truncated: true,
      }),
    ]);
    expect(state.entries[0]).not.toHaveProperty("omittedBytes");
  });

  it("drops stale session and pause-generation actions by identity", () => {
    const state = createDebugConsoleState(owner);
    const staleSession = reduceDebugConsoleState(state, {
      type: "output",
      owner: { ...owner, sessionId: 8 },
      stream: "stdout",
      text: "stale",
    });
    const stalePause = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner: { ...owner, pauseGeneration: 3 },
      requestId: "request",
      expression: "count",
    });
    expect(staleSession).toBe(state);
    expect(stalePause).toBe(state);
  });

  it("preserves the session snapshot across pause and termination ownership changes", () => {
    let state = createDebugConsoleState(owner);
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId: "request",
      expression: "count",
    });
    state = reduceDebugConsoleState(state, {
      type: "own",
      owner: { ...owner, pauseGeneration: 3 },
    });
    expect(state.entries).toHaveLength(1);
    expect(state.history).toEqual(["count"]);
    expect(state.pendingRequestIds).toEqual([]);
    state = reduceDebugConsoleState(state, {
      type: "own",
      owner: { sessionId: 8, pauseGeneration: 1 },
    });
    expect(state.history).toEqual(["count"]);
    expect(state.entries).toEqual([]);
  });

  it("settles only requests pending for the exact active owner", () => {
    let state = createDebugConsoleState(owner);
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId: "owned",
      expression: "count",
    });
    const unknown = reduceDebugConsoleState(state, {
      type: "evaluation-settled",
      owner,
      requestId: "unknown",
      result: { status: "ok", value: "1" },
    });
    expect(unknown).toBe(state);
    const nextPause = reduceDebugConsoleState(state, {
      type: "own",
      owner: { ...owner, pauseGeneration: owner.pauseGeneration + 1 },
    });
    expect(
      reduceDebugConsoleState(nextPause, {
        type: "evaluation-settled",
        owner,
        requestId: "owned",
        result: { status: "ok", value: "stale" },
      }),
    ).toBe(nextPause);
  });

  it("cancels only the exact owner and request without reordering unrelated entries", () => {
    let state = createDebugConsoleState(owner);
    state = reduceDebugConsoleState(state, {
      type: "output",
      owner,
      stream: "stdout",
      text: "before",
    });
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId: "cancel-me",
      expression: "count",
    });
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId: "keep-me",
      expression: "total",
    });
    const stale = reduceDebugConsoleState(state, {
      type: "cancel-evaluation",
      owner: { ...owner, pauseGeneration: owner.pauseGeneration + 1 },
      requestId: "cancel-me",
    });
    expect(stale).toBe(state);

    const cancelled = reduceDebugConsoleState(state, {
      type: "cancel-evaluation",
      owner,
      requestId: "cancel-me",
    });
    expect(cancelled.entries.map(({ id }) => id)).toEqual(["console-1", "console-3"]);
    expect(cancelled.pendingRequestIds).toEqual(["keep-me"]);
    expect(cancelled.history).toEqual(["count", "total"]);
    expect(
      reduceDebugConsoleState(cancelled, {
        type: "cancel-evaluation",
        owner,
        requestId: "cancel-me",
      }),
    ).toBe(cancelled);
  });

  it("does not restore pending ids evicted while appending a settlement", () => {
    let state = createDebugConsoleState(owner);
    for (let index = 0; index < MAX_DEBUG_CONSOLE_ENTRIES; index += 1) {
      state = reduceDebugConsoleState(state, {
        type: "evaluation-pending",
        owner,
        requestId: `request-${index}`,
        expression: `value${index}`,
      });
    }
    state = reduceDebugConsoleState(state, {
      type: "evaluation-settled",
      owner,
      requestId: `request-${MAX_DEBUG_CONSOLE_ENTRIES - 1}`,
      result: { status: "ok", value: "done" },
    });
    expect(state.pendingRequestIds).not.toContain("request-0");
    expect(state.pendingRequestIds).not.toContain("request-1");
    expect(state.pendingRequestIds).not.toContain(`request-${MAX_DEBUG_CONSOLE_ENTRIES - 1}`);

    const late = reduceDebugConsoleState(state, {
      type: "evaluation-settled",
      owner,
      requestId: "request-0",
      result: { status: "ok", value: "late" },
    });
    expect(late).toBe(state);
  });

  it("fails closed for malformed evaluation results without throwing", () => {
    let state = createDebugConsoleState(owner);
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId: "request",
      expression: "count",
    });
    const malformedResults: readonly unknown[] = [
      null,
      { status: "success", value: "1" },
      { status: "ok", value: "1", extra: true },
      { status: "error", kind: "exception", message: "boom", extra: true },
      { status: "ok", value: "x".repeat(64 * 1_024 + 1) },
      { status: "ok", value: "1", evaluateName: "" },
      { status: "ok", value: "1", evaluateName: "bad\rpath" },
      { status: "ok", value: "1", evaluateName: "x".repeat(4 * 1_024 + 1) },
    ];
    for (const result of malformedResults) {
      const malformedAction = {
        type: "evaluation-settled",
        owner,
        requestId: "request",
        result,
      } as Parameters<typeof reduceDebugConsoleState>[1];
      expect(() => reduceDebugConsoleState(state, malformedAction)).not.toThrow();
      expect(reduceDebugConsoleState(state, malformedAction)).toBe(state);
    }
  });

  it("accepts a bounded evaluate name without changing console presentation", () => {
    let state = createDebugConsoleState(owner);
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId: "request",
      expression: "user",
    });
    state = reduceDebugConsoleState(state, {
      type: "evaluation-settled",
      owner,
      requestId: "request",
      result: {
        status: "ok",
        value: "User",
        type: "object",
        evaluateName: 'root["user"]',
        variablesReference: 9,
      },
    });
    expect(state.entries[state.entries.length - 1]).toMatchObject({
      kind: "result",
      evaluateName: 'root["user"]',
      value: "User",
      valueType: "object",
      variablesReference: 9,
    });
  });

  it("preserves an exact bounded multiline adapter evaluate name", () => {
    let state = createDebugConsoleState(owner);
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId: "request",
      expression: "(\n  root\n)",
    });
    const evaluateName = "(\n  root\n).nested";
    state = reduceDebugConsoleState(state, {
      type: "evaluation-settled",
      owner,
      requestId: "request",
      result: { status: "ok", value: "Object", evaluateName, variablesReference: 9 },
    });
    expect(state.entries[state.entries.length - 1]).toMatchObject({
      kind: "result",
      evaluateName,
    });
  });

  it("bounds history and deduplicates only consecutive evaluations", () => {
    let state = createDebugConsoleState(owner);
    for (let index = 0; index <= MAX_DEBUG_CONSOLE_HISTORY; index += 1) {
      state = reduceDebugConsoleState(state, {
        type: "evaluation-pending",
        owner,
        requestId: `request-${index}`,
        expression: `value${index}`,
      });
    }
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId: "request-last",
      expression: "value50",
    });
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId: "request-consecutive",
      expression: "value50",
    });
    expect(state.history).toHaveLength(MAX_DEBUG_CONSOLE_HISTORY);
    expect(state.history[state.history.length - 1]).toBe("value50");
    expect(state.history.filter((expression) => expression === "value50")).toHaveLength(2);
  });

  it("preserves evaluation history when the debug session changes", () => {
    let state = createDebugConsoleState(owner);
    state = reduceDebugConsoleState(state, {
      type: "evaluation-pending",
      owner,
      requestId: "request",
      expression: "count",
    });

    state = reduceDebugConsoleState(state, {
      type: "own",
      owner: { sessionId: 8, pauseGeneration: 1 },
    });

    expect(state.history).toEqual(["count"]);
  });

  it("round-trips bounded history with consecutive-only deduplication", () => {
    const history = Array.from(
      { length: MAX_DEBUG_CONSOLE_HISTORY + 2 },
      (_, index) => `value${index}`,
    );
    const serialized = serializeDebugConsoleHistory([...history, "repeat", "repeat", "value50"]);

    const restored = deserializeDebugConsoleHistory(serialized);

    expect(restored).toHaveLength(MAX_DEBUG_CONSOLE_HISTORY);
    expect(restored.slice(-3)).toEqual(["value101", "repeat", "value50"]);
    expect(restored.filter((expression) => expression === "value50")).toHaveLength(2);
  });

  it.each(["not-json", '{"history":[]}', '["valid", 3]', `["${"x".repeat(4_097)}"]`])(
    "fails closed for malformed persisted history %s",
    (raw) => {
      expect(deserializeDebugConsoleHistory(raw)).toEqual([]);
    },
  );

  it("rejects oversized persisted history before parsing", () => {
    const parse = vi.spyOn(JSON, "parse");

    expect(deserializeDebugConsoleHistory("x".repeat(2_500_000))).toEqual([]);
    expect(parse).not.toHaveBeenCalled();

    parse.mockRestore();
  });

  it("rejects persisted history with more than the authoritative entry limit", () => {
    const raw = JSON.stringify(
      Array.from({ length: MAX_DEBUG_CONSOLE_HISTORY + 1 }, (_, index) => `value${index}`),
    );

    expect(deserializeDebugConsoleHistory(raw)).toEqual([]);
  });

  it("caps entry count and emits one accumulated truncation marker", () => {
    let state = createDebugConsoleState(owner);
    for (let index = 0; index <= MAX_DEBUG_CONSOLE_ENTRIES; index += 1) {
      state = reduceDebugConsoleState(state, {
        type: "output",
        owner,
        stream: "stdout",
        text: `${index}`,
      });
    }
    expect(state.entries).toHaveLength(MAX_DEBUG_CONSOLE_ENTRIES);
    expect(state.entries[0]).toMatchObject({ kind: "truncated", omittedEntries: 2 });
    expect(state.entries.filter(({ kind }) => kind === "truncated")).toHaveLength(1);
  });

  it("uses UTF-8 bytes for per-entry and aggregate limits", () => {
    let state = createDebugConsoleState(owner);
    const oversized = "ž".repeat(MAX_DEBUG_CONSOLE_OUTPUT_BYTES / 2 + 1);
    state = reduceDebugConsoleState(state, {
      type: "output",
      owner,
      stream: "stdout",
      text: oversized,
    });
    expect(state.entries[0]?.kind).toBe("truncated");
    expect(state.totalBytes).toBeLessThanOrEqual(MAX_DEBUG_CONSOLE_BYTES);

    for (let index = 0; index < 90; index += 1) {
      state = reduceDebugConsoleState(state, {
        type: "output",
        owner,
        stream: "stderr",
        text: "x".repeat(MAX_DEBUG_CONSOLE_OUTPUT_BYTES),
      });
    }
    expect(state.totalBytes).toBeLessThanOrEqual(MAX_DEBUG_CONSOLE_BYTES);
    expect(state.entries[0]).toMatchObject({ kind: "truncated" });
  });

  it("rejects malformed requests and clears only for the current owner", () => {
    const state = createDebugConsoleState(owner);
    expect(
      reduceDebugConsoleState(state, {
        type: "evaluation-pending",
        owner,
        requestId: "bad\nrequest",
        expression: "count",
      }),
    ).toBe(state);
    const populated = reduceDebugConsoleState(state, {
      type: "output",
      owner,
      stream: "stdout",
      text: "ok",
    });
    expect(
      reduceDebugConsoleState(populated, {
        type: "clear",
        owner: { ...owner, pauseGeneration: 99 },
      }),
    ).toBe(populated);
    expect(reduceDebugConsoleState(populated, { type: "clear", owner }).entries).toEqual([]);
  });
});
