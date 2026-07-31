// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { editor as MonacoEditor } from "monaco-editor";
import { resolveInReactAct } from "../test/reactTestLifecycle";
import {
  usePerfScenarioBridgeInstall,
  type PerfMonacoEditorApi,
  type PerfScenarioBridgeHost,
} from "./usePerfScenarioBridgeInstall";

let mountedRoot: Root | null = null;
let container: HTMLDivElement | null = null;

function fakeEditor(hasTextFocus: boolean, ranBy: string[]): MonacoEditor.ICodeEditor {
  return {
    hasTextFocus: () => hasTextFocus,
    getAction: (actionId: string) => ({
      run: async () => {
        ranBy.push(actionId);
      },
    }),
  } as unknown as MonacoEditor.ICodeEditor;
}

function fakeEditorApi(
  editors: readonly MonacoEditor.ICodeEditor[],
  modelCount: number,
): PerfMonacoEditorApi {
  const models = Array.from(
    { length: modelCount },
    () => ({}) as unknown as MonacoEditor.ITextModel,
  );

  return { editor: { getEditors: () => editors, getModels: () => models } };
}

function mountBridgeHost(
  loadEditorApi: () => Promise<PerfMonacoEditorApi>,
  host: PerfScenarioBridgeHost,
): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoot = root;

  function BridgeHost() {
    usePerfScenarioBridgeInstall(host, loadEditorApi);

    return null;
  }

  act(() => {
    root.render(createElement(BridgeHost));
  });
}

interface QuickOpenTrace {
  readonly opened: boolean[];
  readonly queries: string[];
}

function quickOpenHost(trace: QuickOpenTrace, loadingFrames: number): PerfScenarioBridgeHost {
  let remainingLoadingReads = 0;

  return {
    getLatencySnapshot: () => [],
    clearLatencyMetrics: () => {},
    setActivePath: () => {},
    get quickOpenLoading() {
      if (remainingLoadingReads <= 0) {
        return false;
      }

      remainingLoadingReads -= 1;

      return true;
    },
    setQuickOpenOpen: (isOpen) => {
      trace.opened.push(isOpen);
      remainingLoadingReads = 0;
    },
    setQuickOpenQuery: (query) => {
      trace.queries.push(query);
      remainingLoadingReads = loadingFrames;
    },
  };
}

function HostProbe({ host }: { host: PerfScenarioBridgeHost }) {
  usePerfScenarioBridgeInstall(host, stableEditorApiLoader);

  return null;
}

function stableEditorApiLoader(): Promise<PerfMonacoEditorApi> {
  return Promise.resolve(fakeEditorApi([], 0));
}

function mountHostProbe(host: PerfScenarioBridgeHost): (next: PerfScenarioBridgeHost) => void {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoot = root;

  const render = (next: PerfScenarioBridgeHost) => {
    act(() => {
      root.render(createElement(HostProbe, { host: next }));
    });
  };

  render(host);

  return render;
}

function silentHost(): PerfScenarioBridgeHost {
  return {
    getLatencySnapshot: () => [],
    clearLatencyMetrics: () => {},
    setActivePath: () => {},
    quickOpenLoading: false,
    setQuickOpenOpen: () => {},
    setQuickOpenQuery: () => {},
  };
}

async function waitForBridge(): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => Promise.resolve());
    expect(window.__codevoPerf).toBeDefined();
  });
}

afterEach(() => {
  const root = mountedRoot;
  const host = container;
  mountedRoot = null;
  container = null;

  if (root) {
    act(() => {
      root.unmount();
    });
  }

  host?.remove();
  delete window.__codevoPerf;
  window.localStorage.removeItem("codevo.perfBridge");
});

