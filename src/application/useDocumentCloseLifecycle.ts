import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
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
import { planDocumentClose } from "./documentCloseLifecycle";
import type { WorkbenchPrompter } from "./workbenchPrompter";

export interface DocumentCloseOptions {
  recordRecentlyClosed?: boolean;
  skipConfirmation?: boolean;
}

export interface DocumentCloseLifecycleDependencies {
  workspaceRoot: string | null;
  activeDocument: EditorDocument | null;
  activePath: string | null;
  gitStatus: GitStatus;
  selectedGitChange: GitChangedFile | null;
  gitDiffLoading: boolean;

  currentWorkspaceRootRef: MutableRefObject<string | null>;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  openPathsRef: MutableRefObject<string[]>;
  previewPathRef: MutableRefObject<string | null>;
  externallyRemovedDocumentRootByPathRef: MutableRefObject<
    Record<string, string>
  >;
  gitDiffRequestTokenRef: MutableRefObject<number>;
  selectedGitChangeRef: MutableRefObject<GitChangedFile | null>;
  recentlyClosedTabsRef: MutableRefObject<RecentlyClosedTabs>;

  setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  setPreviewPath: Dispatch<SetStateAction<string | null>>;
  setOpenPaths: Dispatch<SetStateAction<string[]>>;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setGitDiffLoading: Dispatch<SetStateAction<boolean>>;
  setSelectedGitChange: Dispatch<SetStateAction<GitChangedFile | null>>;
  setGitDiffPreview: Dispatch<SetStateAction<GitFileDiff | null>>;
  setMessage: Dispatch<SetStateAction<string | null>>;

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
    activeDocument,
    activePath,
    gitStatus,
    selectedGitChange,
    gitDiffLoading,
    currentWorkspaceRootRef,
    activeDocumentRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    externallyRemovedDocumentRootByPathRef,
    gitDiffRequestTokenRef,
    selectedGitChangeRef,
    recentlyClosedTabsRef,
    setDocuments,
    setPreviewPath,
    setOpenPaths,
    setActivePath,
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
      const effectiveActivePath = activeDocumentRef.current?.path ?? activePath;
      const plan = planDocumentClose({
        closePath: path,
        activePath: effectiveActivePath,
        documents: documentsRef.current,
        openPaths: openPathsRef.current,
        previewPath: previewPathRef.current,
        gitStatusChanges: gitStatus.changes,
        gitChangeForDiffDocumentPath,
      });
      const { document } = plan;
      const externallyRemovedRoot =
        externallyRemovedDocumentRootByPathRef.current[path];
      const hasExternalConflict = document
        ? hasExternalFileConflict(workspaceRoot, path)
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

      const rootPath = currentWorkspaceRootRef.current;

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
        clearExternalFileConflict(workspaceRoot, path);
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

      documentsRef.current = plan.nextDocuments;
      openPathsRef.current = plan.nextOpenPaths;
      previewPathRef.current = plan.nextPreviewPath;
      if (activeDocumentRef.current?.path === path) {
        activeDocumentRef.current = plan.nextActivePath
          ? (plan.nextDocuments[plan.nextActivePath] ?? null)
          : null;
      }

      setDocuments((current) => {
        const next = { ...current };
        delete next[path];
        return next;
      });
      setPreviewPath((current) => (current === path ? null : current));
      setOpenPaths((current) => current.filter((item) => item !== path));

      if (!plan.closedActiveDocument) {
        return;
      }

      if (plan.nextActivePath && plan.nextGitChange) {
        loadGitDiffDocument(plan.nextActivePath, plan.nextGitChange);
        return;
      }

      setActivePath(plan.nextActivePath);
    },
    [
      activeDocumentRef,
      activePath,
      clearExternalFileConflict,
      clearLanguageServerDiagnosticsForPath,
      clearPhpLocalDiagnosticsForPath,
      currentWorkspaceRootRef,
      documentsRef,
      externallyRemovedDocumentRootByPathRef,
      gitChangeForDiffDocumentPath,
      gitDiffRequestTokenRef,
      gitStatus.changes,
      hasExternalFileConflict,
      invalidateDocumentSave,
      isGitDiffDocumentPath,
      loadGitDiffDocument,
      onRecentlyClosedTabsChange,
      openPathsRef,
      previewPathRef,
      prompter,
      recentlyClosedDocumentViewState,
      recentlyClosedTabsRef,
      selectedGitChangeRef,
      setActivePath,
      setDocuments,
      setGitDiffLoading,
      setGitDiffPreview,
      setMessage,
      setOpenPaths,
      setPreviewPath,
      setSelectedGitChange,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
      workspaceRoot,
    ],
  );

  const closeActiveSurface = useCallback(
    (options: DocumentCloseOptions = {}) => {
      if (selectedGitChangeRef.current || selectedGitChange || gitDiffLoading) {
        closeGitDiffPreview();
        return;
      }

      const currentActiveDocument = activeDocumentRef.current ?? activeDocument;
      if (currentActiveDocument) {
        closeDocument(currentActiveDocument.path, options);
        return;
      }

      closeEmptyWorkbenchSurface();
    },
    [
      activeDocument,
      activeDocumentRef,
      closeDocument,
      closeEmptyWorkbenchSurface,
      closeGitDiffPreview,
      gitDiffLoading,
      selectedGitChange,
      selectedGitChangeRef,
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

      if (documentsRef.current[popped.entry.path]) {
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
    documentsRef,
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
