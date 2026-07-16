import { useCallback } from "react";
import type { GitChangedFile } from "../domain/git";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
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
  reloadGitDiffDocument: (path: string) => void;
  reconcileGitDiffDocument: (path: string, change: GitChangedFile) => void;
}

export interface GitDiffPreviewCloseLifecycle {
  closeGitDiffPreview: () => void;
  reconcileSelectedGitDiffPreviewForRepository: (
    repositoryRoot: string,
    changes: GitChangedFile[],
  ) => void;
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
    reloadGitDiffDocument,
    reconcileGitDiffDocument,
  } = dependencies;

  const reconcileSelectedGitDiffPreviewForRepository = useCallback(
    (repositoryRoot: string, changes: GitChangedFile[]) => {
      const selectedDiffDocument = getSelectedGitDiffDocument();

      if (!selectedDiffDocument) {
        return;
      }

      if (
        !workspaceRootKeysEqual(
          selectedDiffDocument.repositoryRoot,
          repositoryRoot,
        )
      ) {
        return;
      }

      const documentPath = selectedDiffDocument.documentPath;
      const refreshedChange = gitChangeForDiffDocumentPath(documentPath, changes);

      if (refreshedChange) {
        reconcileGitDiffDocument(documentPath, refreshedChange);
        reloadGitDiffDocument(documentPath);
        return;
      }

      cancelGitDiffDocument(documentPath);
      const { closedActiveDocument, nextActivePath } =
        documentTabSession.removeDocument(documentPath);

      if (!closedActiveDocument || !nextActivePath) {
        return;
      }

      if (getGitDiffDocument(nextActivePath)) {
        reloadGitDiffDocument(nextActivePath);
      }
    },
    [
      cancelGitDiffDocument,
      documentTabSession,
      getGitDiffDocument,
      getSelectedGitDiffDocument,
      gitChangeForDiffDocumentPath,
      reloadGitDiffDocument,
      reconcileGitDiffDocument,
    ],
  );

  const closeGitDiffPreview = useCallback(() => {
    const selectedDiffDocument = getSelectedGitDiffDocument();

    if (!selectedDiffDocument) {
      return;
    }

    reconcileSelectedGitDiffPreviewForRepository(
      selectedDiffDocument.repositoryRoot,
      [],
    );
  }, [getSelectedGitDiffDocument, reconcileSelectedGitDiffPreviewForRepository]);

  return {
    closeGitDiffPreview,
    reconcileSelectedGitDiffPreviewForRepository,
  };
}
