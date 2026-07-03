// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  useGitWorkspace,
  type GitWorkspace,
  type GitWorkspaceDependencies,
} from "./useGitWorkspace";
import {
  gitChangeKey,
  type GitChangedFile,
  type GitDiffHunk,
  type GitGateway,
  type GitStatus,
} from "../domain/git";
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

function changedFile(
  relativePath: string,
  overrides: Partial<GitChangedFile> = {},
): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${ROOT}/${relativePath}`,
    relativePath,
    status: "modified",
    ...overrides,
  };
}

function status(rootPath: string, changes: GitChangedFile[] = []): GitStatus {
  return { branch: "main", changes, isRepository: true, rootPath };
}

function hunk(index: number): GitDiffHunk {
  return {
    header: `@@ -${index},1 +${index},1 @@`,
    index,
    isStaged: false,
    lines: [`+line ${index}`],
  };
}

/**
 * A GitGateway whose staging/commit surface is overridable per test. Only the
 * methods the hook actually calls are stubbed; the rest are cast away since the
 * hook never touches them (real git is never invoked).
 */
function createFakeGitGateway(overrides: Partial<GitGateway> = {}): GitGateway {
  const base = {
    getStatus: vi.fn(async (rootPath: string) => status(rootPath)),
    stageFiles: vi.fn(async (rootPath: string) => status(rootPath)),
    unstageFiles: vi.fn(async (rootPath: string) => status(rootPath)),
    stageHunk: vi.fn(async (rootPath: string) => status(rootPath)),
    unstageHunk: vi.fn(async (rootPath: string) => status(rootPath)),
    getFileHunks: vi.fn(async () => [] as GitDiffHunk[]),
    revertFiles: vi.fn(async (rootPath: string) => status(rootPath)),
    commit: vi.fn(async (rootPath: string) => status(rootPath)),
    push: vi.fn(async (rootPath: string) => status(rootPath)),
  };
  return { ...base, ...overrides } as unknown as GitGateway;
}

interface Harness {
  workspace: () => GitWorkspace;
  ref: { current: string | null };
  applyGitOperationStatus: ReturnType<typeof vi.fn>;
  reportError: ReturnType<typeof vi.fn>;
  setMessage: ReturnType<typeof vi.fn>;
  rerender: (next: Partial<GitWorkspaceDependencies>) => void;
  unmount: () => void;
}

function renderGitWorkspace(
  overrides: Partial<GitWorkspaceDependencies> = {},
): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { workspace: GitWorkspace | null } = { workspace: null };

  const ref: { current: string | null } = { current: ROOT };
  const applyGitOperationStatus = vi.fn();
  const reportError = vi.fn();
  const setMessage = vi.fn();
  const prompter: WorkbenchPrompter = {
    confirm: vi.fn(() => true),
    prompt: vi.fn(() => null),
  };

  let deps: GitWorkspaceDependencies = {
    gitGateway: createFakeGitGateway(),
    currentWorkspaceRootRef: ref,
    workspaceRoot: ROOT,
    gitStatus: status(ROOT),
    applyGitOperationStatus,
    reportError,
    setMessage,
    prompter,
    ...overrides,
  };

  function Harness() {
    captured.workspace = useGitWorkspace(deps);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    workspace: () => {
      if (!captured.workspace) {
        throw new Error("workspace not mounted");
      }
      return captured.workspace;
    },
    ref,
    applyGitOperationStatus,
    reportError,
    setMessage,
    rerender: (next: Partial<GitWorkspaceDependencies>) => {
      deps = { ...deps, ...next };
      act(() => {
        root.render(<Harness />);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useGitWorkspace", () => {
  it("stages files and applies the returned status", async () => {
    const staged = status(ROOT, [changedFile("a.ts", { isStaged: true })]);
    const stageFiles = vi.fn(async () => staged);
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ stageFiles }),
    });

    const changes = [changedFile("a.ts")];
    await act(async () => {
      await harness.workspace().stageGitChanges(changes);
    });

    expect(stageFiles).toHaveBeenCalledWith(ROOT, changes);
    expect(harness.applyGitOperationStatus).toHaveBeenCalledWith(staged);
    expect(harness.workspace().gitOperationLoading).toBe(false);
    harness.unmount();
  });

  it("ignores a stage request with no changes", async () => {
    const stageFiles = vi.fn(async () => status(ROOT));
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ stageFiles }),
    });

    await act(async () => {
      await harness.workspace().stageGitChanges([]);
    });

    expect(stageFiles).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("unstages files and applies the returned status", async () => {
    const next = status(ROOT, [changedFile("a.ts")]);
    const unstageFiles = vi.fn(async () => next);
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ unstageFiles }),
    });

    const changes = [changedFile("a.ts", { isStaged: true })];
    await act(async () => {
      await harness.workspace().unstageGitChanges(changes);
    });

    expect(unstageFiles).toHaveBeenCalledWith(ROOT, changes);
    expect(harness.applyGitOperationStatus).toHaveBeenCalledWith(next);
    harness.unmount();
  });

  it("stages and unstages a single hunk with a status-bar message", async () => {
    const stageHunk = vi.fn(async () => status(ROOT));
    const unstageHunk = vi.fn(async () => status(ROOT));
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ stageHunk, unstageHunk }),
    });

    await act(async () => {
      await harness.workspace().stageGitHunk("a.ts", 2);
    });
    expect(stageHunk).toHaveBeenCalledWith(ROOT, "a.ts", 2);
    expect(harness.setMessage).toHaveBeenCalledWith("Staged hunk in a.ts");

    await act(async () => {
      await harness.workspace().unstageGitHunk("a.ts", 2);
    });
    expect(unstageHunk).toHaveBeenCalledWith(ROOT, "a.ts", 2);
    expect(harness.setMessage).toHaveBeenCalledWith("Unstaged hunk in a.ts");
    harness.unmount();
  });

  it("loads file hunks and drops a stale result after a root switch", async () => {
    const deferred = createDeferred<GitDiffHunk[]>();
    const getFileHunks = vi.fn(() => deferred.promise);
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ getFileHunks }),
    });

    let hunksPromise: Promise<GitDiffHunk[]> | null = null;
    act(() => {
      hunksPromise = harness.workspace().loadGitFileHunks("a.ts", false);
    });

    let resolved: GitDiffHunk[] | null = null;
    await act(async () => {
      harness.ref.current = "/other";
      deferred.resolve([hunk(0)]);
      resolved = await hunksPromise;
    });

    expect(getFileHunks).toHaveBeenCalledWith(ROOT, "a.ts", false);
    expect(resolved).toEqual([]);
    harness.unmount();
  });

  it("toggles a change into and out of the included set", async () => {
    const harness = renderGitWorkspace();
    const change = changedFile("a.ts");

    act(() => {
      harness.workspace().toggleGitChangeIncluded(change);
    });
    expect(harness.workspace().includedGitChangePaths.has(gitChangeKey(change))).toBe(
      true,
    );

    act(() => {
      harness.workspace().toggleGitChangeIncluded(change);
    });
    expect(harness.workspace().includedGitChangePaths.has(gitChangeKey(change))).toBe(
      false,
    );
    harness.unmount();
  });

  it("does not revert when the destructive confirmation is declined", async () => {
    const revertFiles = vi.fn(async () => status(ROOT));
    const confirm = vi.fn(() => false);
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ revertFiles }),
      prompter: { confirm, prompt: vi.fn(() => null) },
    });

    await act(async () => {
      await harness.workspace().revertGitChanges([changedFile("a.ts")]);
    });

    expect(confirm).toHaveBeenCalled();
    expect(revertFiles).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("reverts only after the destructive confirmation is accepted", async () => {
    const reverted = status(ROOT);
    const revertFiles = vi.fn(async () => reverted);
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ revertFiles }),
      prompter: { confirm: vi.fn(() => true), prompt: vi.fn(() => null) },
    });

    const changes = [changedFile("a.ts")];
    await act(async () => {
      await harness.workspace().revertGitChanges(changes);
    });

    expect(revertFiles).toHaveBeenCalledWith(ROOT, changes);
    expect(harness.applyGitOperationStatus).toHaveBeenCalledWith(reverted);
    harness.unmount();
  });

  it("commits only the included changes, staging unstaged ones first, then resets", async () => {
    const included = changedFile("a.ts");
    const excluded = changedFile("b.ts");
    const committed = status(ROOT, []);
    const stageFiles = vi.fn(async () => status(ROOT));
    const commit = vi.fn(async () => committed);
    const push = vi.fn(async () => status(ROOT));
    const gitStatus = status(ROOT, [included, excluded]);
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ stageFiles, commit, push }),
      gitStatus,
    });

    act(() => {
      harness.workspace().setGitCommitMessage("  first commit  ");
      harness.workspace().toggleGitChangeIncluded(included);
    });

    await act(async () => {
      await harness.workspace().commitGitChanges();
    });

    // Only the included change is staged/committed and it was unstaged, so it
    // is staged first.
    expect(stageFiles).toHaveBeenCalledWith(ROOT, [included]);
    expect(commit).toHaveBeenCalledWith(ROOT, "first commit", [included]);
    expect(push).not.toHaveBeenCalled();
    expect(harness.applyGitOperationStatus).toHaveBeenCalledWith(committed);
    expect(harness.workspace().gitCommitMessage).toBe("");
    expect(harness.workspace().includedGitChangePaths.size).toBe(0);
    harness.unmount();
  });

  it("commits and pushes when requested", async () => {
    const included = changedFile("a.ts", { isStaged: true });
    const committed = status(ROOT, []);
    const pushed = status(ROOT, []);
    const commit = vi.fn(async () => committed);
    const push = vi.fn(async () => pushed);
    const stageFiles = vi.fn(async () => status(ROOT));
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ commit, push, stageFiles }),
      gitStatus: status(ROOT, [included]),
    });

    act(() => {
      harness.workspace().setGitCommitMessage("shipit");
      harness.workspace().toggleGitChangeIncluded(included);
    });

    await act(async () => {
      await harness.workspace().commitAndPushGitChanges();
    });

    // Already staged, so no pre-stage call is needed.
    expect(stageFiles).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith(ROOT, "shipit", [included]);
    expect(push).toHaveBeenCalledWith(ROOT);
    expect(harness.setMessage).toHaveBeenCalledWith("Pushed current branch");
    harness.unmount();
  });

  it("does not commit with a blank message or no included changes", async () => {
    const commit = vi.fn(async () => status(ROOT));
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ commit }),
      gitStatus: status(ROOT, [changedFile("a.ts")]),
    });

    // Included but blank message.
    act(() => {
      harness.workspace().toggleGitChangeIncluded(changedFile("a.ts"));
      harness.workspace().setGitCommitMessage("   ");
    });
    await act(async () => {
      await harness.workspace().commitGitChanges();
    });
    expect(commit).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops a stage result whose workspace root changed mid-flight", async () => {
    const deferred = createDeferred<GitStatus>();
    const stageFiles = vi.fn(() => deferred.promise);
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ stageFiles }),
    });

    let stagePromise: Promise<void> | null = null;
    act(() => {
      stagePromise = harness.workspace().stageGitChanges([changedFile("a.ts")]);
    });

    await act(async () => {
      harness.ref.current = "/other";
      deferred.resolve(status(ROOT, [changedFile("a.ts", { isStaged: true })]));
      await stagePromise;
    });

    expect(harness.applyGitOperationStatus).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("reconciles the included set against the latest status changes", async () => {
    const kept = changedFile("a.ts");
    const gone = changedFile("gone.ts");
    const harness = renderGitWorkspace({
      gitStatus: status(ROOT, [kept, gone]),
    });

    act(() => {
      harness.workspace().toggleGitChangeIncluded(kept);
      harness.workspace().toggleGitChangeIncluded(gone);
    });
    expect(harness.workspace().includedGitChangePaths.size).toBe(2);

    // `gone.ts` disappears from the status; its key must be pruned.
    harness.rerender({ gitStatus: status(ROOT, [kept]) });

    expect(harness.workspace().includedGitChangePaths.has(gitChangeKey(kept))).toBe(
      true,
    );
    expect(harness.workspace().includedGitChangePaths.has(gitChangeKey(gone))).toBe(
      false,
    );
    harness.unmount();
  });

  it("auto-includes staged changes surfaced by a status refresh", async () => {
    const harness = renderGitWorkspace({ gitStatus: status(ROOT, []) });

    const stagedChange = changedFile("a.ts", { isStaged: true });
    harness.rerender({ gitStatus: status(ROOT, [stagedChange]) });

    expect(
      harness.workspace().includedGitChangePaths.has(gitChangeKey(stagedChange)),
    ).toBe(true);
    harness.unmount();
  });

  it("resets the commit panel state when the workspace root changes", async () => {
    const harness = renderGitWorkspace({
      gitStatus: status(ROOT, [changedFile("a.ts")]),
    });

    act(() => {
      harness.workspace().setGitCommitMessage("draft");
      harness.workspace().toggleGitChangeIncluded(changedFile("a.ts"));
    });
    expect(harness.workspace().gitCommitMessage).toBe("draft");

    harness.rerender({ workspaceRoot: "/other", gitStatus: status("/other", []) });

    expect(harness.workspace().gitCommitMessage).toBe("");
    expect(harness.workspace().includedGitChangePaths.size).toBe(0);
    harness.unmount();
  });
});
