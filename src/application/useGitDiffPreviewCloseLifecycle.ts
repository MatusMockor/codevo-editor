import { useCallback } from "react";
import type { GitChangedFile } from "../domain/git";
import type { DocumentTabSessionPort } from "./documentTabSessionPort";
import type { GitDiffDocumentState } from "./useGitDiffWorkspace";

export interface GitDiffPreviewCloseLifecycleDependencies {
  documentTabSession: DocumentTabSessionPort;

  cancelGitDiffDocument: (path: string) => void;
  getGitDiffDocument: (path: string) => GitDiffDocumentState | null;
  getSelectedGitDiffDocument: () => GitDiffDocumentState | null;
  gitChangeForDiffDocumentPath: (
    path: string,
    changes: GitChangedFile[],
  ) => GitChangedFile | null;
  loadGitDiffDocument: (path: string) => void;
  reconcileGitDiffDocument: (path: string, change: GitChangedFile) => void;
}

export interface GitDiffPreviewCloseLifecycle {
  closeGitDiffPreview: () => void;
  closeSelectedGitDiffPreviewForChanges: (changes: GitChangedFile[]) => void;
}

export function useGitDiffPreviewCloseLifecycle(
  dependencies: GitDiffPreviewCloseLifecycleDependencies,
): GitDiffPreviewCloseLifecycle {
  const {
    documentTabSession,
    cancelGitDiffDocument,
    getGitDiffDocument,
    getSelectedGitDiffDocument,
    gitChangeForDiffDocumentPath,
    loadGitDiffDocument,
    reconcileGitDiffDocument,
  } = dependencies;

  const closeSelectedGitDiffPreviewForChanges = useCallback(
    (changes: GitChangedFile[]) => {
      const selectedDiffDocument = getSelectedGitDiffDocument();

      if (!selectedDiffDocument) {
        return;
      }

      const documentPath = selectedDiffDocument.documentPath;
      const refreshedChange = gitChangeForDiffDocumentPath(documentPath, changes);

      if (refreshedChange) {
        reconcileGitDiffDocument(documentPath, refreshedChange);
        return;
      }

      cancelGitDiffDocument(documentPath);
      const { closedActiveDocument, nextActivePath } =
        documentTabSession.removeDocument(documentPath);

      if (!closedActiveDocument || !nextActivePath) {
        return;
      }

      if (getGitDiffDocument(nextActivePath)) {
        loadGitDiffDocument(nextActivePath);
      }
    },
    [
      cancelGitDiffDocument,
      documentTabSession,
      getGitDiffDocument,
      getSelectedGitDiffDocument,
      gitChangeForDiffDocumentPath,
      loadGitDiffDocument,
      reconcileGitDiffDocument,
    ],
  );

  const closeGitDiffPreview = useCallback(() => {
    closeSelectedGitDiffPreviewForChanges([]);
  }, [closeSelectedGitDiffPreviewForChanges]);

  return {
    closeGitDiffPreview,
    closeSelectedGitDiffPreviewForChanges,
  };
}
