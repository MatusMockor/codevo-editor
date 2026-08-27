import { useCallback, type MutableRefObject } from "react";
import {
  hasRecentlyClosedTabs,
  popRecentlyClosedTab,
  pushRecentlyClosedTab,
  type RecentlyClosedTabs,
} from "../domain/recentlyClosedTabs";
import type { EditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { WorkspaceSessionViewState } from "../domain/settings";
import type { EditorDocument } from "../domain/workspace";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { isDirty } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { DocumentTabSessionPort } from "./documentTabSessionPort";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";

export interface DocumentCloseSessionPort {
  getActivePath: DocumentTabSessionPort["getActivePath"];
  getDocument: DocumentTabSessionPort["getDocument"];
  removeDocument: DocumentTabSessionPort["removeDocument"];
}

export interface DocumentCloseOptions {
  recordRecentlyClosed?: boolean;
  skipConfirmation?: boolean;
}

export type DocumentLifecycleWorkspaceAuthority =
  | {
      readonly kind: "registered";
      readonly claimGeneration: number;
      readonly identity: WorkspaceIdentityDescriptor;
      readonly owner: WorkspaceRuntimeOwner;
      readonly rootPath: string;
    }
  | {
      readonly editorSessionOwnerKey: EditorSessionOwnerKey | null;
      readonly kind: "legacy";
      readonly owner: WorkspaceRuntimeOwner | null;
      readonly requestGeneration: number;
      readonly rootPath: string;
    };

export interface DocumentCloseLifecycleDependencies {
  workspaceRoot: string | null;
  editorSessionOwnerKey: EditorSessionOwnerKey | null;
  documentTabSession: DocumentCloseSessionPort;

  currentEditorSessionOwnerKeyRef: MutableRefObject<EditorSessionOwnerKey | null>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  captureWorkspaceAuthority: (rootPath: string) => DocumentLifecycleWorkspaceAuthority | null;
  isWorkspaceAuthorityCurrent: (authority: DocumentLifecycleWorkspaceAuthority) => boolean;
  externallyRemovedDocumentRootByPathRef: MutableRefObject<Record<string, string>>;
  recentlyClosedTabsRef: MutableRefObject<RecentlyClosedTabs>;

  prompter: WorkbenchPrompter;
  invalidateDocumentSave: (rootPath: string, path: string) => void;
  syncClosedDocument: (document: EditorDocument) => Promise<void>;
  syncClosedJavaScriptTypeScriptDocument: (document: EditorDocument) => Promise<void>;
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
    shouldCommit?: () => boolean,
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
    editorSessionOwnerKey,
    documentTabSession,
    currentEditorSessionOwnerKeyRef,
    currentWorkspaceRootRef,
    captureWorkspaceAuthority,
    isWorkspaceAuthorityCurrent,
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

  const closeDocumentUnsafe = useCallback(
    (path: string, options: DocumentCloseOptions = {}): Promise<void> | void => {
      const document = documentTabSession.getDocument(path);
      const rootPath = currentWorkspaceRootRef.current;
      const workspaceAuthority = rootPath ? captureWorkspaceAuthority(rootPath) : null;
      const ownerKey = currentEditorSessionOwnerKeyRef.current;
      const externallyRemovedRoot = externallyRemovedDocumentRootByPathRef.current[path];
      const hasExternalConflict = document ? hasExternalFileConflict(rootPath, path) : false;

      const finishClose = () => {
        if (rootPath && (!workspaceAuthority || !isWorkspaceAuthorityCurrent(workspaceAuthority))) {
          return;
        }
        if (currentWorkspaceRootRef.current !== rootPath) return;
        if (currentEditorSessionOwnerKeyRef.current !== ownerKey) return;
        if (documentTabSession.getDocument(path) !== document) return;

        if (rootPath) {
          invalidateDocumentSave(rootPath, path);
        }

        if (document && rootPath && ownerKey && options.recordRecentlyClosed !== false) {
          const viewState = recentlyClosedDocumentViewState(rootPath, path);
          recentlyClosedTabsRef.current = pushRecentlyClosedTab(
            recentlyClosedTabsRef.current,
            ownerKey,
            {
              path,
              ...(viewState ? { viewState } : {}),
            },
          );
          onRecentlyClosedTabsChange();
        }

        if (document) {
          void syncClosedDocument(document).catch(() => undefined);
          void syncClosedJavaScriptTypeScriptDocument(document).catch(() => undefined);
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

        if (!removal.closedActiveDocument || !removal.nextActivePath) return;

        if (isGitDiffDocumentPath(removal.nextActivePath)) {
          loadGitDiffDocument(removal.nextActivePath);
        }
      };

      if (
        !document ||
        options.skipConfirmation === true ||
        (!hasExternalConflict && !isDirty(document))
      ) {
        finishClose();
        return;
      }

      let confirmation: Promise<boolean> | boolean;
      try {
        confirmation = prompter.confirm(
          hasExternalConflict
            ? "Close file with an unresolved external conflict?"
            : "Discard changes?",
        );
      } catch {
        return;
      }
      if (typeof confirmation === "boolean") {
        if (confirmation === true) finishClose();
        return;
      }
      return Promise.resolve(confirmation).then((confirmed) => {
        if (confirmed === true) finishClose();
      });
    },
    [
      cancelGitDiffDocument,
      captureWorkspaceAuthority,
      clearExternalFileConflict,
      clearLanguageServerDiagnosticsForPath,
      clearPhpLocalDiagnosticsForPath,
      currentEditorSessionOwnerKeyRef,
      currentWorkspaceRootRef,
      documentTabSession,
      externallyRemovedDocumentRootByPathRef,
      hasExternalFileConflict,
      invalidateDocumentSave,
      isWorkspaceAuthorityCurrent,
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

  const closeDocument = useCallback(
    (path: string, options: DocumentCloseOptions = {}): void => {
      try {
        const pending = closeDocumentUnsafe(path, options);
        if (pending) void pending.catch(() => undefined);
      } catch {
        return;
      }
    },
    [closeDocumentUnsafe],
  );

  const closeActiveSurface = useCallback(
    (options: DocumentCloseOptions = {}): void => {
      try {
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
      } catch {
        return;
      }
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
    const ownerKey = currentEditorSessionOwnerKeyRef.current;

    if (!rootPath || !ownerKey) {
      return;
    }
    const workspaceAuthority = captureWorkspaceAuthority(rootPath);
    if (!workspaceAuthority) {
      return;
    }

    while (hasRecentlyClosedTabs(recentlyClosedTabsRef.current, ownerKey)) {
      if (!isWorkspaceAuthorityCurrent(workspaceAuthority)) {
        return;
      }
      const capturedRecentlyClosedTabs = recentlyClosedTabsRef.current;
      const popped = popRecentlyClosedTab(capturedRecentlyClosedTabs, ownerKey);

      if (!popped.entry) {
        return;
      }

      if (documentTabSession.getDocument(popped.entry.path)) {
        if (recentlyClosedTabsRef.current !== capturedRecentlyClosedTabs) {
          return;
        }
        recentlyClosedTabsRef.current = popped.tabs;
        onRecentlyClosedTabsChange();
        continue;
      }

      const opened = await openRecentlyClosedDocument(rootPath, popped.entry.path, () =>
        isWorkspaceAuthorityCurrent(workspaceAuthority),
      );

      if (
        !isWorkspaceAuthorityCurrent(workspaceAuthority) ||
        recentlyClosedTabsRef.current !== capturedRecentlyClosedTabs ||
        currentEditorSessionOwnerKeyRef.current !== ownerKey ||
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)
      ) {
        return;
      }
      recentlyClosedTabsRef.current = popped.tabs;
      onRecentlyClosedTabsChange();

      if (!opened) {
        continue;
      }

      if (popped.entry.viewState) {
        if (!isWorkspaceAuthorityCurrent(workspaceAuthority)) {
          return;
        }
        restoreRecentlyClosedDocumentViewState(rootPath, popped.entry.path, popped.entry.viewState);
      }

      return;
    }
  }, [
    captureWorkspaceAuthority,
    currentEditorSessionOwnerKeyRef,
    currentWorkspaceRootRef,
    documentTabSession,
    isWorkspaceAuthorityCurrent,
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
      editorSessionOwnerKey &&
      hasRecentlyClosedTabs(recentlyClosedTabsRef.current, editorSessionOwnerKey),
    ),
  };
}
