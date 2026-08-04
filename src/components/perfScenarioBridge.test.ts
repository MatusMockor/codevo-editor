// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { editor as MonacoEditor } from "monaco-editor";
import {
  installPerfScenarioBridge,
  perfRenameApplySuppressed,
  perfScenarioBridgeEnabled,
  recordPerfProviderSample,
  registerPerfMeasuredProviders,
} from "./perfScenarioBridge";

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

interface TypingEditor {
  readonly editor: MonacoEditor.ICodeEditor;
  readonly typed: string[];
  readonly positions: { lineNumber: number; column: number }[];
  value: () => string;
}

function createTypingEditor(initialValue: string): TypingEditor {
  let value = initialValue;
  const typed: string[] = [];
  const positions: { lineNumber: number; column: number }[] = [];
  const listeners = new Set<() => void>();
  const model = {
    getValue: () => value,
    setValue: (next: string) => {
      value = next;
      listeners.forEach((listener) => listener());
    },
    getLineCount: () => value.split("\n").length,
    getLineMaxColumn: (lineNumber: number) => (value.split("\n")[lineNumber - 1] ?? "").length + 1,
    onDidChangeContent: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  const editor = {
    getModel: () => model,
    setPosition: (position: { lineNumber: number; column: number }) => {
      positions.push(position);
    },
    focus: () => {},
    trigger: (_source: string, handlerId: string, payload: { text: string }) => {
      if (handlerId !== "type") {
        return;
      }

      value += payload.text;
      typed.push(payload.text);
      listeners.forEach((listener) => listener());
    },
  } as unknown as MonacoEditor.ICodeEditor;

  return { editor, typed, positions, value: () => value };
}

interface FakeQuickOpen {
  readonly events: string[];
  readonly frames: () => number;
  readonly scheduleFrame: (callback: () => void) => void;
  readonly setQuickOpenOpen: (isOpen: boolean) => void;
  readonly setQuickOpenQuery: (query: string) => void;
  readonly isQuickOpenLoading: () => boolean;
}

function createFakeQuickOpen(timing: {
  loadingStartsAfter: number;
  loadingEndsAfter: number;
}): FakeQuickOpen {
  const events: string[] = [];
  let frame = 0;
  let queryFrame: number | null = null;

  return {
    events,
    frames: () => frame,
    scheduleFrame: (callback) => {
      frame += 1;
      callback();
    },
    setQuickOpenOpen: (isOpen) => {
      events.push(`open:${String(isOpen)}`);
      queryFrame = null;
    },
    setQuickOpenQuery: (query) => {
      events.push(`query:${query}`);
      queryFrame = frame;
    },
    isQuickOpenLoading: () => {
      if (queryFrame === null) {
        return false;
      }

      const elapsed = frame - queryFrame;

      return elapsed >= timing.loadingStartsAfter && elapsed < timing.loadingEndsAfter;
    },
  };
}

interface RenamingEditor {
  readonly editor: MonacoEditor.ICodeEditor;
  readonly input: HTMLInputElement;
  readonly triggered: string[];
  readonly runs: number[];
  readonly suppressedDuringRun: boolean[];
}

function createRenamingEditor(currentName: string): RenamingEditor {
  const input = document.createElement("input");
  input.value = currentName;
  const triggered: string[] = [];
  const runs: number[] = [];
  const suppressedDuringRun: boolean[] = [];
  let finish: (() => void) | null = null;
  const editor = {
    getAction: (actionId: string) => {
      if (actionId !== "editor.action.rename") {
        return null;
      }

      return {
        run: () => {
          runs.push(runs.length);
          suppressedDuringRun.push(perfRenameApplySuppressed());
          return new Promise<void>((resolve) => {
            finish = resolve;
          });
        },
      };
    },
    trigger: (_source: string, commandId: string) => {
      triggered.push(commandId);
      finish?.();
    },
  } as unknown as MonacoEditor.ICodeEditor;

  return { editor, input, triggered, runs, suppressedDuringRun };
}

function createModelEditor(lineCount: number, valueLength: number): MonacoEditor.ICodeEditor {
  return {
    getModel: () => ({
      getLineCount: () => lineCount,
      getValueLength: () => valueLength,
    }),
  } as unknown as MonacoEditor.ICodeEditor;
}

function baseDependencies() {
  return {
    getLatencySnapshot: () => [],
    clearLatencyMetrics: () => {},
    activateDocument: () => {},
    setQuickOpenOpen: () => {},
    setQuickOpenQuery: () => {},
    isQuickOpenLoading: () => false,
    getActiveEditor: () => null,
    getRetainedCounts: () => ({ models: 0, editors: 0 }),
    scheduleFrame: immediateFrame,
    now: () => 0,
  };
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
  it("installs and disposes the bridge and probe globals", () => {
    const dispose = installPerfScenarioBridge(baseDependencies());
    expect(window.__codevoPerf).toBeDefined();
    expect(window.__codevoPerfProbe).toBeDefined();
    dispose();
    expect(window.__codevoPerf).toBeUndefined();
    expect(window.__codevoPerfProbe).toBeUndefined();
  });

  it("measures tab switches per path with the active-model assertion satisfied", async () => {
    let tick = 0;
    let activePath: string | null = null;
    const activateDocument = vi.fn((path: string) => {
      activePath = path;
    });
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      activateDocument,
      getActiveDocumentPath: () => activePath,
      now: () => {
        tick += 5;
        return tick;
      },
    });
    const measurement = await window.__codevoPerf!.measureTabSwitches(["/a.ts", "/b.ts"]);
    expect(activateDocument).toHaveBeenCalledTimes(2);
    expect(measurement.durationsMs).toHaveLength(2);
    expect(measurement.assertionFailures).toEqual([]);
    expect(measurement.durationsMs.every((value) => value >= 0)).toBe(true);
    dispose();
  });

  it("fails a tab-switch sample closed when the active model is not the requested one", async () => {
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveDocumentPath: () => "/other.ts",
    });
    const measurement = await window.__codevoPerf!.measureTabSwitches(["/a.ts", "/b.ts"]);
    expect(measurement.durationsMs).toEqual([]);
    expect(measurement.assertionFailures).toHaveLength(2);
    expect(measurement.assertionFailures[0]).toContain("/a.ts");
    expect(measurement.assertionFailures[0]).toContain("/other.ts");
    dispose();
  });

  it("caps tab switches at 200 paths", async () => {
    let activePath: string | null = null;
    const activateDocument = vi.fn((path: string) => {
      activePath = path;
    });
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      activateDocument,
      getActiveDocumentPath: () => activePath,
    });
    const paths = Array.from({ length: 250 }, (_value, index) => `/file-${index}.ts`);
    const measurement = await window.__codevoPerf!.measureTabSwitches(paths);
    expect(measurement.durationsMs).toHaveLength(200);
    expect(activateDocument).toHaveBeenCalledTimes(200);
    expect(activateDocument).toHaveBeenLastCalledWith("/file-199.ts");
    dispose();
  });

  it("returns null from runTypingScenario without an active editor model", async () => {
    const recording = createRecordingEditor();
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => recording.editor,
    });
    await expect(window.__codevoPerf!.runTypingScenario("abc")).resolves.toBeNull();
    dispose();
  });

  it("types at the end of the file, measures dispatch and frame per keystroke, and restores the buffer", async () => {
    const typing = createTypingEditor("line-1\nline-2");
    let tick = 0;
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => typing.editor,
      now: () => {
        tick += 2;
        return tick;
      },
    });
    const result = await window.__codevoPerf!.runTypingScenario("abc");
    expect(result).not.toBeNull();
    expect(typing.typed).toEqual(["a", "b", "c"]);
    expect(typing.positions[0]).toEqual({ lineNumber: 2, column: 7 });
    expect(result!.dispatchMs).toHaveLength(3);
    expect(result!.frameMs).toHaveLength(3);
    expect(result!.typedCharacters).toEqual(["a", "b", "c"]);
    expect(result!.missedDispatches).toBe(0);
    expect(result!.dispatchMs.every((value) => value >= 0)).toBe(true);
    expect(result!.frameMs.every((value, index) => value >= result!.dispatchMs[index])).toBe(true);
    expect(result!.restored).toBe(true);
    expect(typing.value()).toBe("line-1\nline-2");
    dispose();
  });

  it("counts keystrokes that never produce a content change instead of faking a dispatch sample", async () => {
    const typing = createTypingEditor("x");
    const silentEditor = {
      ...typing.editor,
      trigger: () => {},
    } as unknown as MonacoEditor.ICodeEditor;
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => silentEditor,
    });
    const result = await window.__codevoPerf!.runTypingScenario("ab");
    expect(result!.missedDispatches).toBe(2);
    expect(result!.dispatchMs).toEqual([]);
    expect(result!.frameMs).toHaveLength(2);
    dispose();
  });

  it("caps typing at 2000 characters", async () => {
    const typing = createTypingEditor("");
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => typing.editor,
    });
    const result = await window.__codevoPerf!.runTypingScenario("x".repeat(2500));
    expect(result!.frameMs).toHaveLength(2000);
    expect(typing.typed).toHaveLength(2000);
    dispose();
  });

  it("drives a real quick open search and reports that it settled", async () => {
    const quickOpen = createFakeQuickOpen({ loadingStartsAfter: 1, loadingEndsAfter: 4 });
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      setQuickOpenOpen: quickOpen.setQuickOpenOpen,
      setQuickOpenQuery: quickOpen.setQuickOpenQuery,
      isQuickOpenLoading: quickOpen.isQuickOpenLoading,
      scheduleFrame: quickOpen.scheduleFrame,
    });

    await expect(window.__codevoPerf!.runQuickOpenQuery("moduleA")).resolves.toBe(true);

    expect(quickOpen.events).toEqual(["open:true", "query:moduleA", "open:false"]);
    expect(quickOpen.frames()).toBe(4);
    dispose();
  });

  it("measures a quick open UI query via the engine-settle edge plus one rendered frame", async () => {
    const events: string[] = [];
    let frame = 0;
    let loading = false;
    let tick = 0;
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      setQuickOpenOpen: (isOpen) => {
        events.push(`open:${String(isOpen)}`);
      },
      setQuickOpenQuery: (query) => {
        events.push(`query:${query}`);
        loading = true;
      },
      isQuickOpenLoading: () => loading,
      scheduleFrame: (callback) => {
        frame += 1;

        if (frame === 4) {
          recordPerfProviderSample("fileSearchEngine", {
            ms: 2,
            resultCount: 7,
            target: "moduleA",
          });
          loading = false;
        }

        callback();
      },
      countQuickOpenResults: () => 7,
      now: () => {
        tick += 4;
        return tick;
      },
    });

    const sample = await window.__codevoPerf!.runQuickOpenUiQuery("moduleA");

    expect(sample).not.toBeNull();
    expect(sample!.resultCount).toBe(7);
    expect(sample!.ms).toBeGreaterThan(0);
    expect(events).toEqual(["open:true", "query:moduleA", "open:false"]);
    dispose();
  });

  it("still measures a query that settles within a single frame, where the loading edge is never observed", async () => {
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      setQuickOpenQuery: (query) => {
        recordPerfProviderSample("fileSearchEngine", { ms: 0.4, resultCount: 3, target: query });
      },
      isQuickOpenLoading: () => false,
      countQuickOpenResults: () => 3,
    });

    const sample = await window.__codevoPerf!.runQuickOpenUiQuery("fast");

    expect(sample).not.toBeNull();
    expect(sample!.resultCount).toBe(3);
    dispose();
  });

  it("returns null fail-closed when the query never dispatches an engine request", async () => {
    const events: string[] = [];
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      setQuickOpenOpen: (isOpen) => {
        events.push(`open:${String(isOpen)}`);
      },
      isQuickOpenLoading: () => false,
      countQuickOpenResults: () => 0,
    });
    recordPerfProviderSample("fileSearchEngine", { ms: 1, resultCount: 9, target: "other" });

    await expect(window.__codevoPerf!.runQuickOpenUiQuery("never")).resolves.toBeNull();
    expect(events[events.length - 1]).toBe("open:false");
    dispose();
  });

  it("restores drifted active editor content and reports the outcome", () => {
    const typing = createTypingEditor("fixture content");
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => typing.editor,
    });

    expect(window.__codevoPerf!.restoreActiveEditorContent("fixture content")).toBe(true);

    typing.editor.trigger("perf", "type", { text: "X" });
    expect(typing.value()).toBe("fixture contentX");
    expect(window.__codevoPerf!.restoreActiveEditorContent("fixture content")).toBe(true);
    expect(typing.value()).toBe("fixture content");
    dispose();
  });

  it("fails restoreActiveEditorContent closed without an active model", () => {
    const dispose = installPerfScenarioBridge(baseDependencies());

    expect(window.__codevoPerf!.restoreActiveEditorContent("anything")).toBe(false);
    dispose();
  });

  it("drives the registered references provider once with includeDeclaration true", async () => {
    const typing = createTypingEditor("const value: TaskModel4Kind = kind;");
    const calls: unknown[][] = [];
    const unregister = registerPerfMeasuredProviders(
      {
        references: {
          provideReferences: async (...args: unknown[]) => {
            calls.push(args);
            return [{}, {}] as never;
          },
        },
      },
      { DEV: true, VITE_CODEVO_PERF_BRIDGE: "1" },
      null,
    );
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => typing.editor,
    });

    await expect(
      window.__codevoPerf!.runReferencesProbe({ lineNumber: 1, column: 15 }),
    ).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ lineNumber: 1, column: 15 });
    expect(calls[0][2]).toEqual({ includeDeclaration: true });
    dispose();
    unregister?.();
  });

  it("fails the references probe closed when no measured provider is registered", async () => {
    const typing = createTypingEditor("x");
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => typing.editor,
    });

    await expect(
      window.__codevoPerf!.runReferencesProbe({ lineNumber: 1, column: 1 }),
    ).resolves.toBe(false);
    dispose();
  });

  it("refuses to register measured providers outside the DEV perf lane", () => {
    expect(
      registerPerfMeasuredProviders(
        { references: { provideReferences: async () => [] } },
        { DEV: false, VITE_CODEVO_PERF_BRIDGE: "1" },
        null,
      ),
    ).toBeNull();
    expect(
      registerPerfMeasuredProviders(
        { references: { provideReferences: async () => [] } },
        { DEV: true },
        null,
      ),
    ).toBeNull();
  });

  it("computes a rename through the provider adapter with the apply suppression armed", async () => {
    const typing = createTypingEditor("const value = 1;");
    const suppressionDuringCall: boolean[] = [];
    const unregister = registerPerfMeasuredProviders(
      {
        rename: {
          provideRenameEdits: async () => {
            suppressionDuringCall.push(perfRenameApplySuppressed());
            return { edits: [] } as never;
          },
        },
      },
      { DEV: true, VITE_CODEVO_PERF_BRIDGE: "1" },
      null,
    );
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => typing.editor,
    });

    await expect(
      window.__codevoPerf!.runRenameProbe({ lineNumber: 1, column: 7 }, "valueRenamed"),
    ).resolves.toBe(true);

    expect(suppressionDuringCall).toEqual([true]);
    expect(perfRenameApplySuppressed()).toBe(false);
    dispose();
    unregister?.();
  });

  it("reports a rejected rename probe as false and still clears the suppression", async () => {
    const typing = createTypingEditor("const value = 1;");
    const unregister = registerPerfMeasuredProviders(
      {
        rename: {
          provideRenameEdits: async () => ({ rejectReason: "cannot rename", edits: [] }) as never,
        },
      },
      { DEV: true, VITE_CODEVO_PERF_BRIDGE: "1" },
      null,
    );
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => typing.editor,
    });

    await expect(
      window.__codevoPerf!.runRenameProbe({ lineNumber: 1, column: 7 }, "valueRenamed"),
    ).resolves.toBe(false);
    expect(perfRenameApplySuppressed()).toBe(false);
    dispose();
    unregister?.();
  });

  it("stops serving measured providers after their registration is disposed", async () => {
    const typing = createTypingEditor("x");
    const unregister = registerPerfMeasuredProviders(
      { references: { provideReferences: async () => [] } },
      { DEV: true, VITE_CODEVO_PERF_BRIDGE: "1" },
      null,
    );
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => typing.editor,
    });

    unregister?.();

    await expect(
      window.__codevoPerf!.runReferencesProbe({ lineNumber: 1, column: 1 }),
    ).resolves.toBe(false);
    dispose();
  });

  it("records provider probe samples while installed and clears them on demand", () => {
    const dispose = installPerfScenarioBridge(baseDependencies());
    recordPerfProviderSample("completion", { ms: 12, resultCount: 4 });
    window.__codevoPerfProbe!.record("fileSearchEngine", { ms: 3, resultCount: 9, target: "pkg" });

    expect(window.__codevoPerf!.getProviderProbeSamples("completion")).toEqual([
      { ms: 12, resultCount: 4 },
    ]);
    expect(window.__codevoPerf!.getProviderProbeSamples("fileSearchEngine")).toEqual([
      { ms: 3, resultCount: 9, target: "pkg" },
    ]);

    window.__codevoPerf!.clearProviderProbeSamples();
    expect(window.__codevoPerf!.getProviderProbeSamples("completion")).toEqual([]);
    dispose();
  });

  it("rejects malformed probe samples and bounds retained samples per kind", () => {
    const dispose = installPerfScenarioBridge(baseDependencies());
    recordPerfProviderSample("references", { ms: -1, resultCount: 1 });
    recordPerfProviderSample("references", { ms: 1, resultCount: Number.NaN });

    expect(window.__codevoPerf!.getProviderProbeSamples("references")).toEqual([]);

    for (let index = 0; index < 80; index += 1) {
      recordPerfProviderSample("references", { ms: index, resultCount: 1 });
    }

    expect(window.__codevoPerf!.getProviderProbeSamples("references")).toHaveLength(64);
    dispose();
  });

  it("drops probe samples recorded after the bridge is disposed", () => {
    const dispose = installPerfScenarioBridge(baseDependencies());
    dispose();
    recordPerfProviderSample("completion", { ms: 1, resultCount: 1 });

    const reinstall = installPerfScenarioBridge(baseDependencies());
    expect(window.__codevoPerf!.getProviderProbeSamples("completion")).toEqual([]);
    reinstall();
  });

  it("reports an environment sample with bundle mode, strict mode, timer quantization, and window size", () => {
    let tick = 0;
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      bundleEnvironment: { DEV: true },
      now: () => {
        tick += 0.5;
        return tick;
      },
    });

    const sample = window.__codevoPerf!.getEnvironmentSample();
    expect(sample.bundleMode).toBe("dev");
    expect(typeof sample.strictMode).toBe("boolean");
    expect(sample.timerQuantizationMs).toBe(0.5);
    expect(sample.windowSize.width).toBeGreaterThan(0);
    expect(sample.windowSize.height).toBeGreaterThan(0);
    expect(typeof sample.platform).toBe("string");
    dispose();
  });

  it("omits timer quantization fail-closed when the clock never advances, never recording 0", () => {
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      bundleEnvironment: { DEV: false },
    });

    const sample = window.__codevoPerf!.getEnvironmentSample();
    expect(sample.bundleMode).toBe("production");
    expect(sample.timerQuantizationMs).toBeUndefined();
    expect("timerQuantizationMs" in sample).toBe(false);
    dispose();
  });

  it("finds the real quantum of a coarse clock instead of reporting 0", () => {
    let calls = 0;
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      now: () => {
        calls += 1;
        return Math.floor(calls / 128);
      },
    });

    const sample = window.__codevoPerf!.getEnvironmentSample();
    expect(sample.timerQuantizationMs).toBe(1);
    dispose();
  });

  it("runs an available editor action and reports missing ones", async () => {
    const recording = createRecordingEditor(["editor.action.formatDocument"]);
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => recording.editor,
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

  it("cancels the interactive rename widget after measuring its launch", async () => {
    let finishRename: (() => void) | null = null;
    const trigger = vi.fn((_source: string, commandId: string) => {
      if (commandId === "cancelRenameInput") finishRename?.();
    });
    const editor = {
      getAction: (actionId: string) =>
        actionId === "editor.action.rename"
          ? { run: () => new Promise<void>((resolve) => (finishRename = resolve)) }
          : null,
      trigger,
    } as unknown as MonacoEditor.ICodeEditor;
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => editor,
    });

    await expect(window.__codevoPerf!.runEditorAction("editor.action.rename")).resolves.toBe(true);
    expect(trigger).toHaveBeenCalledWith("perf", "cancelRenameInput", {});
    dispose();
  });

  it("commits a rename with the requested new name through the real accept command", async () => {
    const renaming = createRenamingEditor("TaskModel4Kind");
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => renaming.editor,
      getVisibleRenameInput: () => renaming.input,
    });

    await expect(window.__codevoPerf!.runRenameWithNewName("TaskModel4KindRenamed")).resolves.toBe(
      true,
    );

    expect(renaming.runs).toHaveLength(1);
    expect(renaming.input.value).toBe("TaskModel4KindRenamed");
    expect(renaming.triggered).toEqual(["acceptRenameInput"]);
    dispose();
  });

  it("suppresses the rename apply exactly while the measured rename runs", async () => {
    const renaming = createRenamingEditor("TaskModel4Kind");
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => renaming.editor,
      getVisibleRenameInput: () => renaming.input,
    });

    expect(perfRenameApplySuppressed()).toBe(false);
    await window.__codevoPerf!.runRenameWithNewName("TaskModel4KindRenamed");
    expect(renaming.suppressedDuringRun).toEqual([true]);
    expect(perfRenameApplySuppressed()).toBe(false);
    dispose();
  });

  it("cancels and reports failure when the rename input never becomes visible", async () => {
    const renaming = createRenamingEditor("TaskModel4Kind");
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => renaming.editor,
      getVisibleRenameInput: () => null,
    });

    await expect(window.__codevoPerf!.runRenameWithNewName("TaskModel4KindRenamed")).resolves.toBe(
      false,
    );

    expect(renaming.triggered).toEqual(["cancelRenameInput"]);
    expect(perfRenameApplySuppressed()).toBe(false);
    dispose();
  });

  it("refuses a blank new name without launching the rename action", async () => {
    const renaming = createRenamingEditor("TaskModel4Kind");
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => renaming.editor,
      getVisibleRenameInput: () => renaming.input,
    });

    await expect(window.__codevoPerf!.runRenameWithNewName("   ")).resolves.toBe(false);

    expect(renaming.runs).toHaveLength(0);
    expect(renaming.triggered).toEqual([]);
    dispose();
  });

  it("refuses a rename that would not change the current name", async () => {
    const renaming = createRenamingEditor("TaskModel4Kind");
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => renaming.editor,
      getVisibleRenameInput: () => renaming.input,
    });

    await expect(window.__codevoPerf!.runRenameWithNewName("TaskModel4Kind")).resolves.toBe(false);

    expect(renaming.triggered).toEqual(["cancelRenameInput"]);
    dispose();
  });

  it("returns false from runRenameWithNewName without an active editor", async () => {
    const dispose = installPerfScenarioBridge(baseDependencies());

    await expect(window.__codevoPerf!.runRenameWithNewName("Whatever")).resolves.toBe(false);

    dispose();
  });

  it("reports the real large-document policy verdict for an oversized active model", () => {
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => createModelEditor(20000, 598021),
    });

    expect(window.__codevoPerf!.getLargeSmartDocumentStatus()).toEqual({
      degraded: true,
      reason: "character-limit",
      lineCount: 20000,
      utf16Length: 598021,
      lineLimit: 5000,
      characterLimit: 262144,
    });
    dispose();
  });

  it("reports an eligible verdict for a model inside both policy limits", () => {
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getActiveEditor: () => createModelEditor(2000, 59354),
    });

    const status = window.__codevoPerf!.getLargeSmartDocumentStatus();
    expect(status.degraded).toBe(false);
    expect(status.reason).toBeNull();
    dispose();
  });

  it("reports no active model instead of guessing a policy verdict", () => {
    const dispose = installPerfScenarioBridge(baseDependencies());

    const status = window.__codevoPerf!.getLargeSmartDocumentStatus();
    expect(status.degraded).toBe(false);
    expect(status.reason).toBe("no-active-model");
    expect(status.lineCount).toBeNull();
    dispose();
  });

  it("reports the running JS/TS language server runtime status for the typing lane", () => {
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getLanguageServerRuntimeStatus: () => ({
        kind: "running",
        sessionId: 7,
        capabilities: {} as never,
      }),
    });

    expect(window.__codevoPerf!.getLanguageServerRuntimeStatus()).toEqual({
      kind: "running",
      running: true,
    });
    dispose();
  });

  it("reports a starting JS/TS language server as not running", () => {
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getLanguageServerRuntimeStatus: () => ({ kind: "starting", sessionId: 1 }),
    });

    expect(window.__codevoPerf!.getLanguageServerRuntimeStatus()).toEqual({
      kind: "starting",
      running: false,
    });
    dispose();
  });

  it("reports an absent JS/TS language server status as none", () => {
    const dispose = installPerfScenarioBridge(baseDependencies());

    expect(window.__codevoPerf!.getLanguageServerRuntimeStatus()).toEqual({
      kind: "none",
      running: false,
    });
    dispose();
  });

  it("never lets a throwing runtime status accessor break the perf lane", () => {
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getLanguageServerRuntimeStatus: () => {
        throw new Error("runtime status unavailable");
      },
    });

    expect(window.__codevoPerf!.getLanguageServerRuntimeStatus()).toEqual({
      kind: "none",
      running: false,
    });
    dispose();
  });

  it("returns false from runEditorAction without an active editor", async () => {
    const dispose = installPerfScenarioBridge(baseDependencies());
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
      ...baseDependencies(),
      getLatencySnapshot: () => snapshot,
      clearLatencyMetrics,
    });
    expect(window.__codevoPerf!.getLatencySnapshot()).toEqual(snapshot);
    window.__codevoPerf!.clearLatencyMetrics();
    expect(clearLatencyMetrics).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("reports retained counts live from the injected source", () => {
    let models = 3;
    const dispose = installPerfScenarioBridge({
      ...baseDependencies(),
      getRetainedCounts: () => ({ models, editors: 1 }),
    });
    expect(window.__codevoPerf!.getRetainedCounts()).toEqual({ models: 3, editors: 1 });
    models = 5;
    expect(window.__codevoPerf!.getRetainedCounts()).toEqual({ models: 5, editors: 1 });
    dispose();
  });

  it("reports a memory sample", () => {
    const dispose = installPerfScenarioBridge(baseDependencies());
    const sample = window.__codevoPerf!.getMemorySample();
    expect(sample.usedJsHeapBytes === null || typeof sample.usedJsHeapBytes === "number").toBe(
      true,
    );
    dispose();
  });

  it("only removes the global it installed", () => {
    const first = installPerfScenarioBridge(baseDependencies());
    const second = installPerfScenarioBridge(baseDependencies());
    const latest = window.__codevoPerf;
    first();
    expect(window.__codevoPerf).toBe(latest);
    second();
    expect(window.__codevoPerf).toBeUndefined();
  });
});
