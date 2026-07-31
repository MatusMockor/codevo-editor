import type { editor as MonacoEditor } from "monaco-editor";
import type { LatencySnapshotEntry } from "../domain/latencyTracker";

const MAX_TYPED_CHARACTERS = 2000;
const MAX_TAB_SWITCHES = 200;
const PERF_BRIDGE_STORAGE_KEY = "codevo.perfBridge";

export interface PerfRetainedCounts {
  models: number;
  editors: number;
}

export interface PerfMemorySample {
  usedJsHeapBytes: number | null;
}

export interface PerfScenarioBridge {
  getLatencySnapshot(): LatencySnapshotEntry[];
  clearLatencyMetrics(): void;
  typeTextInActiveEditor(text: string): Promise<number[]>;
  measureTabSwitches(paths: readonly string[]): Promise<number[]>;
  runEditorAction(actionId: string): Promise<boolean>;
  getRetainedCounts(): PerfRetainedCounts;
  getMemorySample(): PerfMemorySample;
}

declare global {
  interface Window {
    __codevoPerf?: PerfScenarioBridge;
  }
}

interface PerfScenarioBridgeEnvironment {
  DEV?: boolean;
  VITE_CODEVO_PERF_BRIDGE?: string;
}

export function perfScenarioBridgeEnabled(
  environment: PerfScenarioBridgeEnvironment = import.meta.env,
  storage: Pick<Storage, "getItem"> | null | undefined = window.localStorage,
): boolean {
  if (!environment.DEV) {
    return false;
  }

  if (environment.VITE_CODEVO_PERF_BRIDGE === "1") {
    return true;
  }

  try {
    return storage?.getItem(PERF_BRIDGE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export interface PerfScenarioBridgeDependencies {
  readonly getLatencySnapshot: () => LatencySnapshotEntry[];
  readonly clearLatencyMetrics: () => void;
  readonly activateDocument: (path: string) => void;
  readonly getActiveEditor: () => MonacoEditor.ICodeEditor | null;
  readonly getRetainedCounts: () => PerfRetainedCounts;
  readonly scheduleFrame?: (callback: () => void) => void;
  readonly now?: () => number;
}

type FrameScheduler = (callback: () => void) => void;

function defaultScheduleFrame(callback: () => void): void {
  requestAnimationFrame(() => {
    callback();
  });
}

function defaultNow(): number {
  return performance.now();
}

function nextFrame(scheduleFrame: FrameScheduler): Promise<void> {
  return new Promise<void>((resolve) => {
    scheduleFrame(() => {
      resolve();
    });
  });
}

function readUsedJsHeapBytes(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize?: number } }).memory;

  if (typeof memory?.usedJSHeapSize !== "number") {
    return null;
  }

  return memory.usedJSHeapSize;
}

export function createPerfScenarioBridge(
  dependencies: PerfScenarioBridgeDependencies,
): PerfScenarioBridge {
  const scheduleFrame = dependencies.scheduleFrame ?? defaultScheduleFrame;
  const now = dependencies.now ?? defaultNow;

  return {
    getLatencySnapshot: () => dependencies.getLatencySnapshot(),
    clearLatencyMetrics: () => {
      dependencies.clearLatencyMetrics();
    },
    async typeTextInActiveEditor(text: string): Promise<number[]> {
      const editor = dependencies.getActiveEditor();

      if (!editor) {
        return [];
      }

      const durations: number[] = [];
      const capped = Array.from(text).slice(0, MAX_TYPED_CHARACTERS);

      for (const character of capped) {
        const start = now();
        editor.trigger("perf", "type", { text: character });
        await nextFrame(scheduleFrame);
        durations.push(now() - start);
      }

      return durations;
    },
    async measureTabSwitches(paths: readonly string[]): Promise<number[]> {
      const durations: number[] = [];
      const capped = paths.slice(0, MAX_TAB_SWITCHES);

      for (const path of capped) {
        const start = now();
        dependencies.activateDocument(path);
        await nextFrame(scheduleFrame);
        await nextFrame(scheduleFrame);
        durations.push(now() - start);
      }

      return durations;
    },
    async runEditorAction(actionId: string): Promise<boolean> {
      const action = dependencies.getActiveEditor()?.getAction(actionId);

      if (!action) {
        return false;
      }

      await action.run();

      return true;
    },
    getRetainedCounts: () => dependencies.getRetainedCounts(),
    getMemorySample: () => ({ usedJsHeapBytes: readUsedJsHeapBytes() }),
  };
}

export function installPerfScenarioBridge(
  dependencies: PerfScenarioBridgeDependencies,
): () => void {
  const bridge = createPerfScenarioBridge(dependencies);
  window.__codevoPerf = bridge;

  return () => {
    if (window.__codevoPerf !== bridge) {
      return;
    }

    delete window.__codevoPerf;
  };
}
