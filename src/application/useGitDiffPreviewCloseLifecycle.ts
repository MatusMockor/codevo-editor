import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { GitChangedFile } from "../domain/git";
import {
  nextActiveEditorPathAfterClose,
  type EditorDocument,
} from "../domain/workspace";

export interface GitDiffPreviewCloseLifecycleDependencies {
  gitStatusChanges: GitChangedFile[];
  selectedGitChange: GitChangedFile | null;

  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  openPathsRef: MutableRefObject<string[]>;
  previewPathRef: MutableRefObject<string | null>;
  selectedGitChangeRef: MutableRefObject<GitChangedFile | null>;

  setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  setOpenPaths: Dispatch<SetStateAction<string[]>>;
  setPreviewPath: Dispatch<SetStateAction<string | null>>;
  setActivePath: Dispatch<SetStateAction<string | null>>;

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
    documentsRef,
    openPathsRef,
    previewPathRef,
    selectedGitChangeRef,
    setDocuments,
    setOpenPaths,
    setPreviewPath,
    setActivePath,
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

      const nextActivePath = nextActiveEditorPathAfterClose(
        documentPath,
        openPathsRef.current,
        previewPathRef.current,
      );
      const nextDocumentsRef = { ...documentsRef.current };
      delete nextDocumentsRef[documentPath];
      documentsRef.current = nextDocumentsRef;
      openPathsRef.current = openPathsRef.current.filter(
        (path) => path !== documentPath,
      );
      if (previewPathRef.current === documentPath) {
        previewPathRef.current = null;
      }
      setDocuments((current) => {
        const next = { ...current };
        delete next[documentPath];
        return next;
      });
      setOpenPaths((current) => current.filter((path) => path !== documentPath));
      setPreviewPath((current) => (current === documentPath ? null : current));

      const nextGitChange = nextActivePath
        ? gitChangeForDiffDocumentPath(nextActivePath, changes)
        : null;

      if (nextActivePath && nextGitChange) {
        loadGitDiffDocument(nextActivePath, nextGitChange);
        return;
      }

      setActivePath((current) =>
        current === documentPath ? nextActivePath : current,
      );
    },
    [
      clearGitDiffPreviewState,
      documentsRef,
      gitChangeForDiffDocumentPath,
      gitDiffDocumentPath,
      loadGitDiffDocument,
      openPathsRef,
      previewPathRef,
      selectedGitChange,
      selectedGitChangeRef,
      setActivePath,
      setDocuments,
      setOpenPaths,
      setPreviewPath,
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
