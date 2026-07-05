// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { GitChangedFile } from "../domain/git";
import type { EditorDocument } from "../domain/workspace";
import {
  useGitDiffPreviewCloseLifecycle,
  type GitDiffPreviewCloseLifecycle,
  type GitDiffPreviewCloseLifecycleDependencies,
} from "./useGitDiffPreviewCloseLifecycle";

function changedFile(path: string): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path,
    relativePath: path,
    status: "modified",
  };
}

function gitDiffDocumentPath(change: GitChangedFile): string {
  return `mockor-git-diff:worktree:${change.path}`;
}

function editorDocument(path: string): EditorDocument {
  return {
    content: "",
    language: "plaintext",
    name: path,
    path,
    readOnly: true,
    savedContent: "",
  };
}

function renderLifecycle(
  deps: GitDiffPreviewCloseLifecycleDependencies,
): { lifecycle: () => GitDiffPreviewCloseLifecycle; unmount: () => void } {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { lifecycle: GitDiffPreviewCloseLifecycle | null } = {
    lifecycle: null,
  };

  function Harness() {
    captured.lifecycle = useGitDiffPreviewCloseLifecycle(deps);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    lifecycle: () => {
      if (!captured.lifecycle) {
        throw new Error("hook not mounted");
      }

      return captured.lifecycle;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function createDependencies(
  overrides: Partial<GitDiffPreviewCloseLifecycleDependencies> = {},
): GitDiffPreviewCloseLifecycleDependencies {
  const firstChange = changedFile("/workspace/src/First.php");
  const secondChange = changedFile("/workspace/src/Second.php");
  const firstPath = gitDiffDocumentPath(firstChange);
  const secondPath = gitDiffDocumentPath(secondChange);

  return {
    gitStatusChanges: [firstChange, secondChange],
    selectedGitChange: firstChange,
    documentsRef: {
      current: {
        [firstPath]: editorDocument(firstPath),
        [secondPath]: editorDocument(secondPath),
      },
    },
    openPathsRef: { current: [firstPath, secondPath] },
    previewPathRef: { current: firstPath },
    selectedGitChangeRef: { current: firstChange },
    setDocuments: vi.fn(),
    setOpenPaths: vi.fn(),
    setPreviewPath: vi.fn(),
    setActivePath: vi.fn(),
    clearGitDiffPreviewState: vi.fn(),
    gitDiffDocumentPath,
    gitChangeForDiffDocumentPath: (path, changes) =>
      changes.find((change) => gitDiffDocumentPath(change) === path) ?? null,
    loadGitDiffDocument: vi.fn(),
    ...overrides,
  };
}

describe("useGitDiffPreviewCloseLifecycle", () => {
  it("removes the selected git diff pseudo-document and loads the next git diff tab", () => {
    const firstChange = changedFile("/workspace/src/First.php");
    const secondChange = changedFile("/workspace/src/Second.php");
    const firstPath = gitDiffDocumentPath(firstChange);
    const secondPath = gitDiffDocumentPath(secondChange);
    const deps = createDependencies({
      gitStatusChanges: [firstChange, secondChange],
      selectedGitChange: firstChange,
      selectedGitChangeRef: { current: firstChange },
      documentsRef: {
        current: {
          [firstPath]: editorDocument(firstPath),
          [secondPath]: editorDocument(secondPath),
        },
      },
      openPathsRef: { current: [firstPath, secondPath] },
      previewPathRef: { current: firstPath },
    });
    const harness = renderLifecycle(deps);

    act(() => {
      harness.lifecycle().closeGitDiffPreview();
    });

    expect(deps.clearGitDiffPreviewState).toHaveBeenCalledTimes(1);
    expect(deps.documentsRef.current).toEqual({
      [secondPath]: editorDocument(secondPath),
    });
    expect(deps.openPathsRef.current).toEqual([secondPath]);
    expect(deps.previewPathRef.current).toBeNull();
    expect(deps.loadGitDiffDocument).toHaveBeenCalledWith(
      secondPath,
      secondChange,
    );
    expect(deps.setActivePath).not.toHaveBeenCalled();

    harness.unmount();
  });
});
