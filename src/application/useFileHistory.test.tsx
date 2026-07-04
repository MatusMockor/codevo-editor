// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  useFileHistory,
  type FileHistoryDependencies,
  type FileHistoryPanel,
  type ResolveGitRepositoryTarget,
} from "./useFileHistory";
import type {
  GitFileDiff,
  GitFileHistoryEntry,
  GitGateway,
} from "../domain/git";
import type { EditorDocument } from "../domain/workspace";

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

function document(path: string): EditorDocument {
  return {
    content: "content",
    language: "php",
    name: path.split("/").pop() ?? path,
    path,
    savedContent: "content",
  };
}

function commit(sha: string, subject: string): GitFileHistoryEntry {
  return { author: "Ada", sha, subject, timestamp: 1700000000 };
}

function diff(sha: string): GitFileDiff {
  return {
    change: {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "src/User.php",
      relativePath: "src/User.php",
      status: "modified",
    },
    language: "php",
    modifiedContent: `content @ ${sha}`,
    originalContent: "",
  };
}

/**
 * A GitGateway whose file-history surface is overridable per test. Only the
 * methods the panel actually calls are stubbed; the rest are cast away since
 * the hook never touches them (real git is never invoked).
 */
function createFakeGitGateway(overrides: Partial<GitGateway> = {}): GitGateway {
  const base = {
    fileCommitDiff: vi.fn(async (_root: string, _path: string, sha: string) =>
      diff(sha),
    ),
    fileHistory: vi.fn(async () => [] as GitFileHistoryEntry[]),
    getStatus: vi.fn(async (rootPath: string) => ({
      branch: "main",
      changes: [],
      isRepository: true,
      rootPath,
    })),
  };
  return { ...base, ...overrides } as unknown as GitGateway;
}

/**
 * The default resolver: routes every path to the workspace root (the
 * pre-multi-repo, single-repository behaviour).
 */
function workspaceRootResolver(root: string): ResolveGitRepositoryTarget {
  return (absolutePath: string) => {
    if (!absolutePath.startsWith(`${root}/`)) {
      return null;
    }

    return {
      relativePath: absolutePath.slice(root.length + 1),
      repositoryRoot: root,
    };
  };
}

