// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { editor as MonacoEditor } from "monaco-editor";
import { installPerfScenarioBridge, perfScenarioBridgeEnabled } from "./perfScenarioBridge";

function immediateFrame(callback: () => void) {
  callback();
}

interface RecordingEditor {
  readonly typed: string[];
  readonly ranActions: string[];
  readonly editor: MonacoEditor.ICodeEditor;
}

function createRecordingEditor(actionIds: readonly string[] = []): RecordingEditor {
  const typed: string[] = [];
  const ranActions: string[] = [];
  const editor = {
    trigger: (_source: string, _handlerId: string, payload: { text: string }) => {
      typed.push(payload.text);
    },
    getAction: (actionId: string) => {
      if (!actionIds.includes(actionId)) {
        return null;
      }

      return {
        run: async () => {
          ranActions.push(actionId);
        },
      };
    },
  } as unknown as MonacoEditor.ICodeEditor;

  return { typed, ranActions, editor };
}

describe("perfScenarioBridgeEnabled", () => {
  it("is disabled outside DEV", () => {
    expect(perfScenarioBridgeEnabled({ DEV: false, VITE_CODEVO_PERF_BRIDGE: "1" }, null)).toBe(
      false,
    );
  });

  it("is enabled with DEV and the env flag", () => {
    expect(perfScenarioBridgeEnabled({ DEV: true, VITE_CODEVO_PERF_BRIDGE: "1" }, null)).toBe(true);
  });

  it("supports the DEV localStorage fallback", () => {
    const storage = { getItem: (key: string) => (key === "codevo.perfBridge" ? "1" : null) };
    expect(perfScenarioBridgeEnabled({ DEV: true }, storage)).toBe(true);
  });

  it("ignores the localStorage fallback outside DEV", () => {
    const storage = { getItem: () => "1" };
    expect(perfScenarioBridgeEnabled({ DEV: false }, storage)).toBe(false);
  });

  it("stays disabled when storage access throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(perfScenarioBridgeEnabled({ DEV: true }, storage)).toBe(false);
  });
});

