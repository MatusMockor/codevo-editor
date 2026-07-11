// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  useGitBranchPanel,
  type GitBranchPanel,
  type GitBranchPanelDependencies,
} from "./useGitBranchPanel";
import type { GitBranch, GitGateway, GitStatus } from "../domain/git";
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

function branch(name: string, isCurrent = false): GitBranch {
  return { isCurrent, name };
}

/**
 * A GitGateway whose branch surface is overridable per test. Only the methods
 * the panel actually calls are stubbed; the rest are cast away since the hook
 * never touches them (real git is never invoked).
 */
function createFakeGitGateway(overrides: Partial<GitGateway> = {}): GitGateway {
  const base = {
    getStatus: vi.fn(async (rootPath: string) => status(rootPath)),
    branchList: vi.fn(async () => [] as GitBranch[]),
    createBranch: vi.fn(async () => undefined),
    deleteBranch: vi.fn(async () => undefined),
    renameBranch: vi.fn(async () => undefined),
    switchBranch: vi.fn(async () => undefined),
    stashList: vi.fn(async () => []),
  };
  return { ...base, ...overrides } as unknown as GitGateway;
}

interface Harness {
  panel: () => GitBranchPanel;
  ref: { current: string | null };
  reportError: ReturnType<typeof vi.fn>;
  refreshGitStatus: ReturnType<typeof vi.fn>;
  setMessage: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderBranchPanel(
  overrides: Partial<GitBranchPanelDependencies> = {},
): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { panel: GitBranchPanel | null } = { panel: null };

  const ref: { current: string | null } = { current: ROOT };
  const reportError = vi.fn();
  const refreshGitStatus = vi.fn(async () => undefined);
  const setMessage = vi.fn();
  const prompter: WorkbenchPrompter = {
    confirm: vi.fn(() => true),
    prompt: vi.fn(() => null),
  };