interface Harness {
  panel: () => FileHistoryPanel;
  rootRef: { current: string | null };
  activeDocumentRef: { current: EditorDocument | null };
  reportError: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderFileHistory(
  overrides: Partial<FileHistoryDependencies> = {},
): Harness {
  const container = globalThis.document.createElement("div");
  const root = createRoot(container);
  const captured: { panel: FileHistoryPanel | null } = { panel: null };

  const rootRef: { current: string | null } = { current: ROOT };
  const activeDocumentRef: { current: EditorDocument | null } = {
    current: document(`${ROOT}/src/User.php`),
  };
  const reportError = vi.fn();

  const deps: FileHistoryDependencies = {
    activeDocumentRef,
    currentWorkspaceRootRef: rootRef,
    gitGateway: createFakeGitGateway(),
    reportError,
    resolveGitRepositoryTarget: workspaceRootResolver(ROOT),
    workspaceRoot: ROOT,
    ...overrides,
  };

  function Harness() {
    captured.panel = useFileHistory(deps);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    activeDocumentRef,
    panel: () => {
      if (!captured.panel) {
        throw new Error("panel not mounted");
      }
      return captured.panel;
    },
    reportError,
    rootRef,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useFileHistory", () => {
  it("opens the panel, lists commits for the active file, and loads a selected commit's diff", async () => {
    const fileHistory = vi.fn(async () => [
      commit("aaa1111", "First commit"),
      commit("bbb2222", "Second commit"),
    ]);
    const fileCommitDiff = vi.fn(async (_root: string, _path: string, sha: string) =>
      diff(sha),
    );
    const harness = renderFileHistory({
      gitGateway: createFakeGitGateway({ fileHistory, fileCommitDiff }),
    });

    await act(async () => {
      await harness.panel().openFileHistory();
    });

    expect(fileHistory).toHaveBeenCalledWith(ROOT, "src/User.php");
    expect(harness.panel().fileHistoryPanelOpen).toBe(true);
    expect(harness.panel().fileHistoryRelativePath).toBe("src/User.php");
    expect(harness.panel().fileHistoryCommits).toHaveLength(2);
    expect(harness.panel().fileHistoryLoading).toBe(false);

    await act(async () => {
      await harness.panel().selectFileHistoryCommit("bbb2222");
    });

    expect(fileCommitDiff).toHaveBeenCalledWith(ROOT, "src/User.php", "bbb2222");
    expect(harness.panel().fileHistorySelectedSha).toBe("bbb2222");
    expect(harness.panel().fileHistoryDiff?.modifiedContent).toContain(
      "bbb2222",
    );

    harness.unmount();
  });

  it("closes the panel and resets every field", async () => {
    const fileHistory = vi.fn(async () => [commit("aaa1111", "First")]);
    const harness = renderFileHistory({
      gitGateway: createFakeGitGateway({ fileHistory }),
    });

    await act(async () => {
      await harness.panel().openFileHistory();
    });
    await act(async () => {
      await harness.panel().selectFileHistoryCommit("aaa1111");
    });

    act(() => {
      harness.panel().closeFileHistory();
    });

    expect(harness.panel().fileHistoryPanelOpen).toBe(false);
    expect(harness.panel().fileHistoryCommits).toEqual([]);
    expect(harness.panel().fileHistorySelectedSha).toBeNull();
    expect(harness.panel().fileHistoryDiff).toBeNull();
    expect(harness.panel().fileHistoryRelativePath).toBeNull();
    harness.unmount();
  });

  it("routes the history list and the per-commit diff into the file's nested repository root", async () => {
    const nestedRoot = `${ROOT}/packages/api`;
    const fileHistory = vi.fn(async () => [commit("ccc3333", "Nested commit")]);
    const fileCommitDiff = vi.fn(async (_root: string, _path: string, sha: string) =>
      diff(sha),
    );
    const harness = renderFileHistory({
      activeDocumentRef: {
        current: document(`${nestedRoot}/src/Controller.php`),
      },
      gitGateway: createFakeGitGateway({ fileHistory, fileCommitDiff }),
      resolveGitRepositoryTarget: () => ({
        relativePath: "src/Controller.php",
        repositoryRoot: nestedRoot,
      }),
    });

    await act(async () => {
      await harness.panel().openFileHistory();
    });

    expect(fileHistory).toHaveBeenCalledWith(nestedRoot, "src/Controller.php");

    await act(async () => {
      await harness.panel().selectFileHistoryCommit("ccc3333");
    });

    // The commit diff must run against the file's OWN repo root, not the
    // workspace root, even though the workspace root is what is re-checked for
    // per-tab isolation.
    expect(fileCommitDiff).toHaveBeenCalledWith(
      nestedRoot,
      "src/Controller.php",
      "ccc3333",
    );
    harness.unmount();
  });

  it("does nothing when the path resolver declines the active document (outside the workspace)", async () => {
    const fileHistory = vi.fn(async () => []);
    const harness = renderFileHistory({
      gitGateway: createFakeGitGateway({ fileHistory }),
      resolveGitRepositoryTarget: () => null,
    });

    await act(async () => {
      await harness.panel().openFileHistory();
    });

    expect(fileHistory).not.toHaveBeenCalled();
    expect(harness.panel().fileHistoryPanelOpen).toBe(false);
    harness.unmount();
  });

  it("does nothing when there is no active document", async () => {
    const fileHistory = vi.fn(async () => []);
    const harness = renderFileHistory({
      activeDocumentRef: { current: null },
      gitGateway: createFakeGitGateway({ fileHistory }),
    });

    await act(async () => {
      await harness.panel().openFileHistory();
    });

    expect(fileHistory).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops a stale commit list after the panel is closed (last-open-wins)", async () => {
    const deferred = createDeferred<GitFileHistoryEntry[]>();
    const fileHistory = vi.fn(() => deferred.promise);
    const harness = renderFileHistory({
      gitGateway: createFakeGitGateway({ fileHistory }),
    });

    let openPromise: Promise<void> | null = null;
    act(() => {
      openPromise = harness.panel().openFileHistory();
    });

    await act(async () => {
      harness.panel().closeFileHistory();
      await Promise.resolve();
    });

    await act(async () => {
      deferred.resolve([commit("stale", "Stale commit")]);
      await openPromise;
    });

    expect(harness.panel().fileHistoryPanelOpen).toBe(false);
    expect(harness.panel().fileHistoryCommits).toEqual([]);
    harness.unmount();
  });

  it("drops a commit list whose workspace root changed mid-flight", async () => {
    const deferred = createDeferred<GitFileHistoryEntry[]>();
    const fileHistory = vi.fn(() => deferred.promise);
    const harness = renderFileHistory({
      gitGateway: createFakeGitGateway({ fileHistory }),
    });

    let openPromise: Promise<void> | null = null;
    act(() => {
      openPromise = harness.panel().openFileHistory();
    });

    await act(async () => {
      // The active tab switched away before the history resolves.
      harness.rootRef.current = "/other";
      deferred.resolve([commit("stale", "Stale commit")]);
      await openPromise;
    });

    expect(harness.panel().fileHistoryCommits).toEqual([]);
    harness.unmount();
  });

  it("keeps only the last commit diff when selections race (per-selection last-wins)", async () => {
    const first = createDeferred<GitFileDiff>();
    const second = createDeferred<GitFileDiff>();
    const calls = [first, second];
    let call = 0;
    const fileCommitDiff = vi.fn(() => calls[call++].promise);
    const harness = renderFileHistory({
      gitGateway: createFakeGitGateway({ fileCommitDiff }),
    });

    // A relative path must already be tracked (set by an open) before a
    // commit selection is meaningful.
    await act(async () => {
      await harness.panel().openFileHistory();
    });

    let firstSelect: Promise<void> | null = null;
    let secondSelect: Promise<void> | null = null;
    act(() => {
      firstSelect = harness.panel().selectFileHistoryCommit("first-sha");
      secondSelect = harness.panel().selectFileHistoryCommit("second-sha");
    });

    await act(async () => {
      // Resolve the superseded (first) request last; its result must be
      // dropped.
      second.resolve(diff("second-sha"));
      await secondSelect;
      first.resolve(diff("first-sha"));
      await firstSelect;
    });

    expect(harness.panel().fileHistoryDiff?.modifiedContent).toContain(
      "second-sha",
    );
    expect(harness.panel().fileHistorySelectedSha).toBe("second-sha");
    harness.unmount();
  });

  it("reports an error and clears the diff when the commit diff fetch fails", async () => {
    const fileCommitDiff = vi.fn(async () => {
      throw new Error("boom");
    });
    const harness = renderFileHistory({
      gitGateway: createFakeGitGateway({ fileCommitDiff }),
    });

    await act(async () => {
      await harness.panel().openFileHistory();
    });
    await act(async () => {
      await harness.panel().selectFileHistoryCommit("bad-sha");
    });

    expect(harness.panel().fileHistoryDiff).toBeNull();
    expect(harness.reportError).toHaveBeenCalledWith(
      "File History",
      expect.any(Error),
    );
    harness.unmount();
  });
});
