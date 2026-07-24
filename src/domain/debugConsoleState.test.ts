import { describe, expect, it, vi } from "vitest";
import {
  MAX_DEBUG_CONSOLE_BYTES,
  MAX_DEBUG_CONSOLE_ENTRIES,
  MAX_DEBUG_CONSOLE_HISTORY,
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
      { status: "ok", value: "1", evaluateName: "bad\npath" },
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
