// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createLatencyTracker } from "../domain/latencyTracker";
import type { FileSearchResponse, FileSearchResult } from "../domain/workspace";
import {
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
    vi.useFakeTimers();
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

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
    vi.useRealTimers();
  });

  it("does not leak workspace A MRU entries into workspace B", async () => {
    vi.useFakeTimers();
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    const depsB = makeDeps({
      activePath: "/workspace-b/src/Active.ts",
      recentFiles: [
        { name: "Active.ts", path: "/workspace-b/src/Active.ts" },
        { name: "OnlyB.ts", path: "/workspace-b/src/OnlyB.ts" },
      ],
      workspaceRoot: "/workspace-b",
    });
    harness.rerender(depsB);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    expect(harness.quickOpen().quickOpenResults.map((entry) => entry.path)).toEqual([
      "/workspace-b/src/OnlyB.ts",
    ]);
    expect(harness.quickOpen().quickOpenResults).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/workspace-a/src/OnlyA.ts" })]),
    );

    harness.unmount();
    vi.useRealTimers();
  });

  it("drops MRU results when the workspace is closed", async () => {
    vi.useFakeTimers();
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(harness.quickOpen().quickOpenResults).toHaveLength(1);

    harness.rerender({
      ...deps,
      activePath: null,
      recentFiles: [],
      workspaceRoot: null,
    });

    expect(harness.quickOpen().quickOpenResults).toEqual([]);

    harness.unmount();
    vi.useRealTimers();
  });

  it("searches a path location by its path and retains the parsed position", async () => {
    vi.useFakeTimers();
    const searchFiles = vi.fn(async () => []);
    const deps = makeDeps({ fileSearch: { searchFiles } });
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("src/foo.ts:42:7");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    expect(searchFiles).toHaveBeenLastCalledWith("/workspace", "src/foo.ts", 80);
    expect(harness.quickOpen().quickOpenRequest).toEqual({
      kind: "fileLocation",
      column: 7,
      line: 42,
      pathQuery: "src/foo.ts",
    });

    harness.unmount();
    vi.useRealTimers();
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
    vi.useFakeTimers();
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    expect(harness.quickOpen().quickOpenTruncated).toBe(true);

    harness.unmount();
    vi.useRealTimers();
  });

  it("treats A-B-A searches as distinct generations and drops late responses", async () => {
    vi.useFakeTimers();
    const searchA1 = deferred<FileSearchResponse>();
    const searchB = deferred<FileSearchResponse>();
    const searchA2 = deferred<FileSearchResponse>();
    const searchFilesWithMetadata = vi
      .fn()
      .mockImplementationOnce(() => searchA1.promise)
      .mockImplementationOnce(() => searchB.promise)
      .mockImplementationOnce(() => searchA2.promise);
    const depsA = makeDeps({
      fileSearch: { searchFiles: vi.fn(async () => []), searchFilesWithMetadata },
      workspaceRoot: "/workspace-a",
    });
    const harness = renderQuickOpen(depsA);
    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
      harness.quickOpen().setQuickOpenQuery("needle");
    });
    await act(async () => vi.advanceTimersByTimeAsync(120));
    const generationA1 = searchFilesWithMetadata.mock.calls[0]?.[3] as string;

    const depsB = { ...depsA, workspaceRoot: "/workspace-b" };
    harness.rerender(depsB);
    await act(async () => vi.advanceTimersByTimeAsync(120));
    const generationB = searchFilesWithMetadata.mock.calls[1]?.[3] as string;

    harness.rerender(depsA);
    await act(async () => vi.advanceTimersByTimeAsync(120));
    const generationA2 = searchFilesWithMetadata.mock.calls[2]?.[3] as string;
    expect(new Set([generationA1, generationB, generationA2]).size).toBe(3);

    await act(async () => {
      searchA1.resolve({
        requestGeneration: generationA1,
        results: [file("/workspace-a/stale-a.ts")],
        truncated: false,
      });
      searchB.resolve({
        requestGeneration: generationB,
        results: [file("/workspace-b/stale-b.ts")],
        truncated: false,
      });
      await Promise.resolve();
    });
    expect(harness.quickOpen().quickOpenResults).toEqual([]);

    await act(async () => {
      searchA2.resolve({
        requestGeneration: generationA2,
        results: [file("/workspace-a/fresh.ts")],
        truncated: false,
      });
      await Promise.resolve();
    });
    expect(harness.quickOpen().quickOpenResults.map((result) => result.path)).toEqual([
      "/workspace-a/fresh.ts",
    ]);

    harness.unmount();
    vi.useRealTimers();
  });

  it("rejects a current response with a foreign request generation", async () => {
    vi.useFakeTimers();
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
    await act(async () => vi.advanceTimersByTimeAsync(120));

    expect(harness.quickOpen().quickOpenResults).toEqual([]);
    expect(harness.quickOpen().quickOpenTruncated).toBe(false);
    expect(reportError).toHaveBeenCalledWith(
      "Quick Open",
      expect.objectContaining({ message: "File search returned a mismatched request generation." }),
    );

    harness.unmount();
    vi.useRealTimers();
  });
});

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