describe("usePerfScenarioBridgeInstall", () => {
  it("installs nothing and loads no editor api while the flag is unset", () => {
    const loadEditorApi = vi.fn(() => Promise.resolve(fakeEditorApi([], 0)));
    mountBridgeHost(loadEditorApi, silentHost());

    expect(loadEditorApi).not.toHaveBeenCalled();
    expect(window.__codevoPerf).toBeUndefined();
  });

  it("wires the bridge to the workbench host once enabled", async () => {
    window.localStorage.setItem("codevo.perfBridge", "1");
    const clearLatencyMetrics = vi.fn();
    const setActivePath = vi.fn();
    mountBridgeHost(() => Promise.resolve(fakeEditorApi([], 0)), {
      getLatencySnapshot: () => [
        { kind: "completion", stats: { count: 1, last: 4, min: 4, max: 4, median: 4, p95: 4 } },
      ],
      clearLatencyMetrics,
      setActivePath,
      quickOpenLoading: false,
      setQuickOpenOpen: () => {},
      setQuickOpenQuery: () => {},
    });
    await waitForBridge();

    expect(window.__codevoPerf!.getLatencySnapshot()).toHaveLength(1);
    window.__codevoPerf!.clearLatencyMetrics();
    await window.__codevoPerf!.measureTabSwitches(["/a.ts"]);

    expect(clearLatencyMetrics).toHaveBeenCalledTimes(1);
    expect(setActivePath).toHaveBeenCalledWith("/a.ts");
  });

  it("prefers the focused editor and reports retained monaco counts", async () => {
    window.localStorage.setItem("codevo.perfBridge", "1");
    const ranOnUnfocused: string[] = [];
    const ranOnFocused: string[] = [];
    const unfocused = fakeEditor(false, ranOnUnfocused);
    const focused = fakeEditor(true, ranOnFocused);
    mountBridgeHost(() => Promise.resolve(fakeEditorApi([unfocused, focused], 3)), silentHost());
    await waitForBridge();

    await expect(
      window.__codevoPerf!.runEditorAction("editor.action.formatDocument"),
    ).resolves.toBe(true);

    expect(ranOnFocused).toEqual(["editor.action.formatDocument"]);
    expect(ranOnUnfocused).toEqual([]);
    expect(window.__codevoPerf!.getRetainedCounts()).toEqual({ models: 3, editors: 2 });
  });

  it("drives the host quick open surface on real animation frames", async () => {
    window.localStorage.setItem("codevo.perfBridge", "1");
    const trace: QuickOpenTrace = { opened: [], queries: [] };
    mountBridgeHost(() => Promise.resolve(fakeEditorApi([], 0)), quickOpenHost(trace, 2));
    await waitForBridge();

    const settled = await resolveInReactAct(() =>
      window.__codevoPerf!.runQuickOpenQuery("moduleA"),
    );

    expect(settled).toBe(true);
    expect(trace.queries).toEqual(["moduleA"]);
    expect(trace.opened).toEqual([true, false]);
  }, 20000);

  it("keeps reading the latest committed host after a re-render", async () => {
    window.localStorage.setItem("codevo.perfBridge", "1");
    const renamedSnapshot = [
      { kind: "rename" as const, stats: { count: 2, last: 8, min: 8, max: 8, median: 8, p95: 8 } },
    ];
    const renderHostProbe = mountHostProbe(silentHost());
    await waitForBridge();

    expect(window.__codevoPerf!.getLatencySnapshot()).toEqual([]);

    renderHostProbe({ ...silentHost(), getLatencySnapshot: () => renamedSnapshot });

    expect(window.__codevoPerf!.getLatencySnapshot()).toEqual(renamedSnapshot);
  }, 20000);

  it("removes the bridge on unmount", async () => {
    window.localStorage.setItem("codevo.perfBridge", "1");
    mountBridgeHost(() => Promise.resolve(fakeEditorApi([], 0)), silentHost());
    await waitForBridge();

    const root = mountedRoot;
    mountedRoot = null;
    act(() => {
      root?.unmount();
    });

    expect(window.__codevoPerf).toBeUndefined();
  });

  it("never installs when the host unmounts before the editor api resolves", async () => {
    window.localStorage.setItem("codevo.perfBridge", "1");
    let resolveEditorApi: ((api: PerfMonacoEditorApi) => void) | null = null;
    mountBridgeHost(
      () =>
        new Promise<PerfMonacoEditorApi>((resolve) => {
          resolveEditorApi = resolve;
        }),
      silentHost(),
    );

    const root = mountedRoot;
    mountedRoot = null;
    act(() => {
      root?.unmount();
    });

    expect(resolveEditorApi).not.toBeNull();
    await act(async () => {
      resolveEditorApi?.(fakeEditorApi([], 0));
      await Promise.resolve();
    });

    expect(window.__codevoPerf).toBeUndefined();
  });
});