  const deps: GitBranchPanelDependencies = {
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
    captured.panel = useGitBranchPanel(deps);
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

describe("useGitBranchPanel", () => {
  it("opens the panel and lists branches", async () => {
    const branchList = vi.fn(async () => [
      branch("main", true),
      branch("feature/login"),
    ]);
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ branchList }),
    });

    await act(async () => {
      await harness.panel().openGitBranchPanel();
    });

    expect(branchList).toHaveBeenCalledWith(ROOT);
    expect(harness.panel().gitBranchPanelOpen).toBe(true);
    expect(harness.panel().gitBranchEntries).toHaveLength(2);
    expect(harness.panel().gitBranchLoading).toBe(false);
    harness.unmount();
  });

  it("trims the branch name, switches, refreshes status, and closes the panel", async () => {
    const switchBranch = vi.fn(async () => undefined);
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ switchBranch }),
    });

    await act(async () => {
      await harness.panel().openGitBranchPanel();
    });
    await act(async () => {
      await harness.panel().switchGitBranch("  feature/login  ");
    });

    expect(switchBranch).toHaveBeenCalledWith(ROOT, "feature/login");
    expect(harness.setMessage).toHaveBeenCalledWith(
      "Switched to branch feature/login",
    );
    expect(harness.refreshGitStatus).toHaveBeenCalled();
    expect(harness.panel().gitBranchPanelOpen).toBe(false);
    harness.unmount();
  });

  it("surfaces an actionable notice when switching fails on uncommitted changes", async () => {
    const switchBranch = vi.fn(async () => {
      throw new Error("would be overwritten");
    });
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ switchBranch }),
    });

    await act(async () => {
      await harness.panel().switchGitBranch("feature/login");
    });

    expect(harness.reportError).toHaveBeenCalledTimes(1);
    const [source, error] = harness.reportError.mock.calls[0];
    expect(source).toBe("Git Branch");
    expect((error as Error).message).toContain("uncommitted changes");
    expect(harness.panel().gitBranchLoading).toBe(false);
    harness.unmount();
  });

  it("ignores a blank branch name on switch", async () => {
    const switchBranch = vi.fn(async () => undefined);
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ switchBranch }),
    });

    await act(async () => {
      await harness.panel().switchGitBranch("   ");
    });

    expect(switchBranch).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("prompts for a name, creates the branch, and refreshes the list", async () => {
    // After creation the refreshed list reflects the newly created branch.
    const branchList = vi.fn(async () => [branch("feature/new")]);
    const createBranch = vi.fn(async () => undefined);
    const prompt = vi.fn(() => "  feature/new  ");
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ branchList, createBranch }),
      prompter: { confirm: vi.fn(() => true), prompt },
    });

    await act(async () => {
      await harness.panel().createGitBranch();
    });

    expect(prompt).toHaveBeenCalled();
    expect(createBranch).toHaveBeenCalledWith(ROOT, "feature/new");
    expect(harness.setMessage).toHaveBeenCalledWith(
      "Created branch feature/new",
    );
    expect(harness.panel().gitBranchEntries).toHaveLength(1);
    harness.unmount();
  });

  it("does not create a branch when the name prompt is cancelled", async () => {
    const createBranch = vi.fn(async () => undefined);
    const prompt = vi.fn(() => null);
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ createBranch }),
      prompter: { confirm: vi.fn(() => true), prompt },
    });

    await act(async () => {
      await harness.panel().createGitBranch();
    });

    expect(prompt).toHaveBeenCalled();
    expect(createBranch).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("deletes a branch and refreshes the branch list", async () => {
    const branchList = vi.fn(async () => [branch("main", true)]);
    const deleteBranch = vi.fn(async () => undefined);
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ branchList, deleteBranch }),
    });

    await act(async () => {
      await harness.panel().deleteGitBranch(" feature/old ", { force: false });
    });

    expect(deleteBranch).toHaveBeenCalledWith(ROOT, "feature/old", {
      force: false,
    });
    expect(harness.setMessage).toHaveBeenCalledWith(
      "Deleted branch feature/old",
    );
    expect(harness.panel().gitBranchEntries).toEqual([branch("main", true)]);
    harness.unmount();
  });

  it("surfaces the git delete error and does not refresh", async () => {
    const error = new Error("branch is not fully merged");
    const branchList = vi.fn(async () => [] as GitBranch[]);
    const deleteBranch = vi.fn(async () => {
      throw error;
    });
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ branchList, deleteBranch }),
    });

    await act(async () => {
      await harness.panel().deleteGitBranch("feature/work", { force: false });
    });

    expect(harness.reportError).toHaveBeenCalledWith("Git Branch", error);
    expect(branchList).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("renames a branch and refreshes branch state", async () => {
    const branchList = vi.fn(async () => [branch("feature/auth", true)]);
    const renameBranch = vi.fn(async () => undefined);
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ branchList, renameBranch }),
    });

    await act(async () => {
      await harness.panel().renameGitBranch(
        " feature/login ",
        " feature/auth ",
      );
    });

    expect(renameBranch).toHaveBeenCalledWith(
      ROOT,
      "feature/login",
      "feature/auth",
    );
    expect(harness.setMessage).toHaveBeenCalledWith(
      "Renamed branch feature/login to feature/auth",
    );
    expect(harness.refreshGitStatus).toHaveBeenCalledTimes(1);
    expect(harness.panel().gitBranchEntries).toEqual([
      branch("feature/auth", true),
    ]);
    harness.unmount();
  });

  it("ignores a second branch mutation while one is in flight", async () => {
    const deferred = createDeferred<void>();
    const deleteBranch = vi.fn(() => deferred.promise);
    const renameBranch = vi.fn(async () => undefined);
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ deleteBranch, renameBranch }),
    });

    let deletion: Promise<void> | null = null;
    act(() => {
      deletion = harness
        .panel()
        .deleteGitBranch("feature/old", { force: false });
    });
    await act(async () => {
      await harness.panel().renameGitBranch("feature/a", "feature/b");
      deferred.resolve();
      await deletion;
    });

    expect(deleteBranch).toHaveBeenCalledTimes(1);
    expect(renameBranch).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops delete success after the workspace root changes", async () => {
    const deferred = createDeferred<void>();
    const branchList = vi.fn(async () => [] as GitBranch[]);
    const deleteBranch = vi.fn(() => deferred.promise);
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ branchList, deleteBranch }),
    });

    let deletion: Promise<void> | null = null;
    act(() => {
      deletion = harness
        .panel()
        .deleteGitBranch("feature/old", { force: false });
    });
    await act(async () => {
      harness.ref.current = "/other";
      deferred.resolve();
      await deletion;
    });

    expect(harness.setMessage).not.toHaveBeenCalled();
    expect(branchList).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops rename failure after the workspace root changes", async () => {
    const deferred = createDeferred<void>();
    const renameBranch = vi.fn(() => deferred.promise);
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ renameBranch }),
    });

    let rename: Promise<void> | null = null;
    act(() => {
      rename = harness.panel().renameGitBranch("feature/a", "feature/b");
    });
    await act(async () => {
      harness.ref.current = "/other";
      deferred.reject(new Error("already exists"));
      await rename;
    });

    expect(harness.reportError).not.toHaveBeenCalled();
    expect(harness.setMessage).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("clears the panel and invalidates in-flight requests on close", async () => {
    const deferred = createDeferred<GitBranch[]>();
    const branchList = vi.fn(() => deferred.promise);
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ branchList }),
    });

    let openPromise: Promise<void> | null = null;
    act(() => {
      openPromise = harness.panel().openGitBranchPanel();
    });

    await act(async () => {
      harness.panel().closeGitBranchPanel();
      await Promise.resolve();
    });

    await act(async () => {
      deferred.resolve([branch("stale")]);
      await openPromise;
    });

    expect(harness.panel().gitBranchPanelOpen).toBe(false);
    expect(harness.panel().gitBranchEntries).toEqual([]);
    harness.unmount();
  });

  it("keeps only the last branch list when refreshes race (last-wins)", async () => {
    const first = createDeferred<GitBranch[]>();
    const second = createDeferred<GitBranch[]>();
    const calls = [first, second];
    let call = 0;
    const branchList = vi.fn(() => calls[call++].promise);
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ branchList }),
    });

    let firstRefresh: Promise<void> | null = null;
    let secondRefresh: Promise<void> | null = null;
    act(() => {
      firstRefresh = harness.panel().refreshGitBranches();
      secondRefresh = harness.panel().refreshGitBranches();
    });

    await act(async () => {
      // Superseded (first) request resolves last; its result must be dropped.
      second.resolve([branch("winner")]);
      await secondRefresh;
      first.resolve([branch("loser")]);
      await firstRefresh;
    });

    expect(harness.panel().gitBranchEntries).toEqual([branch("winner")]);
    harness.unmount();
  });

  it("drops a branch list whose workspace root changed mid-flight", async () => {
    const deferred = createDeferred<GitBranch[]>();
    const branchList = vi.fn(() => deferred.promise);
    const harness = renderBranchPanel({
      gitGateway: createFakeGitGateway({ branchList }),
    });

    let refreshPromise: Promise<void> | null = null;
    act(() => {
      refreshPromise = harness.panel().refreshGitBranches();
    });

    await act(async () => {
      harness.ref.current = "/other";
      deferred.resolve([branch("stale")]);
      await refreshPromise;
    });

    expect(harness.panel().gitBranchEntries).toEqual([]);
    harness.unmount();
  });
});
