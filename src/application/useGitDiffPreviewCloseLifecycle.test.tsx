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
    documentTabSession: { removeDocument } as unknown as DocumentTabSessionPort,
    cancelGitDiffDocument: vi.fn(),
    getGitDiffDocument: (path) => path === secondPath
      ? {
          change: secondChange,
          diff: null,
          documentPath: secondPath,
          isLoading: false,
          repositoryRoot: "/workspace",
        }
      : null,
    getSelectedGitDiffDocument: () => ({
      change: firstChange,
      diff: null,
      documentPath: gitDiffDocumentPath(firstChange),
      isLoading: false,
      repositoryRoot: "/workspace",
    }),
    gitChangeForDiffDocumentPath: (path, changes) =>
      changes.find((change) => gitDiffDocumentPath(change) === path) ?? null,
    loadGitDiffDocument: vi.fn(),
    reloadGitDiffDocument: vi.fn(),
    reconcileGitDiffDocument: vi.fn(),
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

    expect(deps.cancelGitDiffDocument).toHaveBeenCalledWith(firstPath);
    expect(removeDocument).toHaveBeenCalledWith(firstPath);
    expect(vi.mocked(deps.cancelGitDiffDocument).mock.invocationCallOrder[0])
      .toBeLessThan(removeDocument.mock.invocationCallOrder[0]);
    expect(deps.reloadGitDiffDocument).toHaveBeenCalledWith(secondPath);
    expect(deps.loadGitDiffDocument).not.toHaveBeenCalled();

    harness.unmount();
  });

  it.each(["/workspace/src/Ordinary.php", null])(
    "does not reload for an ordinary or null fallback (%s)",
    (nextActivePath) => {
      const deps = createDependencies({
        getGitDiffDocument: () => null,
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

      expect(deps.reloadGitDiffDocument).not.toHaveBeenCalled();

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

    expect(deps.reloadGitDiffDocument).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("clears git state without removing a document when no change is selected", () => {
    const removeDocument = vi.fn();
    const deps = createDependencies({
      getSelectedGitDiffDocument: () => null,
      documentTabSession: {
        removeDocument,
      } as unknown as DocumentTabSessionPort,
    });
    const harness = renderLifecycle(deps);

    act(() => {
      harness.lifecycle().closeGitDiffPreview();
    });

    expect(deps.cancelGitDiffDocument).not.toHaveBeenCalled();
    expect(removeDocument).not.toHaveBeenCalled();
    expect(deps.loadGitDiffDocument).not.toHaveBeenCalled();
    expect(deps.reloadGitDiffDocument).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("reconciles a retained selected diff without closing it", () => {
    const selected = changedFile("/workspace/src/First.php");
    const refreshed = { ...selected, status: "renamed" as const };
    const deps = createDependencies();
    const harness = renderLifecycle(deps);

    act(() => {
      harness.lifecycle().reconcileSelectedGitDiffPreviewForRepository(
        "/workspace",
        [refreshed],
      );
    });

    expect(deps.reconcileGitDiffDocument).toHaveBeenCalledWith(
      gitDiffDocumentPath(selected),
      refreshed,
    );
    expect(deps.reloadGitDiffDocument).toHaveBeenCalledWith(
      gitDiffDocumentPath(selected),
    );
    expect(deps.cancelGitDiffDocument).not.toHaveBeenCalled();
    expect(deps.documentTabSession.removeDocument).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not reconcile or reload a selected diff owned by another repository", () => {
    const deps = createDependencies();
    const harness = renderLifecycle(deps);

    act(() => {
      harness.lifecycle().reconcileSelectedGitDiffPreviewForRepository(
        "/workspace/packages/nested",
        [changedFile("/workspace/src/First.php")],
      );
    });

    expect(deps.reconcileGitDiffDocument).not.toHaveBeenCalled();
    expect(deps.loadGitDiffDocument).not.toHaveBeenCalled();
    expect(deps.reloadGitDiffDocument).not.toHaveBeenCalled();
    expect(deps.cancelGitDiffDocument).not.toHaveBeenCalled();
    expect(deps.documentTabSession.removeDocument).not.toHaveBeenCalled();
    harness.unmount();
  });
});
