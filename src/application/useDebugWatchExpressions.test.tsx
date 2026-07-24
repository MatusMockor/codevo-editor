// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugEvaluationResult } from "../domain/debugEvaluationPolicy";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { DebugWatchStorage } from "../domain/debugWatchPersistence";
import { MAX_DEBUG_WATCH_EXPRESSIONS } from "../domain/debugWatchExpressions";
import {
  useDebugWatchExpressions,
  type UseDebugWatchExpressionsOptions,
  type UseDebugWatchExpressionsResult,
} from "./useDebugWatchExpressions";

const stopped: DebuggerSessionSnapshot = {
  lastSeq: 2,
  state: {
    kind: "stopped",
    sessionId: 4,
    reason: "breakpoint",
    frames: [
      { frameId: 11, name: "main", filePath: "/workspace/app.ts", lineNumber: 1, column: 1 },
    ],
    topFrame: {
      frameId: 11,
      name: "main",
      filePath: "/workspace/app.ts",
      lineNumber: 1,
      column: 1,
    },
  },
};

class MemoryStorage implements DebugWatchStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

type HookOptions = Omit<UseDebugWatchExpressionsOptions, "inspectionOwner"> & {
  inspectionOwner?: UseDebugWatchExpressionsOptions["inspectionOwner"];
  pauseGeneration?: number;
};

