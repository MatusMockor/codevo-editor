// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  useGitStashPanel,
  type GitStashPanel,
  type GitStashPanelDependencies,
} from "./useGitStashPanel";
import type { GitGateway, GitStashEntry, GitStatus } from "../domain/git";
import type { WorkbenchPrompter } from "./workbenchPrompter";

const ROOT = "/workspace";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function status(rootPath: string): GitStatus {
  return { branch: "main", changes: [], isRepository: true, rootPath };
}

/**
 * A GitGateway whose stash surface is overridable per test. Only the methods the
 * panel actually calls are stubbed; the rest are cast away since the hook never
 * touches them (real git is never invoked).
 */
function createFakeGitGateway(overrides: Partial<GitGateway> = {}): GitGateway {
  const base = {
    getStatus: vi.fn(async (rootPath: string) => status(rootPath)),
    stashSave: vi.fn(async () => undefined),
    stashList: vi.fn(async () => [] as GitStashEntry[]),
    stashApply: vi.fn(async () => undefined),
    stashPop: vi.fn(async () => undefined),
    stashShow: vi.fn(async () => ""),
    stashDrop: vi.fn(async () => undefined),
    branchList: vi.fn(async () => []),
    createBranch: vi.fn(async () => undefined),
    switchBranch: vi.fn(async () => undefined),
  };
  return { ...base, ...overrides } as unknown as GitGateway;
}

function stashEntry(index: number, message: string): GitStashEntry {
  return { branch: "main", index, message, timestamp: 1700000000 + index };
}

interface Harness {
  panel: () => GitStashPanel;
  ref: { current: string | null };
  reportError: ReturnType<typeof vi.fn>;
  refreshGitStatus: ReturnType<typeof vi.fn>;
  setMessage: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderStashPanel(
  overrides: Partial<GitStashPanelDependencies> = {},
): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { panel: GitStashPanel | null } = { panel: null };

  const ref: { current: string | null } = { current: ROOT };
  const reportError = vi.fn();
  const refreshGitStatus = vi.fn(async () => undefined);
  const setMessage = vi.fn();
  const prompter: WorkbenchPrompter = {
    confirm: vi.fn(() => true),
    prompt: vi.fn(() => null),
  };

  const deps: GitStashPanelDependencies = {
    gitGateway: createFakeGitGateway(),
    currentWorkspaceRootRef: ref,
    workspaceRoot: ROOT,
    reportError,
    refreshGitStatus,
    setMessage,
    prompter,
    ...overrides,
  };

