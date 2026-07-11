// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createLatencyTracker } from "../domain/latencyTracker";
import type { FileSearchResult } from "../domain/workspace";
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

  function HarnessComponent({
    deps,
  }: {
    deps: WorkbenchQuickOpenDependencies;
  }) {
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
      fileSearch: { searchFiles: vi.fn(async () => [backendResult]) },
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
      expect.arrayContaining([
        expect.objectContaining({ path: "/workspace-a/src/OnlyA.ts" }),
      ]),
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
});
