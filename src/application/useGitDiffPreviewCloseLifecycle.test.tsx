// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { GitChangedFile } from "../domain/git";
import type { DocumentTabSessionPort } from "./documentTabSessionPort";
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
  const secondPath = gitDiffDocumentPath(secondChange);
  const removeDocument = vi.fn(() => ({
    closedActiveDocument: true,
    nextActivePath: secondPath,
    removedDocument: null,
  }));

  return {
    gitStatusChanges: [firstChange, secondChange],
    selectedGitChange: firstChange,
    documentTabSession: { removeDocument } as unknown as DocumentTabSessionPort,
    selectedGitChangeRef: { current: firstChange },
    clearGitDiffPreviewState: vi.fn(),
    gitDiffDocumentPath,
    gitChangeForDiffDocumentPath: (path, changes) =>
      changes.find((change) => gitDiffDocumentPath(change) === path) ?? null,
    loadGitDiffDocument: vi.fn(),
    ...overrides,
  };
}

describe("useGitDiffPreviewCloseLifecycle", () => {
  it("loads the next git diff after closing the active preview", () => {
    const firstChange = changedFile("/workspace/src/First.php");
    const secondChange = changedFile("/workspace/src/Second.php");
    const firstPath = gitDiffDocumentPath(firstChange);
    const secondPath = gitDiffDocumentPath(secondChange);
    const removeDocument = vi.fn(() => ({
      closedActiveDocument: true,
      nextActivePath: secondPath,
      removedDocument: null,
    }));
    const deps = createDependencies({
      documentTabSession: {
        removeDocument,
      } as unknown as DocumentTabSessionPort,
    });
    const harness = renderLifecycle(deps);

    act(() => {
      harness.lifecycle().closeGitDiffPreview();
    });

    expect(deps.clearGitDiffPreviewState).toHaveBeenCalledTimes(1);
    expect(removeDocument).toHaveBeenCalledWith(firstPath);
    expect(vi.mocked(deps.clearGitDiffPreviewState).mock.invocationCallOrder[0])
      .toBeLessThan(removeDocument.mock.invocationCallOrder[0]);
    expect(deps.loadGitDiffDocument).toHaveBeenCalledWith(
      secondPath,
      secondChange,
    );

    harness.unmount();
  });

  it.each(["/workspace/src/Ordinary.php", null])(
    "does not reload for an ordinary or null fallback (%s)",
    (nextActivePath) => {
      const deps = createDependencies({
        documentTabSession: {
          removeDocument: vi.fn(() => ({
            closedActiveDocument: true,
            nextActivePath,
            removedDocument: null,
          })),
        } as unknown as DocumentTabSessionPort,
      });
      const harness = renderLifecycle(deps);

      act(() => {
        harness.lifecycle().closeGitDiffPreview();
      });

      expect(deps.loadGitDiffDocument).not.toHaveBeenCalled();

      harness.unmount();
    },
  );

  it("does not reload a git fallback when closing a nonactive preview", () => {
    const secondChange = changedFile("/workspace/src/Second.php");
    const deps = createDependencies({
      documentTabSession: {
        removeDocument: vi.fn(() => ({
          closedActiveDocument: false,
          nextActivePath: gitDiffDocumentPath(secondChange),
          removedDocument: null,
        })),
      } as unknown as DocumentTabSessionPort,
    });
    const harness = renderLifecycle(deps);

    act(() => {
      harness.lifecycle().closeGitDiffPreview();
    });

    expect(deps.loadGitDiffDocument).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("clears git state without removing a document when no change is selected", () => {
    const removeDocument = vi.fn();
    const deps = createDependencies({
      selectedGitChange: null,
      selectedGitChangeRef: { current: null },
      documentTabSession: {
        removeDocument,
      } as unknown as DocumentTabSessionPort,
    });
    const harness = renderLifecycle(deps);

    act(() => {
      harness.lifecycle().closeGitDiffPreview();
    });

    expect(deps.clearGitDiffPreviewState).toHaveBeenCalledTimes(1);
    expect(removeDocument).not.toHaveBeenCalled();
    expect(deps.loadGitDiffDocument).not.toHaveBeenCalled();

    harness.unmount();
  });
});
