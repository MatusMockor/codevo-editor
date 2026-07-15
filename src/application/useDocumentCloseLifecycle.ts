import { useCallback, type MutableRefObject } from "react";
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
  documentTabSession: DocumentCloseSessionPort;

  currentWorkspaceRootRef: MutableRefObject<string | null>;
  externallyRemovedDocumentRootByPathRef: MutableRefObject<
    Record<string, string>
  >;
  recentlyClosedTabsRef: MutableRefObject<RecentlyClosedTabs>;

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

  cancelGitDiffDocument: (path: string) => void;
  loadGitDiffDocument: (path: string) => void;
  closeGitDiffPreview: () => void;
  closeEmptyWorkbenchSurface: () => void;
  isGitDiffDocumentPath: (path: string) => boolean;

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
    documentTabSession,
    currentWorkspaceRootRef,
    externallyRemovedDocumentRootByPathRef,
    recentlyClosedTabsRef,
    prompter,
    invalidateDocumentSave,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    clearPhpLocalDiagnosticsForPath,
    clearLanguageServerDiagnosticsForPath,
    hasExternalFileConflict = () => false,
    clearExternalFileConflict = () => {},
    cancelGitDiffDocument,
    loadGitDiffDocument,
    closeGitDiffPreview,
    closeEmptyWorkbenchSurface,
    isGitDiffDocumentPath,
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
        cancelGitDiffDocument(path);
      }

      const removal = documentTabSession.removeDocument(path);

      if (!removal.closedActiveDocument || !removal.nextActivePath) {
        return;
      }

      if (isGitDiffDocumentPath(removal.nextActivePath)) {
        loadGitDiffDocument(removal.nextActivePath);
        return;
      }
    },
    [
      cancelGitDiffDocument,
      clearExternalFileConflict,
      clearLanguageServerDiagnosticsForPath,
      clearPhpLocalDiagnosticsForPath,
      currentWorkspaceRootRef,
      documentTabSession,
      externallyRemovedDocumentRootByPathRef,
      hasExternalFileConflict,
      invalidateDocumentSave,
      isGitDiffDocumentPath,
      loadGitDiffDocument,
      onRecentlyClosedTabsChange,
      prompter,
      recentlyClosedDocumentViewState,
      recentlyClosedTabsRef,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
    ],
  );

  const closeActiveSurface = useCallback(
    (options: DocumentCloseOptions = {}) => {
      const currentActivePath = documentTabSession.getActivePath();
      if (currentActivePath && isGitDiffDocumentPath(currentActivePath)) {
        closeGitDiffPreview();
        return;
      }

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
      isGitDiffDocumentPath,
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
