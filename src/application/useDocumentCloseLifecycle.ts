import { useCallback, type MutableRefObject } from "react";
import type { GitChangedFile, GitFileDiff, GitStatus } from "../domain/git";
import {
  hasRecentlyClosedTabs,
  popRecentlyClosedTab,
  pushRecentlyClosedTab,
  type RecentlyClosedTabs,
} from "../domain/recentlyClosedTabs";
import type { WorkspaceSessionViewState } from "../domain/settings";
import type { EditorDocument } from "../domain/workspace";
import { isDirty } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { DocumentTabSessionPort } from "./documentTabSessionPort";
import type { WorkbenchPrompter } from "./workbenchPrompter";

export interface DocumentCloseSessionPort {
  getActivePath: DocumentTabSessionPort["getActivePath"];
  getDocument: DocumentTabSessionPort["getDocument"];
  removeDocument: DocumentTabSessionPort["removeDocument"];
}

export interface DocumentCloseOptions {
  recordRecentlyClosed?: boolean;
  skipConfirmation?: boolean;
}

export interface DocumentCloseLifecycleDependencies {
  workspaceRoot: string | null;
  gitStatus: GitStatus;
  selectedGitChange: GitChangedFile | null;
  gitDiffLoading: boolean;
  documentTabSession: DocumentCloseSessionPort;

  currentWorkspaceRootRef: MutableRefObject<string | null>;
  externallyRemovedDocumentRootByPathRef: MutableRefObject<
    Record<string, string>
  >;
  gitDiffRequestTokenRef: MutableRefObject<number>;
  selectedGitChangeRef: MutableRefObject<GitChangedFile | null>;
  recentlyClosedTabsRef: MutableRefObject<RecentlyClosedTabs>;

  setGitDiffLoading: (loading: boolean) => void;
  setSelectedGitChange: (change: GitChangedFile | null) => void;
  setGitDiffPreview: (diff: GitFileDiff | null) => void;
  setMessage: (message: string | null) => void;

  prompter: WorkbenchPrompter;
  invalidateDocumentSave: (rootPath: string, path: string) => void;
  syncClosedDocument: (document: EditorDocument) => Promise<void>;
  syncClosedJavaScriptTypeScriptDocument: (
    document: EditorDocument,
  ) => Promise<void>;
  clearPhpLocalDiagnosticsForPath: (diagnosticPath: string) => void;
  clearLanguageServerDiagnosticsForPath: (
    rootPath: string | null | undefined,
    diagnosticPath: string,
  ) => void;
  hasExternalFileConflict?: (rootPath: string | null, path: string) => boolean;
  clearExternalFileConflict?: (rootPath: string | null, path: string) => void;

  loadGitDiffDocument: (path: string, gitChange: GitChangedFile) => void;
  closeGitDiffPreview: () => void;
  closeEmptyWorkbenchSurface: () => void;
  isGitDiffDocumentPath: (path: string) => boolean;
  gitChangeForDiffDocumentPath: (
    path: string,
    changes: GitChangedFile[],
  ) => GitChangedFile | null;

  recentlyClosedDocumentViewState: (
    rootPath: string,
    path: string,
  ) => WorkspaceSessionViewState | undefined;
  openRecentlyClosedDocument: (
    rootPath: string,
    path: string,
  ) => Promise<boolean>;
  restoreRecentlyClosedDocumentViewState: (
    rootPath: string,
    path: string,
    viewState: WorkspaceSessionViewState,
  ) => void;
  onRecentlyClosedTabsChange: () => void;
}

export interface DocumentCloseLifecycle {
  closeDocument: (path: string, options?: DocumentCloseOptions) => void;
  closeActiveSurface: (options?: DocumentCloseOptions) => void;
  reopenClosedDocument: () => Promise<void>;
  canReopenClosedDocument: boolean;
}