describe("installPerfScenarioBridge", () => {
  it("installs and disposes the global", () => {
    const dispose = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument: () => {},
      getActiveEditor: () => null,
      getRetainedCounts: () => ({ models: 0, editors: 0 }),
      scheduleFrame: immediateFrame,
      now: () => 0,
    });
    expect(window.__codevoPerf).toBeDefined();
    dispose();
    expect(window.__codevoPerf).toBeUndefined();
  });

  it("measures tab switches per path", async () => {
    let tick = 0;
    const activateDocument = vi.fn();
    const dispose = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument,
      getActiveEditor: () => null,
      getRetainedCounts: () => ({ models: 0, editors: 0 }),
      scheduleFrame: immediateFrame,
      now: () => {
        tick += 5;
        return tick;
      },
    });
    const durations = await window.__codevoPerf!.measureTabSwitches(["/a.ts", "/b.ts"]);
    expect(activateDocument).toHaveBeenCalledTimes(2);
    expect(durations).toHaveLength(2);
    expect(durations.every((value) => value >= 0)).toBe(true);
    dispose();
  });

  it("caps tab switches at 200 paths", async () => {
    const activateDocument = vi.fn();
    const dispose = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument,
      getActiveEditor: () => null,
      getRetainedCounts: () => ({ models: 0, editors: 0 }),
      scheduleFrame: immediateFrame,
      now: () => 0,
    });
    const paths = Array.from({ length: 250 }, (_value, index) => `/file-${index}.ts`);
    const durations = await window.__codevoPerf!.measureTabSwitches(paths);
    expect(durations).toHaveLength(200);
    expect(activateDocument).toHaveBeenCalledTimes(200);
    expect(activateDocument).toHaveBeenLastCalledWith("/file-199.ts");
    dispose();
  });

  it("returns [] from typeTextInActiveEditor without an active editor", async () => {
    const dispose = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument: () => {},
      getActiveEditor: () => null,
      getRetainedCounts: () => ({ models: 0, editors: 0 }),
      scheduleFrame: immediateFrame,
      now: () => 0,
    });
    await expect(window.__codevoPerf!.typeTextInActiveEditor("abc")).resolves.toEqual([]);
    dispose();
  });

  it("types one character per frame and reports per-character durations", async () => {
    const recording = createRecordingEditor();
    let tick = 0;
    let frames = 0;
    const dispose = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument: () => {},
      getActiveEditor: () => recording.editor,
      getRetainedCounts: () => ({ models: 0, editors: 0 }),
      scheduleFrame: (callback) => {
        frames += 1;
        callback();
      },
      now: () => {
        tick += 3;
        return tick;
      },
    });
    const durations = await window.__codevoPerf!.typeTextInActiveEditor("abc");
    expect(recording.typed).toEqual(["a", "b", "c"]);
    expect(frames).toBe(3);
    expect(durations).toEqual([3, 3, 3]);
    dispose();
  });

  it("caps typing at 2000 characters", async () => {
    const recording = createRecordingEditor();
    const dispose = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument: () => {},
      getActiveEditor: () => recording.editor,
      getRetainedCounts: () => ({ models: 0, editors: 0 }),
      scheduleFrame: immediateFrame,
      now: () => 0,
    });
    const durations = await window.__codevoPerf!.typeTextInActiveEditor("x".repeat(2500));
    expect(durations).toHaveLength(2000);
    expect(recording.typed).toHaveLength(2000);
    dispose();
  });

  it("runs an available editor action and reports missing ones", async () => {
    const recording = createRecordingEditor(["editor.action.formatDocument"]);
    const dispose = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument: () => {},
      getActiveEditor: () => recording.editor,
      getRetainedCounts: () => ({ models: 0, editors: 0 }),
      scheduleFrame: immediateFrame,
      now: () => 0,
    });
    await expect(
      window.__codevoPerf!.runEditorAction("editor.action.formatDocument"),
    ).resolves.toBe(true);
    await expect(window.__codevoPerf!.runEditorAction("editor.action.unknown")).resolves.toBe(
      false,
    );
    expect(recording.ranActions).toEqual(["editor.action.formatDocument"]);
    dispose();
  });

  it("returns false from runEditorAction without an active editor", async () => {
    const dispose = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument: () => {},
      getActiveEditor: () => null,
      getRetainedCounts: () => ({ models: 0, editors: 0 }),
      scheduleFrame: immediateFrame,
      now: () => 0,
    });
    await expect(
      window.__codevoPerf!.runEditorAction("editor.action.formatDocument"),
    ).resolves.toBe(false);
    dispose();
  });

  it("exposes the injected latency snapshot and clearing", () => {
    const clearLatencyMetrics = vi.fn();
    const snapshot = [
      {
        kind: "completion" as const,
        stats: { count: 1, last: 2, min: 2, max: 2, median: 2, p95: 2 },
      },
    ];
    const dispose = installPerfScenarioBridge({
      getLatencySnapshot: () => snapshot,
      clearLatencyMetrics,
      activateDocument: () => {},
      getActiveEditor: () => null,
      getRetainedCounts: () => ({ models: 0, editors: 0 }),
      scheduleFrame: immediateFrame,
      now: () => 0,
    });
    expect(window.__codevoPerf!.getLatencySnapshot()).toEqual(snapshot);
    window.__codevoPerf!.clearLatencyMetrics();
    expect(clearLatencyMetrics).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("reports retained counts live from the injected source", () => {
    let models = 3;
    const dispose = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument: () => {},
      getActiveEditor: () => null,
      getRetainedCounts: () => ({ models, editors: 1 }),
      scheduleFrame: immediateFrame,
      now: () => 0,
    });
    expect(window.__codevoPerf!.getRetainedCounts()).toEqual({ models: 3, editors: 1 });
    models = 5;
    expect(window.__codevoPerf!.getRetainedCounts()).toEqual({ models: 5, editors: 1 });
    dispose();
  });

  it("reports a memory sample", () => {
    const dispose = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument: () => {},
      getActiveEditor: () => null,
      getRetainedCounts: () => ({ models: 0, editors: 0 }),
      scheduleFrame: immediateFrame,
      now: () => 0,
    });
    const sample = window.__codevoPerf!.getMemorySample();
    expect(sample.usedJsHeapBytes === null || typeof sample.usedJsHeapBytes === "number").toBe(
      true,
    );
    dispose();
  });

  it("only removes the global it installed", () => {
    const first = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument: () => {},
      getActiveEditor: () => null,
      getRetainedCounts: () => ({ models: 0, editors: 0 }),
      scheduleFrame: immediateFrame,
      now: () => 0,
    });
    const second = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument: () => {},
      getActiveEditor: () => null,
      getRetainedCounts: () => ({ models: 0, editors: 0 }),
      scheduleFrame: immediateFrame,
      now: () => 0,
    });
    const latest = window.__codevoPerf;
    first();
    expect(window.__codevoPerf).toBe(latest);
    second();
    expect(window.__codevoPerf).toBeUndefined();
  });
});
