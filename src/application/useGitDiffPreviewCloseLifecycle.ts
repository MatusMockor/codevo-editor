import { useCallback, type MutableRefObject } from "react";
import type { GitChangedFile } from "../domain/git";
import type { DocumentTabSessionPort } from "./documentTabSessionPort";

export interface GitDiffPreviewCloseLifecycleDependencies {
  gitStatusChanges: GitChangedFile[];
  selectedGitChange: GitChangedFile | null;

  documentTabSession: DocumentTabSessionPort;
  selectedGitChangeRef: MutableRefObject<GitChangedFile | null>;

  clearGitDiffPreviewState: () => void;
  gitDiffDocumentPath: (change: GitChangedFile) => string;
  gitChangeForDiffDocumentPath: (
    path: string,
    changes: GitChangedFile[],
  ) => GitChangedFile | null;
  loadGitDiffDocument: (path: string, gitChange: GitChangedFile) => void;
}

export interface GitDiffPreviewCloseLifecycle {
  closeGitDiffPreview: () => void;
  closeSelectedGitDiffPreviewForChanges: (changes: GitChangedFile[]) => void;
}

export function useGitDiffPreviewCloseLifecycle(
  dependencies: GitDiffPreviewCloseLifecycleDependencies,
): GitDiffPreviewCloseLifecycle {
  const {
    gitStatusChanges,
    selectedGitChange,
    documentTabSession,
    selectedGitChangeRef,
    clearGitDiffPreviewState,
    gitDiffDocumentPath,
    gitChangeForDiffDocumentPath,
    loadGitDiffDocument,
  } = dependencies;

  const closeSelectedGitDiffPreviewForChanges = useCallback(
    (changes: GitChangedFile[]) => {
      const currentSelectedGitChange =
        selectedGitChangeRef.current ?? selectedGitChange;
      const documentPath = currentSelectedGitChange
        ? gitDiffDocumentPath(currentSelectedGitChange)
        : null;

      clearGitDiffPreviewState();

      if (!documentPath) {
        return;
      }

      const { closedActiveDocument, nextActivePath } =
        documentTabSession.removeDocument(documentPath);

      if (!closedActiveDocument || !nextActivePath) {
        return;
      }

      const nextGitChange = gitChangeForDiffDocumentPath(
        nextActivePath,
        changes,
      );

      if (nextGitChange) {
        loadGitDiffDocument(nextActivePath, nextGitChange);
      }
    },
    [
      clearGitDiffPreviewState,
      documentTabSession,
      gitChangeForDiffDocumentPath,
      gitDiffDocumentPath,
      loadGitDiffDocument,
      selectedGitChange,
      selectedGitChangeRef,
    ],
  );

  const closeGitDiffPreview = useCallback(() => {
    closeSelectedGitDiffPreviewForChanges(gitStatusChanges);
  }, [closeSelectedGitDiffPreviewForChanges, gitStatusChanges]);

  return {
    closeGitDiffPreview,
    closeSelectedGitDiffPreviewForChanges,
  };
}