function renderHook(options: HookOptions) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: UseDebugWatchExpressionsResult | null } = { value: null };
  const deriveOwner = (candidate: HookOptions) =>
    candidate.inspectionOwner !== undefined
      ? candidate.inspectionOwner
      : candidate.snapshot.state.kind === "stopped"
        ? {
            rootKey: candidate.workspaceRoot ?? "",
            sessionId: candidate.snapshot.state.sessionId,
            pauseGeneration: candidate.pauseGeneration ?? 2,
            frameId: candidate.selectedFrameId ?? candidate.snapshot.state.topFrame?.frameId ?? 0,
          }
        : null;
  let sourceOptions = options;
  let props: UseDebugWatchExpressionsOptions = {
    ...sourceOptions,
    inspectionOwner: deriveOwner(sourceOptions),
  };
  function Harness() {
    captured.value = useDebugWatchExpressions(props);
    return null;
  }
  const render = () => act(() => root.render(<Harness />));
  render();
  return {
    hook: () => captured.value as UseDebugWatchExpressionsResult,
    set: (next: Partial<HookOptions>) => {
      sourceOptions = { ...sourceOptions, ...next };
      props = { ...sourceOptions, inspectionOwner: deriveOwner(sourceOptions) };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useDebugWatchExpressions", () => {
  it("reports storage failures and rolls back unpersisted changes", () => {
    const storage: DebugWatchStorage = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ui = renderHook({
      debugAdapterKind: null,
      evaluateWatch: vi.fn().mockResolvedValue(null),
      pauseGeneration: 0,
      selectedFrameId: null,
      snapshot: { lastSeq: 0, state: { kind: "inactive" } },
      storage,
      workspaceRoot: "/workspace",
    });

    act(() => ui.hook().add("count"));

    expect(ui.hook().definitions).toEqual([]);
    expect(report).toHaveBeenCalledWith(
      "Failed to persist debug watches; reverting the in-memory change.",
    );
    report.mockRestore();
    ui.unmount();
  });

  it("does not loop when composition supplies a fresh evaluate callback", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const evaluate = vi.fn().mockResolvedValue(null);
    let renders = 0;
    function Harness() {
      renders += 1;
      useDebugWatchExpressions({
        debugAdapterKind: null,
        evaluateWatch: (expression) => evaluate(expression),
        inspectionOwner: null,
        selectedFrameId: null,
        snapshot: { lastSeq: 0, state: { kind: "inactive" } },
        storage: null,
        workspaceRoot: null,
      });
      return null;
    }
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    expect(renders).toBeLessThan(5);
    act(() => root.unmount());
  });

  it("reevaluates enabled Node watches and retains expandable references for the exact owner", async () => {
    const evaluation = deferred<DebugEvaluationResult | null>();
    const evaluateWatch = vi.fn().mockReturnValue(evaluation.promise);
    const storage = new MemoryStorage();
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch,
      selectedFrameId: null,
      snapshot: stopped,
      storage,
      workspaceRoot: "/workspace",
    });

    act(() => ui.hook().add("count"));
    expect(evaluateWatch).toHaveBeenCalledWith("count");
    expect(ui.hook().pendingIds).toEqual(["watch-1"]);
    await act(async () => {
      evaluation.resolve({ status: "ok", value: "3", type: "number", variablesReference: 99 });
      await evaluation.promise;
    });
    expect(ui.hook().evaluations["watch-1"]).toEqual({
      owner: {
        rootKey: "/workspace",
        sessionId: 4,
        pauseGeneration: 2,
        frameId: 11,
      },
      definitionRevision: 1,
      frameId: 11,
      result: { status: "ok", value: "3", type: "number", variablesReference: 99 },
    });
    expect(ui.hook().pendingIds).toEqual([]);
    expect([...storage.values.values()][0]).toContain("count");
    ui.unmount();
  });

  it("re-evaluates every enabled Watch when inspection mutation revision advances", async () => {
    const evaluateWatch = vi
      .fn()
      .mockResolvedValue({ status: "ok", value: "3", setExpressionReference: 7 });
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch,
      refreshVersion: 0,
      selectedFrameId: null,
      snapshot: stopped,
      storage: new MemoryStorage(),
      workspaceRoot: "/workspace",
    });
    act(() => {
      ui.hook().add("first");
      ui.hook().add("second");
    });
    await act(async () => Promise.resolve());
    evaluateWatch.mockClear();
    ui.set({ refreshVersion: 1 });
    await act(async () => Promise.resolve());
    expect(evaluateWatch).toHaveBeenCalledTimes(2);
    expect(evaluateWatch).toHaveBeenCalledWith("first");
    expect(evaluateWatch).toHaveBeenCalledWith("second");
    ui.unmount();
  });

  it("invalidates stale replies after execution resumes or trust is revoked", async () => {
    const evaluation = deferred<DebugEvaluationResult | null>();
    const evaluateWatch = vi.fn().mockReturnValue(evaluation.promise);
    let trusted = true;
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch,
      isWorkspaceTrusted: () => trusted,
      selectedFrameId: null,
      snapshot: stopped,
      storage: new MemoryStorage(),
      workspaceRoot: "/workspace",
    });
    act(() => ui.hook().add("count"));
    trusted = false;
    ui.set({ snapshot: { lastSeq: 3, state: { kind: "running", sessionId: 4 } } });
    await act(async () => {
      evaluation.resolve({ status: "ok", value: "3", variablesReference: 99 });
      await evaluation.promise;
    });
    expect(ui.hook().evaluations).toEqual({});
    expect(ui.hook().pendingIds).toEqual([]);
    ui.unmount();
  });

  it("does not evaluate disabled watches or watches for unsupported adapters", () => {
    const evaluateWatch = vi.fn().mockResolvedValue({ status: "ok", value: "3" });
    const ui = renderHook({
      debugAdapterKind: "php",
      evaluateWatch,
      selectedFrameId: null,
      snapshot: stopped,
      storage: new MemoryStorage(),
      workspaceRoot: "/workspace",
    });
    act(() => ui.hook().add("count", false));
    act(() => ui.hook().setEnabled("watch-1", true));
    expect(evaluateWatch).not.toHaveBeenCalled();
    expect(ui.hook().evaluations).toEqual({});
    ui.unmount();
  });

  it("reevaluates after frame, pause generation, and expression changes", async () => {
    const evaluateWatch = vi.fn().mockResolvedValue({ status: "ok", value: "3" });
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch,
      selectedFrameId: null,
      snapshot: stopped,
      storage: new MemoryStorage(),
      workspaceRoot: "/workspace",
    });
    act(() => ui.hook().add("count"));
    await act(async () => Promise.resolve());
    expect(evaluateWatch).toHaveBeenCalledTimes(1);

    ui.set({ selectedFrameId: 12 });
    await act(async () => Promise.resolve());
    expect(evaluateWatch).toHaveBeenCalledTimes(2);
    expect(ui.hook().evaluations["watch-1"]?.frameId).toBe(12);

    ui.set({ pauseGeneration: 3 });
    await act(async () => Promise.resolve());
    expect(evaluateWatch).toHaveBeenCalledTimes(3);
    expect(ui.hook().evaluations["watch-1"]?.owner.pauseGeneration).toBe(3);

    act(() => ui.hook().update("watch-1", "total"));
    await act(async () => Promise.resolve());
    expect(evaluateWatch).toHaveBeenLastCalledWith("total");
    expect(evaluateWatch).toHaveBeenCalledTimes(4);
    ui.unmount();
  });

  it("keeps separate persisted definitions when the workspace root changes", () => {
    const storage = new MemoryStorage();
    const ui = renderHook({
      debugAdapterKind: null,
      evaluateWatch: vi.fn(),
      selectedFrameId: null,
      snapshot: { lastSeq: 0, state: { kind: "inactive" } },
      storage,
      workspaceRoot: "/workspace/one",
    });
    act(() => ui.hook().add("first"));
    expect(ui.hook().definitions.map((definition) => definition.expression)).toEqual(["first"]);

    ui.set({ workspaceRoot: "/workspace/two" });
    expect(ui.hook().definitions).toEqual([]);
    act(() => ui.hook().add("second"));
    ui.set({ workspaceRoot: "/workspace/one" });
    expect(ui.hook().definitions.map((definition) => definition.expression)).toEqual(["first"]);
    ui.set({ workspaceRoot: "/workspace/two" });
    expect(ui.hook().definitions.map((definition) => definition.expression)).toEqual(["second"]);
    ui.unmount();
  });

  it("uses the reducer as the authoritative canAdd policy for duplicates and count limits", () => {
    const ui = renderHook({
      debugAdapterKind: null,
      evaluateWatch: vi.fn(),
      selectedFrameId: null,
      snapshot: { lastSeq: 0, state: { kind: "inactive" } },
      storage: new MemoryStorage(),
      workspaceRoot: "/workspace",
    });

    expect(ui.hook().canAdd("value0")).toBe(true);
    for (let index = 0; index < MAX_DEBUG_WATCH_EXPRESSIONS; index += 1) {
      act(() => ui.hook().add(`value${index}`));
    }
    expect(ui.hook().definitions).toHaveLength(MAX_DEBUG_WATCH_EXPRESSIONS);
    expect(ui.hook().canAdd("value0")).toBe(false);
    expect(ui.hook().canAdd("overflow")).toBe(false);
    ui.unmount();
  });

  it("atomically rejects a duplicate add before React publishes the first mutation", () => {
    const ui = renderHook({
      debugAdapterKind: null,
      evaluateWatch: vi.fn(),
      selectedFrameId: null,
      snapshot: { lastSeq: 0, state: { kind: "inactive" } },
      storage: new MemoryStorage(),
      workspaceRoot: "/workspace",
    });

    let first = false;
    let duplicate = true;
    act(() => {
      first = ui.hook().add("user.name");
      duplicate = ui.hook().add("user.name");
    });
    expect(first).toBe(true);
    expect(duplicate).toBe(false);
    expect(ui.hook().definitions.map(({ expression }) => expression)).toEqual(["user.name"]);
    ui.unmount();
  });

  it("uses the exact serialized payload budget in canAdd without evaluating", () => {
    const evaluateWatch = vi.fn();
    const ui = renderHook({
      debugAdapterKind: "node",
      evaluateWatch,
      selectedFrameId: null,
      snapshot: { lastSeq: 1, state: { kind: "running", sessionId: 4 } },
      storage: new MemoryStorage(),
      workspaceRoot: "/workspace",
    });

    for (let index = 0; index < 15; index += 1) {
      act(() => ui.hook().add(`${index}:${"x".repeat(4_080)}`));
    }
    expect(ui.hook().definitions).toHaveLength(15);
    expect(ui.hook().canAdd(`overflow:${"x".repeat(4_080)}`)).toBe(false);
    expect(evaluateWatch).not.toHaveBeenCalled();
    ui.unmount();
  });
});
