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
  gitChangeKeyForRepository,
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

interface TestGitGateway extends GitGateway {
  fetch(rootPath: string): Promise<GitStatus>;
  pull(rootPath: string): Promise<GitStatus>;
}

/**
 * A GitGateway whose staging/commit surface is overridable per test. Only the
 * methods the hook actually calls are stubbed; the rest are cast away since the
 * hook never touches them (real git is never invoked).
 */
function createFakeGitGateway(
  overrides: Partial<TestGitGateway> = {},
): TestGitGateway {
  const base = {
    getStatus: vi.fn(async (rootPath: string) => status(rootPath)),
    stageFiles: vi.fn(async (rootPath: string) => status(rootPath)),
    unstageFiles: vi.fn(async (rootPath: string) => status(rootPath)),
    stageHunk: vi.fn(async (rootPath: string) => status(rootPath)),
    unstageHunk: vi.fn(async (rootPath: string) => status(rootPath)),
    getFileHunks: vi.fn(async () => [] as GitDiffHunk[]),
    revertFiles: vi.fn(async (rootPath: string) => status(rootPath)),
    commit: vi.fn(async (rootPath: string) => status(rootPath)),
    amend: vi.fn(async (rootPath: string) => status(rootPath)),
    push: vi.fn(async (rootPath: string) => status(rootPath)),
    fetch: vi.fn(async (rootPath: string) => status(rootPath)),
    pull: vi.fn(async (rootPath: string) => status(rootPath)),
  };
  return { ...base, ...overrides } as unknown as TestGitGateway;
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

  it("reports a stage refusal through the Git error path", async () => {
    const error = new Error(
      "Cannot mark resolved while conflict markers remain in: conflict.txt.",
    );
    const stageFiles = vi.fn(async () => {
      throw error;
    });
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ stageFiles }),
    });

    await act(async () => {
      await harness.workspace().stageGitChanges([
        changedFile("conflict.txt", { status: "conflicted" }),
      ]);
    });

    expect(harness.reportError).toHaveBeenCalledWith("Git", error);
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

    const change = changedFile("a.ts");
    await act(async () => {
      await harness.workspace().stageGitHunk(change, 2);
    });
    expect(stageHunk).toHaveBeenCalledWith(ROOT, "a.ts", 2);
    expect(harness.setMessage).toHaveBeenCalledWith("Staged hunk in a.ts");

    await act(async () => {
      await harness.workspace().unstageGitHunk(change, 2);
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
      hunksPromise = harness
        .workspace()
        .loadGitFileHunks(changedFile("a.ts"), false);
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

  it("loads hunks from the owning nested repository (root + repo-relative path)", async () => {
    const nestedRoot = `${ROOT}/workbench/lcsk/x`;
    const nestedHunks = [hunk(0)];
    const getFileHunks = vi.fn(async () => nestedHunks);
    const nestedChange = changedFile("src/foo.php", {
      path: `${nestedRoot}/src/foo.php`,
    });
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ getFileHunks }),
      gitRepositoryMappings: [
        { rootRelativePath: "" },
        { rootRelativePath: "workbench/lcsk/x" },
      ],
    });

    let resolved: GitDiffHunk[] | null = null;
    await act(async () => {
      resolved = await harness
        .workspace()
        .loadGitFileHunks(nestedChange, false);
    });

    expect(getFileHunks).toHaveBeenCalledWith(nestedRoot, "src/foo.php", false);
    expect(resolved).toEqual(nestedHunks);
    harness.unmount();
  });

  it("stages and unstages a hunk in the owning nested repository and refreshes it", async () => {
    const nestedRoot = `${ROOT}/workbench/lcsk/x`;
    const nestedStatus = status(nestedRoot);
    const stageHunk = vi.fn(async () => nestedStatus);
    const unstageHunk = vi.fn(async () => nestedStatus);
    const applyRepositoryOperationStatuses = vi.fn();
    const nestedChange = changedFile("src/foo.php", {
      path: `${nestedRoot}/src/foo.php`,
    });
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ stageHunk, unstageHunk }),
      gitRepositoryMappings: [
        { rootRelativePath: "" },
        { rootRelativePath: "workbench/lcsk/x" },
      ],
      applyRepositoryOperationStatuses,
    });

    await act(async () => {
      await harness.workspace().stageGitHunk(nestedChange, 1);
    });
    expect(stageHunk).toHaveBeenCalledWith(nestedRoot, "src/foo.php", 1);
    expect(harness.setMessage).toHaveBeenCalledWith(
      "Staged hunk in src/foo.php",
    );
    // The touched (nested) repository's fresh status is published, and the
    // primary surface is left untouched (the operation never hit the root repo).
    expect(applyRepositoryOperationStatuses).toHaveBeenCalledWith([
      expect.objectContaining({ root: nestedRoot, status: nestedStatus }),
    ]);
    expect(harness.applyGitOperationStatus).not.toHaveBeenCalled();

    await act(async () => {
      await harness.workspace().unstageGitHunk(nestedChange, 1);
    });
    expect(unstageHunk).toHaveBeenCalledWith(nestedRoot, "src/foo.php", 1);
    expect(harness.setMessage).toHaveBeenCalledWith(
      "Unstaged hunk in src/foo.php",
    );
    harness.unmount();
  });

  it("skips a hunk stage when the file resolves to no repository", async () => {
    const stageHunk = vi.fn(async () => status(ROOT));
    const orphanChange = changedFile("outside.ts", {
      path: "/elsewhere/outside.ts",
    });
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ stageHunk }),
    });

    await act(async () => {
      await harness.workspace().stageGitHunk(orphanChange, 0);
    });

    expect(stageHunk).not.toHaveBeenCalled();
    expect(harness.setMessage).toHaveBeenCalledWith(
      "Skipped 1 file(s) with no matching Git repository",
    );
    expect(harness.workspace().gitOperationLoading).toBe(false);
    harness.unmount();
  });

  it("returns no hunks when the file resolves to no repository", async () => {
    const getFileHunks = vi.fn(async () => [hunk(0)]);
    const orphanChange = changedFile("outside.ts", {
      path: "/elsewhere/outside.ts",
    });
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ getFileHunks }),
    });

    let resolved: GitDiffHunk[] | null = null;
    await act(async () => {
      resolved = await harness
        .workspace()
        .loadGitFileHunks(orphanChange, false);
    });

    expect(getFileHunks).not.toHaveBeenCalled();
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
    const recordGitCommitMessage = vi.fn();
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ stageFiles, commit, push }),
      gitStatus,
      recordGitCommitMessage,
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
    expect(recordGitCommitMessage).toHaveBeenCalledWith(ROOT, "first commit");
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

  it("resets amend mode after success and the next submission is a plain commit", async () => {
    const included = changedFile("a.ts", { isStaged: true });
    const amended = status(ROOT, []);
    const amend = vi.fn(async () => amended);
    const commit = vi.fn(async () => status(ROOT, []));
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ amend, commit }),
      gitStatus: status(ROOT, [included]),
    });

    act(() => {
      harness.workspace().setGitAmendEnabled(true);
      harness.workspace().toggleGitChangeIncluded(included);
    });

    await act(async () => {
      await harness.workspace().amendGitChanges();
    });

    expect(amend).toHaveBeenCalledWith(ROOT, "", [included]);
    expect(harness.applyGitOperationStatus).toHaveBeenCalledWith(amended);
    expect(harness.workspace().gitAmendEnabled).toBe(false);

    act(() => {
      harness.workspace().setGitCommitMessage("next commit");
      harness.workspace().toggleGitChangeIncluded(included);
    });
    await act(async () => {
      await harness.workspace().commitGitChanges();
    });

    expect(commit).toHaveBeenCalledWith(ROOT, "next commit", [included]);
    expect(amend).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("reports amend failures without resetting amend mode", async () => {
    const included = changedFile("a.ts", { isStaged: true });
    const error = new Error("cannot amend a pushed commit");
    const amend = vi.fn(async () => {
      throw error;
    });
    const recordGitCommitMessage = vi.fn();
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ amend }),
      gitStatus: status(ROOT, [included]),
      recordGitCommitMessage,
    });

    act(() => {
      harness.workspace().setGitAmendEnabled(true);
      harness.workspace().toggleGitChangeIncluded(included);
    });
    await act(async () => {
      await harness.workspace().amendGitChanges();
    });

    expect(harness.reportError).toHaveBeenCalledWith("Git", error);
    expect(harness.workspace().gitAmendEnabled).toBe(true);
    expect(recordGitCommitMessage).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("records a successful amend message", async () => {
    const included = changedFile("a.ts", { isStaged: true });
    const recordGitCommitMessage = vi.fn();
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway(),
      gitStatus: status(ROOT, [included]),
      recordGitCommitMessage,
    });

    act(() => {
      harness.workspace().setGitCommitMessage("amended subject");
      harness.workspace().toggleGitChangeIncluded(included);
    });
    await act(async () => {
      await harness.workspace().amendGitChanges();
    });

    expect(recordGitCommitMessage).toHaveBeenCalledWith(
      ROOT,
      "amended subject",
    );
    harness.unmount();
  });

  it("prevents a second amend while the first is in flight", async () => {
    const included = changedFile("a.ts", { isStaged: true });
    const deferred = createDeferred<GitStatus>();
    const amend = vi.fn(() => deferred.promise);
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ amend }),
      gitStatus: status(ROOT, [included]),
    });

    act(() => {
      harness.workspace().toggleGitChangeIncluded(included);
    });
    let firstAmend: Promise<void> | null = null;
    act(() => {
      firstAmend = harness.workspace().amendGitChanges();
      void harness.workspace().amendGitChanges();
    });

    expect(amend).toHaveBeenCalledTimes(1);
    await act(async () => {
      deferred.resolve(status(ROOT));
      await firstAmend;
    });
    harness.unmount();
  });

  it("drops an amend result when the workspace changes mid-flight", async () => {
    const included = changedFile("a.ts", { isStaged: true });
    const deferred = createDeferred<GitStatus>();
    const amend = vi.fn(() => deferred.promise);
    const recordGitCommitMessage = vi.fn();
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ amend }),
      gitStatus: status(ROOT, [included]),
      recordGitCommitMessage,
    });

    act(() => {
      harness.workspace().setGitCommitMessage("stale amend");
      harness.workspace().toggleGitChangeIncluded(included);
    });
    let amendPromise: Promise<void> | null = null;
    act(() => {
      amendPromise = harness.workspace().amendGitChanges();
    });
    await act(async () => {
      harness.ref.current = "/other";
      deferred.resolve(status(ROOT));
      await amendPromise;
    });

    expect(harness.applyGitOperationStatus).not.toHaveBeenCalled();
    expect(harness.reportError).not.toHaveBeenCalled();
    expect(recordGitCommitMessage).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("fetches every mapped repository and reports the aggregated outcome", async () => {
    const fetch = vi.fn(async (rootPath: string) => status(rootPath));
    const applyRepositoryOperationStatuses = vi.fn();
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ fetch }),
      gitRepositoryMappings: [
        { rootRelativePath: "" },
        { rootRelativePath: "workbench/lcsk/x" },
      ],
      applyRepositoryOperationStatuses,
    });

    await act(async () => {
      await harness.workspace().fetchGitChanges();
    });

    expect(fetch).toHaveBeenCalledWith(ROOT);
    expect(fetch).toHaveBeenCalledWith("/workspace/workbench/lcsk/x");
    expect(harness.setMessage).toHaveBeenCalledWith("Fetched 2 repositories");
    expect(applyRepositoryOperationStatuses).toHaveBeenCalled();
    harness.unmount();
  });

  it("pulls only the active workspace repositories and reports a single failure", async () => {
    const pull = vi.fn(async () => {
      throw new Error("Not possible to fast-forward, aborting.");
    });
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ pull }),
    });

    await act(async () => {
      await harness.workspace().pullGitChanges();
    });

    expect(pull).toHaveBeenCalledWith(ROOT);
    expect(harness.reportError).toHaveBeenCalledWith(
      "Git",
      expect.objectContaining({ message: "Not possible to fast-forward, aborting." }),
    );
    expect(harness.workspace().gitOperationLoading).toBe(false);
    harness.unmount();
  });

  it("prevents a second pull while the first pull is in flight", async () => {
    const deferred = createDeferred<GitStatus>();
    const pull = vi.fn(() => deferred.promise);
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ pull }),
    });

    let firstPull: Promise<void> | null = null;
    act(() => {
      firstPull = harness.workspace().pullGitChanges();
      void harness.workspace().pullGitChanges();
    });

    expect(pull).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve(status(ROOT));
      await firstPull;
    });
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

  it("swaps commit message history with the active workspace", () => {
    const harness = renderGitWorkspace({
      gitCommitMessageHistory: ["workspace A"],
    });

    expect(harness.workspace().gitCommitMessageHistory).toEqual(["workspace A"]);
    harness.rerender({
      workspaceRoot: "/other",
      gitStatus: status("/other", []),
      gitCommitMessageHistory: ["workspace B"],
    });
    expect(harness.workspace().gitCommitMessageHistory).toEqual(["workspace B"]);
    expect(harness.workspace().gitCommitMessageHistory).not.toContain("workspace A");
    harness.unmount();
  });

  const NESTED_ROOT = `${ROOT}/workbench/lcsk/x`;

  function nestedChangedFile(
    relativePath: string,
    overrides: Partial<GitChangedFile> = {},
  ): GitChangedFile {
    return {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: `${NESTED_ROOT}/${relativePath}`,
      relativePath,
      status: "modified",
      ...overrides,
    };
  }

  it("routes staged files into the repository that owns each one", async () => {
    const stageFiles = vi.fn(async (root: string) => status(root));
    const primary = changedFile("app.php");
    const nested = nestedChangedFile("lib.php");
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ stageFiles }),
      gitRepositoryMappings: [
        { rootRelativePath: "" },
        { rootRelativePath: "workbench/lcsk/x" },
      ],
    });

    await act(async () => {
      await harness.workspace().stageGitChanges([primary, nested]);
    });

    expect(stageFiles).toHaveBeenCalledWith(ROOT, [primary]);
    expect(stageFiles).toHaveBeenCalledWith(NESTED_ROOT, [nested]);
    harness.unmount();
  });

  it("commits included changes across every visible repository, staging unstaged ones per repo", async () => {
    // G5: the panel now shows the aggregate grouped view, so every repository's
    // selected changes are committed - each into the repo that owns it, staging
    // any unstaged change first, in that repo. A unified commit message applies
    // to all repositories (PhpStorm multi-repo commit).
    const commit = vi.fn(async (root: string) => status(root, []));
    const stageFiles = vi.fn(async (root: string) => status(root));
    const primary = changedFile("app.php");
    const nested = nestedChangedFile("lib.php");
    const applyRepositoryOperationStatuses = vi.fn();
    const recordGitCommitMessage = vi.fn();
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ commit, stageFiles }),
      gitStatus: status(ROOT, [primary]),
      gitRepositoryMappings: [
        { rootRelativePath: "" },
        { rootRelativePath: "workbench/lcsk/x" },
      ],
      gitRepositoryStatuses: [
        {
          mapping: { rootRelativePath: "" },
          root: ROOT,
          status: status(ROOT, [primary]),
          failed: false,
        },
        {
          mapping: { rootRelativePath: "workbench/lcsk/x" },
          root: NESTED_ROOT,
          status: status(NESTED_ROOT, [nested]),
          failed: false,
        },
      ],
      applyRepositoryOperationStatuses,
      recordGitCommitMessage,
    });

    act(() => {
      harness.workspace().setGitCommitMessage("unified message");
      harness.workspace().toggleGitChangeIncluded(primary);
      harness.workspace().toggleGitChangeIncluded(nested, "workbench/lcsk/x");
    });

    await act(async () => {
      await harness.workspace().commitGitChanges();
    });

    expect(stageFiles).toHaveBeenCalledWith(ROOT, [primary]);
    expect(stageFiles).toHaveBeenCalledWith(NESTED_ROOT, [nested]);
    expect(commit).toHaveBeenCalledWith(ROOT, "unified message", [primary]);
    expect(commit).toHaveBeenCalledWith(
      NESTED_ROOT,
      "unified message",
      [nested],
    );
    expect(applyRepositoryOperationStatuses).toHaveBeenCalled();
    expect(harness.workspace().gitCommitMessage).toBe("");
    expect(harness.setMessage).toHaveBeenCalledWith(
      "Committed to 2 repositories",
    );
    expect(recordGitCommitMessage).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("pushes every committed repository", async () => {
    const commit = vi.fn(async (root: string) => status(root, []));
    const push = vi.fn(async (root: string) => status(root, []));
    const primary = changedFile("app.php");
    const nested = nestedChangedFile("lib.php");
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ commit, push }),
      gitStatus: status(ROOT, [primary]),
      gitRepositoryMappings: [
        { rootRelativePath: "" },
        { rootRelativePath: "workbench/lcsk/x" },
      ],
      gitRepositoryStatuses: [
        {
          mapping: { rootRelativePath: "" },
          root: ROOT,
          status: status(ROOT, [primary]),
          failed: false,
        },
        {
          mapping: { rootRelativePath: "workbench/lcsk/x" },
          root: NESTED_ROOT,
          status: status(NESTED_ROOT, [nested]),
          failed: false,
        },
      ],
      applyRepositoryOperationStatuses: vi.fn(),
    });

    act(() => {
      harness.workspace().setGitCommitMessage("ship it");
      harness.workspace().toggleGitChangeIncluded(primary);
      harness.workspace().toggleGitChangeIncluded(nested, "workbench/lcsk/x");
    });

    await act(async () => {
      await harness.workspace().commitAndPushGitChanges();
    });

    expect(commit).toHaveBeenCalledWith(ROOT, "ship it", [primary]);
    expect(commit).toHaveBeenCalledWith(NESTED_ROOT, "ship it", [nested]);
    expect(push).toHaveBeenCalledWith(ROOT);
    expect(push).toHaveBeenCalledWith(NESTED_ROOT);
    expect(harness.setMessage).toHaveBeenCalledWith("Pushed 2 repositories");
    harness.unmount();
  });

  it("commits only the selected repo when two repos share a relative path", async () => {
    // HIGH regression: an unqualified inclusion key is `{staged|worktree}:{relativePath}`
    // and `relativePath` is repo-root-relative, so a primary `README.md` and a
    // nested `workbench/lcsk/x/README.md` collide. Repo-qualified keys keep them
    // distinct: selecting ONLY the nested one must commit ONLY the nested repo.
    const commit = vi.fn(async (root: string) => status(root, []));
    const stageFiles = vi.fn(async (root: string) => status(root));
    const primaryReadme = changedFile("README.md");
    const nestedReadme = nestedChangedFile("README.md");
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ commit, stageFiles }),
      gitStatus: status(ROOT, [primaryReadme]),
      gitRepositoryMappings: [
        { rootRelativePath: "" },
        { rootRelativePath: "workbench/lcsk/x" },
      ],
      gitRepositoryStatuses: [
        {
          mapping: { rootRelativePath: "" },
          root: ROOT,
          status: status(ROOT, [primaryReadme]),
          failed: false,
        },
        {
          mapping: { rootRelativePath: "workbench/lcsk/x" },
          root: NESTED_ROOT,
          status: status(NESTED_ROOT, [nestedReadme]),
          failed: false,
        },
      ],
      applyRepositoryOperationStatuses: vi.fn(),
    });

    act(() => {
      harness.workspace().setGitCommitMessage("touch nested readme");
      harness
        .workspace()
        .toggleGitChangeIncluded(nestedReadme, "workbench/lcsk/x");
    });

    await act(async () => {
      await harness.workspace().commitGitChanges();
    });

    expect(commit).toHaveBeenCalledWith(
      NESTED_ROOT,
      "touch nested readme",
      [nestedReadme],
    );
    expect(commit).not.toHaveBeenCalledWith(
      ROOT,
      expect.anything(),
      expect.anything(),
    );
    expect(stageFiles).toHaveBeenCalledWith(NESTED_ROOT, [nestedReadme]);
    expect(stageFiles).not.toHaveBeenCalledWith(ROOT, expect.anything());
    harness.unmount();
  });

  it("auto-includes a staged change from every visible repository under its qualified key", async () => {
    // G5: the reconcile effect auto-includes every staged change across the
    // whole-map view, each under its repo-qualified key so nested and primary
    // never collide.
    const stagedNested = nestedChangedFile("lib.php", { isStaged: true });
    const primaryStatus = {
      mapping: { rootRelativePath: "" },
      root: ROOT,
      status: status(ROOT, []),
      failed: false,
    };
    const harness = renderGitWorkspace({
      gitStatus: status(ROOT, []),
      gitRepositoryMappings: [
        { rootRelativePath: "" },
        { rootRelativePath: "workbench/lcsk/x" },
      ],
      gitRepositoryStatuses: [
        primaryStatus,
        {
          mapping: { rootRelativePath: "workbench/lcsk/x" },
          root: NESTED_ROOT,
          status: status(NESTED_ROOT, []),
          failed: false,
        },
      ],
    });

    // A staged change surfaces in the nested repo.
    harness.rerender({
      gitRepositoryStatuses: [
        primaryStatus,
        {
          mapping: { rootRelativePath: "workbench/lcsk/x" },
          root: NESTED_ROOT,
          status: status(NESTED_ROOT, [stagedNested]),
          failed: false,
        },
      ],
    });

    expect(
      harness
        .workspace()
        .includedGitChangePaths.has(
          gitChangeKeyForRepository("workbench/lcsk/x", stagedNested),
        ),
    ).toBe(true);
    // The bare, unqualified key is never used, so a same-named primary change
    // would not be swept in by this nested auto-include.
    expect(
      harness.workspace().includedGitChangePaths.has(gitChangeKey(stagedNested)),
    ).toBe(false);
    harness.unmount();
  });

  it("skips a file that resolves to no repository (fail-safe) instead of misrouting it", async () => {
    const stageFiles = vi.fn(async (root: string) => status(root));
    const outside: GitChangedFile = {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "/elsewhere/app.php",
      relativePath: "app.php",
      status: "modified",
    };
    const harness = renderGitWorkspace({
      gitGateway: createFakeGitGateway({ stageFiles }),
      gitRepositoryMappings: [{ rootRelativePath: "workbench/lcsk/x" }],
    });

    await act(async () => {
      await harness.workspace().stageGitChanges([outside]);
    });

    expect(stageFiles).not.toHaveBeenCalled();
    harness.unmount();
  });
});