export function useDocumentCloseLifecycle(
  dependencies: DocumentCloseLifecycleDependencies,
): DocumentCloseLifecycle {
  const {
    workspaceRoot,
    gitStatus,
    selectedGitChange,
    gitDiffLoading,
    documentTabSession,
    currentWorkspaceRootRef,
    externallyRemovedDocumentRootByPathRef,
    gitDiffRequestTokenRef,
    selectedGitChangeRef,
    recentlyClosedTabsRef,
    setGitDiffLoading,
    setSelectedGitChange,
    setGitDiffPreview,
    setMessage,
    prompter,
    invalidateDocumentSave,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    clearPhpLocalDiagnosticsForPath,
    clearLanguageServerDiagnosticsForPath,
    hasExternalFileConflict = () => false,
    clearExternalFileConflict = () => {},
    loadGitDiffDocument,
    closeGitDiffPreview,
    closeEmptyWorkbenchSurface,
    isGitDiffDocumentPath,
    gitChangeForDiffDocumentPath,
    recentlyClosedDocumentViewState,
    openRecentlyClosedDocument,
    restoreRecentlyClosedDocumentViewState,
    onRecentlyClosedTabsChange,
  } = dependencies;

  const closeDocument = useCallback(
    (path: string, options: DocumentCloseOptions = {}) => {
      const document = documentTabSession.getDocument(path);
      const rootPath = currentWorkspaceRootRef.current;
      const externallyRemovedRoot =
        externallyRemovedDocumentRootByPathRef.current[path];
      const hasExternalConflict = document
        ? hasExternalFileConflict(rootPath, path)
        : false;

      if (
        document &&
        options.skipConfirmation !== true &&
        (hasExternalConflict || isDirty(document)) &&
        !prompter.confirm(
          hasExternalConflict
            ? "Close file with an unresolved external conflict?"
            : "Discard changes?",
        )
      ) {
        return;
      }

      if (rootPath) {
        invalidateDocumentSave(rootPath, path);
      }

      if (document && rootPath && options.recordRecentlyClosed !== false) {
        const viewState = recentlyClosedDocumentViewState(rootPath, path);
        recentlyClosedTabsRef.current = pushRecentlyClosedTab(
          recentlyClosedTabsRef.current,
          rootPath,
          {
            path,
            ...(viewState ? { viewState } : {}),
          },
        );
        onRecentlyClosedTabsChange();
      }

      if (document) {
        void syncClosedDocument(document);
        void syncClosedJavaScriptTypeScriptDocument(document);
        clearPhpLocalDiagnosticsForPath(path);
        clearExternalFileConflict(rootPath, path);
      }

      if (externallyRemovedRoot) {
        clearLanguageServerDiagnosticsForPath(externallyRemovedRoot, path);
      }

      if (isGitDiffDocumentPath(path)) {
        gitDiffRequestTokenRef.current += 1;
        setGitDiffLoading(false);
        selectedGitChangeRef.current = null;
        setSelectedGitChange(null);
        setGitDiffPreview(null);
        setMessage(null);
      }

      const removal = documentTabSession.removeDocument(path);

      if (!removal.closedActiveDocument || !removal.nextActivePath) {
        return;
      }

      const nextGitChange = gitChangeForDiffDocumentPath(
        removal.nextActivePath,
        gitStatus.changes,
      );
      if (nextGitChange) {
        loadGitDiffDocument(removal.nextActivePath, nextGitChange);
        return;
      }
    },
    [
      clearExternalFileConflict,
      clearLanguageServerDiagnosticsForPath,
      clearPhpLocalDiagnosticsForPath,
      currentWorkspaceRootRef,
      documentTabSession,
      externallyRemovedDocumentRootByPathRef,
      gitChangeForDiffDocumentPath,
      gitDiffRequestTokenRef,
      gitStatus.changes,
      hasExternalFileConflict,
      invalidateDocumentSave,
      isGitDiffDocumentPath,
      loadGitDiffDocument,
      onRecentlyClosedTabsChange,
      prompter,
      recentlyClosedDocumentViewState,
      recentlyClosedTabsRef,
      selectedGitChangeRef,
      setGitDiffLoading,
      setGitDiffPreview,
      setMessage,
      setSelectedGitChange,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
    ],
  );

  const closeActiveSurface = useCallback(
    (options: DocumentCloseOptions = {}) => {
      if (selectedGitChangeRef.current || selectedGitChange || gitDiffLoading) {
        closeGitDiffPreview();
        return;
      }

      const currentActivePath = documentTabSession.getActivePath();
      if (currentActivePath) {
        closeDocument(currentActivePath, options);
        return;
      }

      closeEmptyWorkbenchSurface();
    },
    [
      closeDocument,
      closeEmptyWorkbenchSurface,
      closeGitDiffPreview,
      gitDiffLoading,
      selectedGitChange,
      selectedGitChangeRef,
      documentTabSession,
    ],
  );

  const reopenClosedDocument = useCallback(async () => {
    const rootPath = currentWorkspaceRootRef.current;

    if (!rootPath) {
      return;
    }

    while (hasRecentlyClosedTabs(recentlyClosedTabsRef.current, rootPath)) {
      const popped = popRecentlyClosedTab(
        recentlyClosedTabsRef.current,
        rootPath,
      );
      recentlyClosedTabsRef.current = popped.tabs;
      onRecentlyClosedTabsChange();

      if (!popped.entry) {
        return;
      }

      if (documentTabSession.getDocument(popped.entry.path)) {
        continue;
      }

      const opened = await openRecentlyClosedDocument(
        rootPath,
        popped.entry.path,
      );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      if (!opened) {
        continue;
      }

      if (popped.entry.viewState) {
        restoreRecentlyClosedDocumentViewState(
          rootPath,
          popped.entry.path,
          popped.entry.viewState,
        );
      }

      return;
    }
  }, [
    currentWorkspaceRootRef,
    documentTabSession,
    onRecentlyClosedTabsChange,
    openRecentlyClosedDocument,
    recentlyClosedTabsRef,
    restoreRecentlyClosedDocumentViewState,
  ]);

  return {
    closeDocument,
    closeActiveSurface,
    reopenClosedDocument,
    canReopenClosedDocument: Boolean(
      workspaceRoot &&
      hasRecentlyClosedTabs(recentlyClosedTabsRef.current, workspaceRoot),
    ),
  };
}
