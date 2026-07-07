// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { GitChangedFile, GitFileDiff, GitGateway } from "../domain/git";
import type { EditorDocument } from "../domain/workspace";
import {
  gitChangeForDiffDocumentPath,
  gitChangesReferToSameDiff,
  gitDiffDocumentPath,
  useGitDiffWorkspace,
  type GitDiffWorkspace,
  type GitDiffWorkspaceDependencies,
} from "./useGitDiffWorkspace";

const ROOT = "/workspace";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

interface HarnessState {
  activePath: string | null;
  documents: Record<string, EditorDocument>;
  message: string | null;
  openPaths: string[];
  previewPath: string | null;
}

interface Harness {
  activeDocumentRef: { current: EditorDocument | null };
  currentWorkspaceRootRef: { current: string | null };
  git: () => GitDiffWorkspace;
  recordCurrentNavigationLocation: ReturnType<typeof vi.fn>;
  reportError: ReturnType<typeof vi.fn>;
  state: () => HarnessState;
  unmount: () => void;
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

function diff(change: GitChangedFile): GitFileDiff {
  return {
    change,
    language: "typescript",
    modifiedContent: "modified",
    originalContent: "original",
  };
}

function createFakeGitGateway(
  getDiff: GitGateway["getDiff"] = vi.fn(async (_root, change) => diff(change)),
): GitGateway {
  return { getDiff } as unknown as GitGateway;
}

function renderGitDiffWorkspace(
  overrides: Partial<GitDiffWorkspaceDependencies> = {},
): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: {
    git: GitDiffWorkspace | null;
    state: HarnessState | null;
  } = { git: null, state: null };
  const currentWorkspaceRootRef = { current: ROOT };
  const activeDocumentRef: { current: EditorDocument | null } = {
    current: null,
  };
  const documentsRef: { current: Record<string, EditorDocument> } = {
    current: {},
  };
  const openPathsRef: { current: string[] } = { current: [] };
  const previewPathRef: { current: string | null } = { current: null };
  const recordCurrentNavigationLocation = vi.fn();
  const reportError = vi.fn();

  function HarnessComponent() {
    const [documents, setDocuments] = useState<Record<string, EditorDocument>>(
      {},
    );
    const [openPaths, setOpenPaths] = useState<string[]>([]);
    const [previewPath, setPreviewPath] = useState<string | null>(null);
    const [activePath, setActivePath] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    captured.git = useGitDiffWorkspace({
      workspaceRoot: ROOT,
      gitGateway: createFakeGitGateway(),
      currentWorkspaceRootRef,
      activeDocumentRef,
      documentsRef,
      openPathsRef,
      previewPathRef,
      setDocuments,
      setOpenPaths,
      setPreviewPath,
      setActivePath,
      setMessage,
      recordCurrentNavigationLocation,
      reportError,
      ...overrides,
    });
    captured.state = {
      activePath,
      documents,
      message,
      openPaths,
      previewPath,
    };
    return null;
  }

  act(() => {
    root.render(<HarnessComponent />);
  });

  return {
    activeDocumentRef,
    currentWorkspaceRootRef,
    git: () => {
      if (!captured.git) {
        throw new Error("hook not mounted");
      }
      return captured.git;
    },
    recordCurrentNavigationLocation,
    reportError,
    state: () => {
      if (!captured.state) {
        throw new Error("hook not mounted");
      }
      return captured.state;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("git diff workspace helpers", () => {
  it("matches worktree and staged pseudo-document paths independently", () => {
    const worktreeChange = changedFile("src/App.tsx");
    const stagedChange = changedFile("src/App.tsx", { isStaged: true });

    expect(gitDiffDocumentPath(worktreeChange)).toBe(
      "mockor-git-diff:worktree:/workspace/src/App.tsx",
    );
    expect(gitDiffDocumentPath(stagedChange)).toBe(
      "mockor-git-diff:staged:/workspace/src/App.tsx",
    );
    const stagedPath = gitDiffDocumentPath(stagedChange);
    expect(
      gitChangeForDiffDocumentPath(stagedPath, [
        worktreeChange,
        stagedChange,
      ]),
    ).toBe(stagedChange);
    expect(gitChangesReferToSameDiff(worktreeChange, stagedChange)).toBe(false);
  });
});

describe("useGitDiffWorkspace", () => {
  it("opens a pinned read-only pseudo-document for a git change", async () => {
    const change = changedFile("src/App.tsx");
    const harness = renderGitDiffWorkspace();

    await act(async () => {
      await harness.git().openGitChange(change);
    });

    const documentPath = gitDiffDocumentPath(change);
    expect(harness.git().selectedGitChange).toBe(change);
    expect(harness.git().gitDiffPreview).toEqual(diff(change));
    expect(harness.git().gitDiffLoading).toBe(false);
    expect(harness.activeDocumentRef.current).toMatchObject({
      path: documentPath,
      readOnly: true,
    });
    expect(harness.state()).toMatchObject({
      activePath: documentPath,
      message: "Diff src/App.tsx",
      openPaths: [documentPath],
      previewPath: null,
    });
    expect(harness.state().documents[documentPath]).toMatchObject({
      name: "Diff: App.tsx",
      readOnly: true,
    });
    expect(harness.recordCurrentNavigationLocation).toHaveBeenCalledTimes(1);
    expect(harness.reportError).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("ignores stale diff responses after a newer git change is selected", async () => {
    const firstChange = changedFile("src/First.ts");
    const secondChange = changedFile("src/Second.ts");
    const firstDiff = createDeferred<GitFileDiff>();
    const secondDiff = createDeferred<GitFileDiff>();
    const getDiff = vi
      .fn<GitGateway["getDiff"]>()
      .mockReturnValueOnce(firstDiff.promise)
      .mockReturnValueOnce(secondDiff.promise);
    const harness = renderGitDiffWorkspace({
      gitGateway: createFakeGitGateway(getDiff),
    });
    let firstOpen!: Promise<void>;
    let secondOpen!: Promise<void>;

    act(() => {
      firstOpen = harness.git().openGitChange(firstChange);
    });
    act(() => {
      secondOpen = harness.git().openGitChange(secondChange);
    });

    await act(async () => {
      secondDiff.resolve(diff(secondChange));
      await secondOpen;
    });
    expect(harness.git().selectedGitChange).toBe(secondChange);
    expect(harness.git().gitDiffPreview).toEqual(diff(secondChange));
    expect(harness.git().gitDiffLoading).toBe(false);

    await act(async () => {
      firstDiff.resolve(diff(firstChange));
      await firstOpen;
    });
    expect(harness.git().selectedGitChange).toBe(secondChange);
    expect(harness.git().gitDiffPreview).toEqual(diff(secondChange));
    expect(harness.state().message).toBe("Diff src/Second.ts");

    harness.unmount();
  });
});