  function Harness() {
    captured.panel = useGitStashPanel(deps);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    panel: () => {
      if (!captured.panel) {
        throw new Error("panel not mounted");
      }
      return captured.panel;
    },
    ref,
    reportError,
    refreshGitStatus,
    setMessage,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useGitStashPanel", () => {
  it("opens the panel, lists stashes, and loads a selected stash diff", async () => {
    const stashList = vi.fn(async () => [
      stashEntry(0, "WIP a"),
      stashEntry(1, "WIP b"),
    ]);
    const stashShow = vi.fn(async () => "diff --git a/file b/file\n+two");
    const harness = renderStashPanel({
      gitGateway: createFakeGitGateway({ stashList, stashShow }),
    });

    await act(async () => {
      await harness.panel().openGitStashPanel();
    });

    expect(stashList).toHaveBeenCalledWith(ROOT);
    expect(harness.panel().gitStashPanelOpen).toBe(true);
    expect(harness.panel().gitStashEntries).toHaveLength(2);
    expect(harness.panel().gitStashLoading).toBe(false);

    await act(async () => {
      await harness.panel().selectGitStash(1);
    });

    expect(stashShow).toHaveBeenCalledWith(ROOT, 1);
    expect(harness.panel().gitStashSelectedIndex).toBe(1);
    expect(harness.panel().gitStashDiff).toContain("+two");

    harness.unmount();
  });

  it("trims the message, saves the stash, then refreshes the list and status", async () => {
    let listCalls = 0;
    const stashList = vi.fn(async () => {
      listCalls += 1;
      return listCalls < 2 ? [] : [stashEntry(0, "WIP")];
    });
    const stashSave = vi.fn(async () => undefined);
    const harness = renderStashPanel({
      gitGateway: createFakeGitGateway({ stashList, stashSave }),
    });

    await act(async () => {
      await harness.panel().openGitStashPanel();
    });
    await act(async () => {
      await harness.panel().saveGitStash("  work in progress  ");
    });

    expect(stashSave).toHaveBeenCalledWith(ROOT, "work in progress");
    expect(harness.refreshGitStatus).toHaveBeenCalled();
    expect(harness.setMessage).toHaveBeenCalledWith(
      "Stashed working tree changes",
    );
    expect(harness.panel().gitStashEntries).toHaveLength(1);

    harness.unmount();
  });

  it("ignores a blank stash message", async () => {
    const stashSave = vi.fn(async () => undefined);
    const harness = renderStashPanel({
      gitGateway: createFakeGitGateway({ stashSave }),
    });

    await act(async () => {
      await harness.panel().saveGitStash("   ");
    });

    expect(stashSave).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("applies a stash and refreshes status without blanking the list", async () => {
    const stashApply = vi.fn(async () => undefined);
    const stashList = vi.fn(async () => [stashEntry(0, "WIP")]);
    const harness = renderStashPanel({
      gitGateway: createFakeGitGateway({ stashApply, stashList }),
    });

    await act(async () => {
      await harness.panel().openGitStashPanel();
    });
    await act(async () => {
      await harness.panel().applyGitStash(0);
    });

    expect(stashApply).toHaveBeenCalledWith(ROOT, 0);
    expect(harness.refreshGitStatus).toHaveBeenCalled();
    expect(harness.panel().gitStashEntries).toHaveLength(1);
    expect(harness.panel().gitStashLoading).toBe(false);
    harness.unmount();
  });

  it("pops a stash, clearing the selection and diff", async () => {
    let listCalls = 0;
    const stashList = vi.fn(async () => {
      listCalls += 1;
      return listCalls < 2 ? [stashEntry(0, "WIP")] : [];
    });
    const stashPop = vi.fn(async () => undefined);
    const stashShow = vi.fn(async () => "diff");
    const harness = renderStashPanel({
      gitGateway: createFakeGitGateway({ stashList, stashPop, stashShow }),
    });

    await act(async () => {
      await harness.panel().openGitStashPanel();
    });
    await act(async () => {
      await harness.panel().selectGitStash(0);
    });
    await act(async () => {
      await harness.panel().popGitStash(0);
    });

    expect(stashPop).toHaveBeenCalledWith(ROOT, 0);
    expect(harness.panel().gitStashSelectedIndex).toBeNull();
    expect(harness.panel().gitStashDiff).toBeNull();
    expect(harness.panel().gitStashEntries).toEqual([]);
    harness.unmount();
  });

  it("does not drop a stash when the destructive confirmation is declined", async () => {
    const stashDrop = vi.fn(async () => undefined);
    const confirm = vi.fn(() => false);
    const harness = renderStashPanel({
      gitGateway: createFakeGitGateway({ stashDrop }),
      prompter: { confirm, prompt: vi.fn(() => null) },
    });

    await act(async () => {
      await harness.panel().dropGitStash(0);
    });

    expect(confirm).toHaveBeenCalled();
    expect(stashDrop).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops a stash only after the destructive confirmation is accepted", async () => {
    const stashDrop = vi.fn(async () => undefined);
    const confirm = vi.fn(() => true);
    const harness = renderStashPanel({
      gitGateway: createFakeGitGateway({ stashDrop }),
      prompter: { confirm, prompt: vi.fn(() => null) },
    });

    await act(async () => {
      await harness.panel().dropGitStash(0);
    });

    expect(confirm).toHaveBeenCalled();
    expect(stashDrop).toHaveBeenCalledWith(ROOT, 0);
    harness.unmount();
  });

  it("drops a stale list result after the panel is closed", async () => {
    const deferred = createDeferred<GitStashEntry[]>();
    const stashList = vi.fn(() => deferred.promise);
    const harness = renderStashPanel({
      gitGateway: createFakeGitGateway({ stashList }),
    });

    let openPromise: Promise<void> | null = null;
    act(() => {
      openPromise = harness.panel().openGitStashPanel();
    });

    await act(async () => {
      harness.panel().closeGitStashPanel();
      await Promise.resolve();
    });

    await act(async () => {
      deferred.resolve([stashEntry(0, "stale")]);
      await openPromise;
    });

    expect(harness.panel().gitStashPanelOpen).toBe(false);
    expect(harness.panel().gitStashEntries).toEqual([]);
    harness.unmount();
  });

  it("keeps only the last diff when selections race (per-selection last-wins)", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const calls = [first, second];
    let call = 0;
    const stashShow = vi.fn(() => calls[call++].promise);
    const harness = renderStashPanel({
      gitGateway: createFakeGitGateway({ stashShow }),
    });

    let firstSelect: Promise<void> | null = null;
    let secondSelect: Promise<void> | null = null;
    act(() => {
      firstSelect = harness.panel().selectGitStash(0);
      secondSelect = harness.panel().selectGitStash(1);
    });

    await act(async () => {
      // Resolve the superseded (first) request last; its result must be dropped.
      second.resolve("second diff");
      await secondSelect;
      first.resolve("first diff");
      await firstSelect;
    });

    expect(harness.panel().gitStashDiff).toBe("second diff");
    expect(harness.panel().gitStashSelectedIndex).toBe(1);
    harness.unmount();
  });

  it("drops a list result whose workspace root changed mid-flight", async () => {
    const deferred = createDeferred<GitStashEntry[]>();
    const stashList = vi.fn(() => deferred.promise);
    const harness = renderStashPanel({
      gitGateway: createFakeGitGateway({ stashList }),
    });

    let openPromise: Promise<void> | null = null;
    act(() => {
      openPromise = harness.panel().openGitStashPanel();
    });

    await act(async () => {
      // The active tab switched away before the list resolves.
      harness.ref.current = "/other";
      deferred.resolve([stashEntry(0, "stale")]);
      await openPromise;
    });

    expect(harness.panel().gitStashEntries).toEqual([]);
    harness.unmount();
  });
});
