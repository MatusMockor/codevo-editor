// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLatencyTracker } from "../domain/latencyTracker";
import type { FileSearchResponse, FileSearchResult } from "../domain/workspace";
import {
  QUICK_OPEN_SEARCH_TIMEOUT_MS,
  useWorkbenchQuickOpen,
  type WorkbenchQuickOpen,
  type WorkbenchQuickOpenDependencies,
} from "./useWorkbenchQuickOpen";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function makeDeps(
  overrides: Partial<WorkbenchQuickOpenDependencies> = {},
): WorkbenchQuickOpenDependencies {
  return {
    fileSearch: {
      searchFiles: vi.fn(async () => []),
    },
    latencyTrackerForRoot: () => createLatencyTracker(),
    reportError: vi.fn(),
    activePath: null,
    recentFiles: [],
    setMessage: vi.fn(),
    workspaceRoot: "/workspace",
    ...overrides,
  };
}

interface Harness {
  quickOpen: () => WorkbenchQuickOpen;
  rerender(deps: WorkbenchQuickOpenDependencies): void;
  unmount(): void;
}

function renderQuickOpen(deps: WorkbenchQuickOpenDependencies): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { quickOpen: WorkbenchQuickOpen | null } = {
    quickOpen: null,
  };

  function HarnessComponent({ deps }: { deps: WorkbenchQuickOpenDependencies }) {
    captured.quickOpen = useWorkbenchQuickOpen(deps);
    return null;
  }

  act(() => {
    root.render(<HarnessComponent deps={deps} />);
  });

  return {
    quickOpen: () => {
      if (!captured.quickOpen) {
        throw new Error("Quick Open hook is not mounted");
      }

      return captured.quickOpen;
    },
    rerender: (nextDeps) => {
      act(() => {
        root.render(<HarnessComponent deps={nextDeps} />);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useWorkbenchQuickOpen", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears transient workbench messages when Quick Open closes", () => {
    const deps = makeDeps();
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
    });

    expect(deps.setMessage).not.toHaveBeenCalled();

    act(() => {
      harness.quickOpen().setQuickOpenOpen(false);
    });

    expect(deps.setMessage).toHaveBeenCalledWith(null);

    harness.unmount();
  });

  it("updates merged results when a document is activated", async () => {
    const backendResult: FileSearchResult = {
      name: "UserModel.ts",
      path: "/workspace/src/UserModel.ts",
      relativePath: "src/UserModel.ts",
    };
    const deps = makeDeps({
      fileSearch: {
        searchFiles: vi.fn(async () => [backendResult]),
      },
    });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("user");
    });
    await settleSearch();

    harness.rerender({
      ...deps,
      activePath: "/workspace/src/UserController.ts",
      recentFiles: [
        { name: "UserController.ts", path: "/workspace/src/UserController.ts" },
        { name: "UserService.ts", path: "/workspace/src/UserService.ts" },
      ],
    });

    expect(harness.quickOpen().quickOpenResults.map((entry) => entry.path)).toEqual([
      "/workspace/src/UserService.ts",
      "/workspace/src/UserModel.ts",
    ]);

    harness.unmount();
  });

  it("does not leak workspace A MRU entries into workspace B", async () => {
    const depsA = makeDeps({
      activePath: "/workspace-a/src/Active.ts",
      recentFiles: [
        { name: "Active.ts", path: "/workspace-a/src/Active.ts" },
        { name: "OnlyA.ts", path: "/workspace-a/src/OnlyA.ts" },
      ],
      workspaceRoot: "/workspace-a",
    });
    const harness = renderQuickOpen(depsA);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
    });
    await settleSearch();

    const depsB = makeDeps({
      activePath: "/workspace-b/src/Active.ts",
      recentFiles: [
        { name: "Active.ts", path: "/workspace-b/src/Active.ts" },
        { name: "OnlyB.ts", path: "/workspace-b/src/OnlyB.ts" },
      ],
      workspaceRoot: "/workspace-b",
    });
    harness.rerender(depsB);
    await settleSearch();

    expect(harness.quickOpen().quickOpenResults.map((entry) => entry.path)).toEqual([
      "/workspace-b/src/OnlyB.ts",
    ]);
    expect(harness.quickOpen().quickOpenResults).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/workspace-a/src/OnlyA.ts" })]),
    );

    harness.unmount();
  });

  it("drops MRU results when the workspace is closed", async () => {
    const deps = makeDeps({
      activePath: "/workspace/src/Active.ts",
      recentFiles: [
        { name: "Active.ts", path: "/workspace/src/Active.ts" },
        { name: "Previous.ts", path: "/workspace/src/Previous.ts" },
      ],
    });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
    });
    await settleSearch();
    expect(harness.quickOpen().quickOpenResults).toHaveLength(1);

    harness.rerender({
      ...deps,
      activePath: null,
      recentFiles: [],
      workspaceRoot: null,
    });

    expect(harness.quickOpen().quickOpenResults).toEqual([]);

    harness.unmount();
  });

  it("searches a path location by its path and retains the parsed position", async () => {
    const searchFiles = vi.fn(async () => []);
    const deps = makeDeps({ fileSearch: { searchFiles } });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("src/foo.ts:42:7");
    });
    await settleSearch();

    expect(searchFiles).toHaveBeenLastCalledWith("/workspace", "src/foo.ts", 80);
    expect(harness.quickOpen().quickOpenRequest).toEqual({
      kind: "fileLocation",
      column: 7,
      line: 42,
      pathQuery: "src/foo.ts",
    });

    harness.unmount();
  });

  it.each([
    ["@method", "openCurrentFileSymbols", "method"],
    [">Toggle Terminal", "openCommands", "Toggle Terminal"],
    ["#handler", "openWorkspaceSymbols", "handler"],
  ] as const)("preserves the parsed seed when pasted as %s", (input, callback, seed) => {
    const route = vi.fn();
    const deps = makeDeps({ [callback]: route });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery(input);
    });

    expect(route).toHaveBeenCalledWith(seed);
    expect(harness.quickOpen().quickOpenOpen).toBe(false);

    harness.unmount();
  });

  it("dispatches a typed workspace-symbol prefix without a seed query", () => {
    const openWorkspaceSymbols = vi.fn();
    const deps = makeDeps({ openWorkspaceSymbols });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
    });
    act(() => {
      harness.quickOpen().setQuickOpenQuery((current) => `${current}#`);
    });

    expect(openWorkspaceSymbols).toHaveBeenCalledWith("");
    expect(harness.quickOpen().quickOpenOpen).toBe(false);

    harness.unmount();
  });

  it("keeps a bare line open until the user confirms it", () => {
    const deps = makeDeps();
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery(":42");
    });

    expect(harness.quickOpen().quickOpenOpen).toBe(true);

    harness.unmount();
  });

  it("surfaces backend walk truncation independently of the result count", async () => {
    const deps = makeDeps({
      fileSearch: {
        searchFiles: vi.fn(async () => []),
        searchFilesWithMetadata: vi.fn(async (_root, _query, _limit, requestGeneration = "") => ({
          requestGeneration,
          results: [],
          truncated: true,
        })),
      },
    });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("needle");
    });
    await settleSearch();

    expect(harness.quickOpen().quickOpenTruncated).toBe(true);

    harness.unmount();
  });

  it("treats A-B-A searches as distinct generations and drops late responses", async () => {
    const gateway = deferredSearchGateway();
    const depsA = makeDeps({ fileSearch: gateway.fileSearch, workspaceRoot: "/workspace-a" });
    const harness = renderQuickOpen(depsA);
    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("needle");
    });
    await settleSearch();
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]?.root).toBe("/workspace-a");

    harness.rerender({ ...depsA, workspaceRoot: "/workspace-b" });
    await settleSearch();
    expect(gateway.calls).toHaveLength(1);
    expect(harness.quickOpen().quickOpenLoading).toBe(true);

    await act(async () => {
      gateway.calls[0]?.resolve({
        requestGeneration: gateway.calls[0].requestGeneration,
        results: [file("/workspace-a/stale-a.ts")],
        truncated: false,
      });
    });
    await settleSearch();
    expect(harness.quickOpen().quickOpenResults).toEqual([]);
    expect(gateway.calls).toHaveLength(2);
    expect(gateway.calls[1]?.root).toBe("/workspace-b");

    harness.rerender(depsA);
    await settleSearch();
    expect(gateway.calls).toHaveLength(2);

    await act(async () => {
      gateway.calls[1]?.resolve({
        requestGeneration: gateway.calls[1].requestGeneration,
        results: [file("/workspace-b/stale-b.ts")],
        truncated: false,
      });
    });
    await settleSearch();
    expect(harness.quickOpen().quickOpenResults).toEqual([]);
    expect(gateway.calls).toHaveLength(3);
    expect(gateway.calls[2]?.root).toBe("/workspace-a");

    await act(async () => {
      gateway.calls[2]?.resolve({
        requestGeneration: gateway.calls[2].requestGeneration,
        results: [file("/workspace-a/fresh.ts")],
        truncated: false,
      });
    });
    await settleSearch();
    expect(harness.quickOpen().quickOpenResults.map((result) => result.path)).toEqual([
      "/workspace-a/fresh.ts",
    ]);
    expect(harness.quickOpen().quickOpenLoading).toBe(false);
    expect(new Set(gateway.calls.map((call) => call.requestGeneration)).size).toBe(3);

    harness.unmount();
  });

  it("rejects a current response with a foreign request generation", async () => {
    const reportError = vi.fn();
    const deps = makeDeps({
      fileSearch: {
        searchFiles: vi.fn(async () => []),
        searchFilesWithMetadata: vi.fn(async () => ({
          requestGeneration: "foreign",
          results: [file("/workspace/stale.ts")],
          truncated: true,
        })),
      },
      reportError,
    });
    const harness = renderQuickOpen(deps);
    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("stale");
    });
    await settleSearch();

    expect(harness.quickOpen().quickOpenResults).toEqual([]);
    expect(harness.quickOpen().quickOpenTruncated).toBe(false);
    expect(reportError).toHaveBeenCalledWith(
      "Quick Open",
      expect.objectContaining({ message: "File search returned a mismatched request generation." }),
    );

    harness.unmount();
  });

  it("records a file-search engine probe sample with the query and result count", async () => {
    const record = vi.fn();
    window.__codevoPerfProbe = { record, renameApplySuppressed: () => false };
    const deps = makeDeps({
      fileSearch: {
        searchFiles: vi.fn(async () => [
          file("/workspace/src/moduleA.ts"),
          file("/workspace/src/moduleA.test.ts"),
        ]),
      },
    });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("moduleA");
    });
    await settleSearch();

    expect(record).toHaveBeenCalledTimes(1);
    const [kind, sample] = record.mock.calls[0];
    expect(kind).toBe("fileSearchEngine");
    expect(sample.target).toBe("moduleA");
    expect(sample.resultCount).toBe(2);
    expect(Number.isFinite(sample.ms)).toBe(true);
    expect(sample.ms).toBeGreaterThanOrEqual(0);

    harness.unmount();
    delete window.__codevoPerfProbe;
  });

  it("records no engine probe sample when no probe is installed", async () => {
    const deps = makeDeps({
      fileSearch: {
        searchFiles: vi.fn(async () => [file("/workspace/src/moduleA.ts")]),
      },
    });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("moduleA");
    });
    await settleSearch();

    expect(harness.quickOpen().quickOpenResults.length).toBeGreaterThan(0);

    harness.unmount();
  });

  it("dispatches the first keystroke without waiting for a debounce timer", async () => {
    vi.useFakeTimers();
    const searchFiles = vi.fn(async () => []);
    const deps = makeDeps({ fileSearch: { searchFiles } });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("needle");
    });

    expect(searchFiles).toHaveBeenCalledTimes(1);
    expect(searchFiles).toHaveBeenLastCalledWith("/workspace", "needle", 80);
    expect(harness.quickOpen().quickOpenLoading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(240);
    });

    expect(searchFiles).toHaveBeenCalledTimes(1);
    expect(harness.quickOpen().quickOpenLoading).toBe(false);

    harness.unmount();
  });

  it("publishes only the final query of a keystroke storm", async () => {
    const gateway = deferredSearchGateway();
    const deps = makeDeps({ fileSearch: gateway.fileSearch });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("m");
    });
    expect(gateway.calls.map((call) => call.query)).toEqual(["m"]);

    for (const keystroke of ["mo", "mod", "modu", "module"]) {
      act(() => {
        harness.quickOpen().setQuickOpenQuery(keystroke);
      });
      expect(gateway.calls).toHaveLength(1);
      expect(harness.quickOpen().quickOpenLoading).toBe(true);
    }

    await act(async () => {
      gateway.calls[0]?.resolve({
        requestGeneration: gateway.calls[0].requestGeneration,
        results: [file("/workspace/src/m.ts")],
        truncated: false,
      });
    });
    await settleSearch();

    expect(harness.quickOpen().quickOpenResults).toEqual([]);
    expect(harness.quickOpen().quickOpenLoading).toBe(true);
    expect(gateway.calls.map((call) => call.query)).toEqual(["m", "module"]);

    await act(async () => {
      gateway.calls[1]?.resolve({
        requestGeneration: gateway.calls[1].requestGeneration,
        results: [file("/workspace/src/module.ts")],
        truncated: false,
      });
    });
    await settleSearch();

    expect(harness.quickOpen().quickOpenResults.map((result) => result.path)).toEqual([
      "/workspace/src/module.ts",
    ]);
    expect(harness.quickOpen().quickOpenLoading).toBe(false);
    expect(gateway.calls).toHaveLength(2);

    harness.unmount();
  });

  it("drops a queued query when Quick Open closes before the in-flight search settles", async () => {
    const gateway = deferredSearchGateway();
    const deps = makeDeps({ fileSearch: gateway.fileSearch });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("first");
    });
    act(() => {
      harness.quickOpen().setQuickOpenQuery("second");
    });
    expect(gateway.calls).toHaveLength(1);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(false);
    });
    expect(harness.quickOpen().quickOpenLoading).toBe(false);

    await act(async () => {
      gateway.calls[0]?.resolve({
        requestGeneration: gateway.calls[0].requestGeneration,
        results: [file("/workspace/src/first.ts")],
        truncated: false,
      });
    });
    await settleSearch();

    expect(gateway.calls).toHaveLength(1);
    expect(harness.quickOpen().quickOpenResults).toEqual([]);
    expect(harness.quickOpen().quickOpenLoading).toBe(false);

    harness.unmount();
  });

  it("drops a queued query when the hook unmounts before the in-flight search settles", async () => {
    const gateway = deferredSearchGateway();
    const deps = makeDeps({ fileSearch: gateway.fileSearch });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("first");
    });
    act(() => {
      harness.quickOpen().setQuickOpenQuery("second");
    });
    expect(gateway.calls).toHaveLength(1);

    harness.unmount();

    await act(async () => {
      gateway.calls[0]?.resolve({
        requestGeneration: gateway.calls[0].requestGeneration,
        results: [file("/workspace/src/first.ts")],
        truncated: false,
      });
    });
    await settleSearch();

    expect(gateway.calls).toHaveLength(1);
    expect(deps.setMessage).not.toHaveBeenCalledWith(null);
  });

  it("releases the dispatch slot to the queued query when a search never settles", async () => {
    vi.useFakeTimers();
    const gateway = deferredSearchGateway();
    const deps = makeDeps({ fileSearch: gateway.fileSearch });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("hung");
    });
    act(() => {
      harness.quickOpen().setQuickOpenQuery("next");
    });
    expect(gateway.calls.map((call) => call.query)).toEqual(["hung"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUICK_OPEN_SEARCH_TIMEOUT_MS);
    });

    expect(gateway.calls.map((call) => call.query)).toEqual(["hung", "next"]);
    expect(harness.quickOpen().quickOpenLoading).toBe(true);

    await act(async () => {
      gateway.calls[0]?.resolve({
        requestGeneration: gateway.calls[0].requestGeneration,
        results: [file("/workspace/src/hung.ts")],
        truncated: false,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(harness.quickOpen().quickOpenResults).toEqual([]);

    await act(async () => {
      gateway.calls[1]?.resolve({
        requestGeneration: gateway.calls[1].requestGeneration,
        results: [file("/workspace/src/next.ts")],
        truncated: false,
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(harness.quickOpen().quickOpenResults.map((result) => result.path)).toEqual([
      "/workspace/src/next.ts",
    ]);
    expect(harness.quickOpen().quickOpenLoading).toBe(false);
    expect(gateway.calls).toHaveLength(2);

    harness.unmount();
    vi.useRealTimers();
  });

  it("reports a timed-out search and accepts a later query instead of its late payload", async () => {
    vi.useFakeTimers();
    const reportError = vi.fn();
    const gateway = deferredSearchGateway();
    const deps = makeDeps({ fileSearch: gateway.fileSearch, reportError });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("hung");
    });
    expect(harness.quickOpen().quickOpenLoading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUICK_OPEN_SEARCH_TIMEOUT_MS);
    });

    expect(harness.quickOpen().quickOpenLoading).toBe(false);
    expect(harness.quickOpen().quickOpenResults).toEqual([]);
    expect(reportError).toHaveBeenCalledWith(
      "Quick Open",
      expect.objectContaining({ message: "File search timed out." }),
    );
    expect(gateway.calls).toHaveLength(1);

    await act(async () => {
      gateway.calls[0]?.resolve({
        requestGeneration: gateway.calls[0].requestGeneration,
        results: [file("/workspace/src/hung.ts")],
        truncated: false,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(harness.quickOpen().quickOpenResults).toEqual([]);

    act(() => {
      harness.quickOpen().setQuickOpenQuery("after");
    });
    expect(gateway.calls.map((call) => call.query)).toEqual(["hung", "after"]);
    expect(harness.quickOpen().quickOpenLoading).toBe(true);

    await act(async () => {
      gateway.calls[1]?.resolve({
        requestGeneration: gateway.calls[1].requestGeneration,
        results: [file("/workspace/src/after.ts")],
        truncated: false,
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(harness.quickOpen().quickOpenResults.map((result) => result.path)).toEqual([
      "/workspace/src/after.ts",
    ]);
    expect(harness.quickOpen().quickOpenLoading).toBe(false);

    harness.unmount();
    vi.useRealTimers();
  });

  it("dispatches a single empty-query search when Quick Open opens", async () => {
    const gateway = deferredSearchGateway();
    const deps = makeDeps({ fileSearch: gateway.fileSearch });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
    });

    expect(gateway.calls.map((call) => call.query)).toEqual([""]);

    await act(async () => {
      gateway.calls[0]?.resolve({
        requestGeneration: gateway.calls[0].requestGeneration,
        results: [file("/workspace/src/recent.ts")],
        truncated: false,
      });
    });
    await settleSearch();

    expect(harness.quickOpen().quickOpenResults.map((result) => result.path)).toEqual([
      "/workspace/src/recent.ts",
    ]);
    expect(harness.quickOpen().quickOpenLoading).toBe(false);
    expect(gateway.calls).toHaveLength(1);

    harness.unmount();
  });
});

async function settleSearch(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

interface DeferredSearchCall {
  query: string;
  requestGeneration: string;
  resolve: (value: FileSearchResponse) => void;
  root: string;
}

function deferredSearchGateway() {
  const calls: DeferredSearchCall[] = [];
  const searchFilesWithMetadata = vi.fn(
    (root: string, query: string, _limit: number, requestGeneration = "") => {
      const pending = deferred<FileSearchResponse>();
      calls.push({ query, requestGeneration, resolve: pending.resolve, root });
      return pending.promise;
    },
  );

  return {
    calls,
    fileSearch: { searchFiles: vi.fn(async () => []), searchFilesWithMetadata },
  };
}

function file(path: string): FileSearchResult {
  return {
    name: path.split("/").pop() ?? path,
    path,
    relativePath: path.split("/").slice(-1)[0] ?? path,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
