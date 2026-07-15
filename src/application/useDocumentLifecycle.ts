import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ResolvedEditorConfig } from "../domain/editorConfig";
import { applyEditorConfigOnSave } from "../domain/editorConfig";
import type {
  GitChangedFile,
  GitFileDiff,
  GitStatus,
} from "../domain/git";
import type { FilePrefetchCache } from "../domain/filePrefetchCache";
import type { LocalHistoryGateway } from "../domain/localHistory";
import { isJavaScriptTypeScriptLanguageServerDocument } from "../domain/languageServerDocumentSync";
import type {
  WorkspaceSessionViewState,
  WorkspaceSettings,
} from "../domain/settings";
import {
  hasRecentlyClosedTabs,
  popRecentlyClosedTab,
  pushRecentlyClosedTab,
  type RecentlyClosedTabs,
} from "../domain/recentlyClosedTabs";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import {
  isDirty,
  readWorkspaceTextFileSnapshot,
  workspaceRelativePath,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { planDocumentClose } from "./documentCloseLifecycle";
import {
  DocumentSaveCoordinator,
  type DocumentSaveLease,
  type RunWithDocumentSaveExclusion,
} from "./documentSaveCoordinator";
import type { WorkbenchPrompter } from "./workbenchPrompter";

/**
 * Collaborators the save/close document lifecycle (region P of the workbench
 * controller decomposition) needs from the workbench shell. The format-on-save
 * / organize-imports helpers (`formattedContentForSave`,
 * `optimizedImportsContentForSave`, `organizedImportsContentForSave`,
 * `resolveEditorConfigForFile`) belong to the format-on-save flow and are shared
 * with other paths, so they stay shell-owned and are injected here. The LSP
 * document-sync did-save/did-close collaborators come from `useDocumentSync`,
 * the diagnostics cleanup from `useDiagnostics`, and the git-diff preview
 * loaders from the git flow - all injected rather than duplicated. The tab
 * state is shell-owned; its live refs and setters are injected so close/save
 * lifecycle mutations stay current across rapid open/preview operations.
 */
export interface DocumentLifecycleDependencies {
  // Shared workspace + document state (shell-owned).
  workspaceRoot: string | null;
  activeDocument: EditorDocument | null;
  documents: Record<string, EditorDocument>;
  openPaths: string[];
  activePath: string | null;
  previewPath: string | null;
  gitStatus: GitStatus;
  selectedGitChange: GitChangedFile | null;
  gitDiffLoading: boolean;
  workspaceSettings: WorkspaceSettings;

  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRequestTokenRef: MutableRefObject<number>;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  openPathsRef: MutableRefObject<string[]>;
  previewPathRef: MutableRefObject<string | null>;
  filePrefetchCacheRef: MutableRefObject<FilePrefetchCache>;
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

  // Gateways.
  localHistoryGateway: LocalHistoryGateway;
  workspaceFiles: WorkspaceFileGateway;
  prompter: WorkbenchPrompter;

  // Format-on-save / organize-imports helpers (shell-owned, shared).
  formattedContentForSave: (
    document: EditorDocument,
    requestedRoot: string,
  ) => Promise<string>;
  optimizedImportsContentForSave: (
    document: EditorDocument,
    content: string,
  ) => string;
  organizedImportsContentForSave: (
    document: EditorDocument,
    content: string,
    requestedRoot: string,
  ) => Promise<string>;
  resolveEditorConfigForFile: (
    requestedRoot: string,
    filePath: string,
  ) => Promise<ResolvedEditorConfig>;

  // LSP document sync (from useDocumentSync).
  syncSavedDocument: (
    document: EditorDocument,
    shouldEmit?: () => boolean,
  ) => Promise<void>;
  syncSavedJavaScriptTypeScriptDocument: (
    document: EditorDocument,
    shouldEmit?: () => boolean,
  ) => Promise<void>;
  syncClosedDocument: (document: EditorDocument) => Promise<void>;
  syncClosedJavaScriptTypeScriptDocument: (
    document: EditorDocument,
  ) => Promise<void>;

  // Diagnostics cleanup (from useDiagnostics).
  clearPhpLocalDiagnosticsForPath: (diagnosticPath: string) => void;
  clearLanguageServerDiagnosticsForPath: (
    rootPath: string | null | undefined,
    diagnosticPath: string,
  ) => void;

  // Git-diff preview flow.
  loadGitDiffDocument: (path: string, gitChange: GitChangedFile) => void;
  closeGitDiffPreview: () => void;
  closeEmptyWorkbenchSurface: () => void;
  isGitDiffDocumentPath: (path: string) => boolean;
  gitChangeForDiffDocumentPath: (
    path: string,
    changes: GitChangedFile[],
  ) => GitChangedFile | null;

  // Error reporters (shell-owned, workspace-root isolated).
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
  hasExternalFileConflict?: (rootPath: string | null, path: string) => boolean;
  clearExternalFileConflict?: (rootPath: string | null, path: string) => void;
  detectSaveConflict?: (
    rootPath: string,
    document: EditorDocument,
    disk: Awaited<ReturnType<typeof readWorkspaceTextFileSnapshot>> | null,
  ) => void;
  runEslintAnalysisOnSave: (rootPath: string) => void;
  runPhpstanAnalysisOnSave: (rootPath: string) => void;
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

export interface DocumentCloseOptions {
  recordRecentlyClosed?: boolean;
  skipConfirmation?: boolean;
}

export interface DocumentLifecycle {
  captureLocalHistorySnapshot: (
    requestedRoot: string,
    absolutePath: string,
    content: string,
  ) => Promise<void>;
  saveActiveDocument: () => Promise<void>;
  runWithDocumentSaveExclusion: RunWithDocumentSaveExclusion;
  closeDocument: (path: string, options?: DocumentCloseOptions) => void;
  closeActiveSurface: (options?: DocumentCloseOptions) => void;
  reopenClosedDocument: () => Promise<void>;
  canReopenClosedDocument: boolean;
}

interface DocumentSaveIdentity {
  path: string;
  requestedRoot: string;
  workspaceRequestToken: number;
}

/**
 * Save/close document lifecycle (region P of the workbench controller
 * decomposition). Owns the save flow (format-on-save + organize-imports +
 * EditorConfig compose, then write, Local History snapshot, and did-save sync),
 * the auto-save timer, the close flow (confirm-discard, did-close sync,
 * diagnostics cleanup, git-diff teardown, and active-tab reselection), and the
 * "close active surface" shortcut. Every async step captures the requested
 * workspace root up front and re-checks the active root after each await so a
 * stale result from a switched-away tab is dropped (per-project isolation).
 * Moved verbatim from useWorkbenchController.
 */
export function useDocumentLifecycle(
  dependencies: DocumentLifecycleDependencies,
): DocumentLifecycle {
  const {
    workspaceRoot,
    activeDocument,
    activePath,
    gitStatus,
    selectedGitChange,
    gitDiffLoading,
    workspaceSettings,
    currentWorkspaceRootRef,
    workspaceRequestTokenRef,
    activeDocumentRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    filePrefetchCacheRef,
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
    localHistoryGateway,
    workspaceFiles,
    prompter,
    formattedContentForSave,
    optimizedImportsContentForSave,
    organizedImportsContentForSave,
    resolveEditorConfigForFile,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    clearPhpLocalDiagnosticsForPath,
    clearLanguageServerDiagnosticsForPath,
    loadGitDiffDocument,
    closeGitDiffPreview,
    closeEmptyWorkbenchSurface,
    isGitDiffDocumentPath,
    gitChangeForDiffDocumentPath,
    reportErrorForActiveWorkspaceRoot,
    hasExternalFileConflict = () => false,
    clearExternalFileConflict = () => {},
    detectSaveConflict = () => {},
    runEslintAnalysisOnSave,
    runPhpstanAnalysisOnSave,
    recentlyClosedDocumentViewState,
    openRecentlyClosedDocument,
    restoreRecentlyClosedDocumentViewState,
    onRecentlyClosedTabsChange,
  } = dependencies;
  const documentSaveCoordinatorRef = useRef<DocumentSaveCoordinator | null>(
    null,
  );
  if (!documentSaveCoordinatorRef.current) {
    documentSaveCoordinatorRef.current = new DocumentSaveCoordinator();
  }
  const documentSaveCoordinator = documentSaveCoordinatorRef.current;
  const documentSaveCoordinatorEffectGenerationRef = useRef(0);
  const eslintAnalysisOnSaveTimerRef = useRef<number | null>(null);
  const phpstanAnalysisOnSaveTimerRef = useRef<number | null>(null);

  const clearAnalysisOnSaveTimers = useCallback(() => {
    if (eslintAnalysisOnSaveTimerRef.current !== null) {
      window.clearTimeout(eslintAnalysisOnSaveTimerRef.current);
      eslintAnalysisOnSaveTimerRef.current = null;
    }
    if (phpstanAnalysisOnSaveTimerRef.current !== null) {
      window.clearTimeout(phpstanAnalysisOnSaveTimerRef.current);
      phpstanAnalysisOnSaveTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearAnalysisOnSaveTimers, [
    clearAnalysisOnSaveTimers,
    workspaceRoot,
  ]);

  useEffect(() => {
    const generation = ++documentSaveCoordinatorEffectGenerationRef.current;

    return () => {
      queueMicrotask(() => {
        if (
          documentSaveCoordinatorEffectGenerationRef.current !== generation
        ) {
          return;
        }

        documentSaveCoordinator.dispose();
      });
    };
  }, [documentSaveCoordinator]);

  const scheduleAnalysisOnSave = useCallback(
    (document: EditorDocument, requestedRoot: string) => {
      if (
        workspaceSettings.eslintAnalyseOnSave &&
        isJavaScriptTypeScriptLanguageServerDocument(document)
      ) {
        if (eslintAnalysisOnSaveTimerRef.current !== null) {
          window.clearTimeout(eslintAnalysisOnSaveTimerRef.current);
        }
        eslintAnalysisOnSaveTimerRef.current = window.setTimeout(() => {
          eslintAnalysisOnSaveTimerRef.current = null;
          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            )
          ) {
            return;
          }
          runEslintAnalysisOnSave(requestedRoot);
        }, 500);
      }
      if (
        workspaceSettings.phpstanAnalyseOnSave &&
        document.language === "php"
      ) {
        if (phpstanAnalysisOnSaveTimerRef.current !== null) {
          window.clearTimeout(phpstanAnalysisOnSaveTimerRef.current);
        }
        phpstanAnalysisOnSaveTimerRef.current = window.setTimeout(() => {
          phpstanAnalysisOnSaveTimerRef.current = null;
          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            )
          ) {
            return;
          }
          runPhpstanAnalysisOnSave(requestedRoot);
        }, 500);
      }
    },
    [
      currentWorkspaceRootRef,
      runEslintAnalysisOnSave,
      runPhpstanAnalysisOnSave,
      workspaceSettings.eslintAnalyseOnSave,
      workspaceSettings.phpstanAnalyseOnSave,
    ],
  );

  // Records a Local History snapshot for a saved document, scoped to the
  // workspace root captured by the caller. Best-effort: a snapshot failure must
  // never surface as a save error, so it is swallowed (logged) rather than
  // thrown. The absolute path is converted to a workspace-relative path so the
  // snapshot lands in the requested workspace's bucket only.
  const captureLocalHistorySnapshot = useCallback(
    async (
      requestedRoot: string,
      absolutePath: string,
      content: string,
    ): Promise<void> => {
      const relativePath = workspaceRelativePath(requestedRoot, absolutePath);

      if (!relativePath) {
        return;
      }

      try {
        await localHistoryGateway.recordSnapshot(
          requestedRoot,
          relativePath,
          content,
        );
      } catch (error) {
        console.error("Local History snapshot failed", error);
      }
    },
    [localHistoryGateway],
  );

  const performDocumentSave = useCallback(async (
    identity: DocumentSaveIdentity,
    lease: DocumentSaveLease,
  ) => {
    const {
      path,
      requestedRoot,
      workspaceRequestToken,
    } = identity;
    const currentDocumentForSave = (): EditorDocument | null => {
      if (
        !lease.isCurrent() ||
        workspaceRequestTokenRef.current !== workspaceRequestToken ||
        !workspaceRootKeysEqual(
          currentWorkspaceRootRef.current,
          requestedRoot,
        )
      ) {
        return null;
      }

      return documentsRef.current[path] ?? null;
    };

    try {
      let documentToFormat = currentDocumentForSave();
      if (!documentToFormat || documentToFormat.readOnly) {
        return;
      }
      if (hasExternalFileConflict(requestedRoot, path)) {
        setMessage("Resolve the external file conflict before saving.");
        return;
      }

      while (true) {
        const startingContent = documentToFormat.content;
        const formattedContent = await formattedContentForSave(
          documentToFormat,
          requestedRoot,
        );
        let liveDocument = currentDocumentForSave();
        if (!liveDocument) {
          return;
        }
        if (hasExternalFileConflict(requestedRoot, path)) {
          setMessage("Resolve the external file conflict before saving.");
          return;
        }
        if (liveDocument !== documentToFormat) {
          documentToFormat = liveDocument;
          continue;
        }

        // Optimize imports AFTER formatting on the captured document snapshot.
        // Any edit observed at an async boundary restarts the whole pipeline.
        const phpOptimizedContent = optimizedImportsContentForSave(
          documentToFormat,
          formattedContent,
        );

        // JavaScript/TypeScript organize-imports goes through the language server
        // (`source.organizeImports`). It is async, so it is given the upfront
        // requested root (which it uses for every LSP call and re-checks after its
        // await), and the workspace root is re-checked again here before writing.
        // It is a no-op for non-JS/TS documents.
        const contentToSave = await organizedImportsContentForSave(
          documentToFormat,
          phpOptimizedContent,
          requestedRoot,
        );
        liveDocument = currentDocumentForSave();
        if (!liveDocument) {
          return;
        }
        if (hasExternalFileConflict(requestedRoot, path)) {
          setMessage("Resolve the external file conflict before saving.");
          return;
        }
        if (liveDocument !== documentToFormat) {
          documentToFormat = liveDocument;
          continue;
        }

        // EditorConfig on-save transforms (trim trailing whitespace, insert final
        // newline, normalize EOL) run LAST so they compose over the formatted +
        // import-organized content, mirroring VS Code / PhpStorm. Resolved per the
        // saved document's own path through the per-workspace cascade. A no-op when
        // no `.editorconfig` enables any on-save behaviour.
        const editorConfigForSave = await resolveEditorConfigForFile(
          requestedRoot,
          documentToFormat.path,
        );
        liveDocument = currentDocumentForSave();
        if (!liveDocument) {
          return;
        }
        if (hasExternalFileConflict(requestedRoot, path)) {
          setMessage("Resolve the external file conflict before saving.");
          return;
        }
        if (liveDocument !== documentToFormat) {
          documentToFormat = liveDocument;
          continue;
        }

        const editorConfiguredContent = applyEditorConfigOnSave(
          contentToSave,
          editorConfigForSave,
        );

        const documentToSave: EditorDocument = {
          ...documentToFormat,
          content: editorConfiguredContent,
        };

        if (hasExternalFileConflict(requestedRoot, path)) {
          setMessage("Resolve the external file conflict before saving.");
          return;
        }

        const writeResult = documentToFormat.revision
          ? await workspaceFiles.writeTextFile(
              documentToSave.path,
              documentToSave.content,
              documentToFormat.revision,
            )
          : await workspaceFiles.writeTextFile(
              documentToSave.path,
              documentToSave.content,
            );
        if (writeResult?.status === "conflict") {
          let disk: Awaited<ReturnType<typeof readWorkspaceTextFileSnapshot>> | null = null;
          try {
            disk = await readWorkspaceTextFileSnapshot(
              workspaceFiles,
              documentToSave.path,
            );
          } catch {
            // The conflict remains guarded and can retry the authoritative read.
          }
          const conflictedDocument = currentDocumentForSave();
          if (conflictedDocument) {
            detectSaveConflict(requestedRoot, conflictedDocument, disk);
            setMessage("The file changed on disk. Review the conflict before saving.");
          }
          return;
        }
        if (writeResult?.status === "error") {
          throw new Error(writeResult.message);
        }
        if (writeResult?.status === "partial") {
          const partiallyWrittenDocument = currentDocumentForSave();
          if (partiallyWrittenDocument) {
            const recoveredDocument = {
              ...partiallyWrittenDocument,
              revision: writeResult.revision,
            };
            documentsRef.current = {
              ...documentsRef.current,
              [documentToSave.path]: recoveredDocument,
            };
            if (activeDocumentRef.current?.path === documentToSave.path) {
              activeDocumentRef.current = recoveredDocument;
            }
            setDocuments((current) => {
              const existing = current[documentToSave.path];
              if (!existing || !currentDocumentForSave()) {
                return current;
              }
              return {
                ...current,
                [documentToSave.path]: {
                  ...existing,
                  revision: writeResult.revision,
                },
              };
            });
          }
          throw new Error(`The file was saved, but durability could not be confirmed: ${writeResult.message}`);
        }
        liveDocument = currentDocumentForSave();
        if (!liveDocument) {
          return;
        }
        if (hasExternalFileConflict(requestedRoot, path)) {
          return;
        }

        const acknowledgedDocument: EditorDocument = {
          ...liveDocument,
          content:
            liveDocument === documentToFormat &&
            liveDocument.content === startingContent
              ? documentToSave.content
              : liveDocument.content,
          savedContent: documentToSave.content,
          revision:
            writeResult?.status === "success"
              ? writeResult.revision
              : liveDocument.revision,
        };
        if (!currentDocumentForSave()) {
          return;
        }
        documentsRef.current = {
          ...documentsRef.current,
          [documentToSave.path]: acknowledgedDocument,
        };
        if (!currentDocumentForSave()) {
          return;
        }
        if (activeDocumentRef.current?.path === documentToSave.path) {
          activeDocumentRef.current = acknowledgedDocument;
        }

        if (!currentDocumentForSave()) {
          return;
        }
        setDocuments((current) => {
          if (!currentDocumentForSave()) {
            return current;
          }

          const existing = current[documentToSave.path];
          if (!existing) {
            return current;
          }

          return {
            ...current,
            [documentToSave.path]: {
              ...existing,
              content:
                existing === documentToFormat &&
                existing.content === startingContent
                  ? documentToSave.content
                  : existing.content,
              savedContent: documentToSave.content,
              revision:
                writeResult?.status === "success"
                  ? writeResult.revision
                  : existing.revision,
            },
          };
        });

        if (!currentDocumentForSave()) {
          return;
        }
        filePrefetchCacheRef.current.invalidate(documentToSave.path);

        if (!currentDocumentForSave()) {
          return;
        }
        await captureLocalHistorySnapshot(
          requestedRoot,
          documentToSave.path,
          documentToSave.content,
        );

        const isWrittenDocumentCurrent = () =>
          currentDocumentForSave()?.content === documentToSave.content;
        if (!isWrittenDocumentCurrent()) {
          return;
        }
        await syncSavedDocument(documentToSave, isWrittenDocumentCurrent);

        if (!isWrittenDocumentCurrent()) {
          return;
        }
        await syncSavedJavaScriptTypeScriptDocument(
          documentToSave,
          isWrittenDocumentCurrent,
        );

        if (!isWrittenDocumentCurrent()) {
          return;
        }

        setMessage(`Saved ${documentToSave.name}`);
        scheduleAnalysisOnSave(documentToSave, requestedRoot);
        return;
      }
    } catch (error) {
      if (!currentDocumentForSave()) {
        return;
      }

      reportErrorForActiveWorkspaceRoot(requestedRoot, "Save File", error);
    }
  }, [
    captureLocalHistorySnapshot,
    activeDocumentRef,
    detectSaveConflict,
    documentsRef,
    formattedContentForSave,
    optimizedImportsContentForSave,
    organizedImportsContentForSave,
    reportErrorForActiveWorkspaceRoot,
    resolveEditorConfigForFile,
    scheduleAnalysisOnSave,
    setDocuments,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    workspaceFiles,
    workspaceRequestTokenRef,
    hasExternalFileConflict,
    setMessage,
  ]);

  const saveActiveDocument = useCallback(async () => {
    const document = activeDocumentRef.current;
    if (!document || document.readOnly || !workspaceRoot) {
      return;
    }

    const identity: DocumentSaveIdentity = {
      path: document.path,
      requestedRoot: workspaceRoot,
      workspaceRequestToken: workspaceRequestTokenRef.current,
    };
    await documentSaveCoordinator.request(
      { rootPath: identity.requestedRoot, path: identity.path },
      (lease) => performDocumentSave(identity, lease),
    );
  }, [
    activeDocumentRef,
    documentSaveCoordinator,
    performDocumentSave,
    workspaceRoot,
    workspaceRequestTokenRef,
  ]);

  const runWithDocumentSaveExclusion = useCallback<RunWithDocumentSaveExclusion>(
    (scope, operation) =>
      documentSaveCoordinator.runWithExclusion(scope, operation),
    [documentSaveCoordinator],
  );

  useEffect(() => {
    if (!workspaceSettings.autoSave) {
      return;
    }

    if (!activeDocument || activeDocument.readOnly || !isDirty(activeDocument)) {
      return;
    }

    const timer = window.setTimeout(() => {
      void saveActiveDocument();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [activeDocument, saveActiveDocument, workspaceSettings.autoSave]);

  const closeDocument = useCallback(
    (path: string, options: DocumentCloseOptions = {}) => {
      const effectiveActivePath =
        activeDocumentRef.current?.path ?? activePath;
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

      if (
        document &&
        options.skipConfirmation !== true &&
        (isDirty(document) || hasExternalFileConflict(workspaceRoot, path)) &&
        !prompter.confirm(
          hasExternalFileConflict(workspaceRoot, path)
            ? "Close file with an unresolved external conflict?"
            : "Discard changes?",
        )
      ) {
        return;
      }

      const rootPath = currentWorkspaceRootRef.current;

      if (rootPath) {
        documentSaveCoordinator.invalidate({ rootPath, path });
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
          ? plan.nextDocuments[plan.nextActivePath] ?? null
          : null;
      }

      setDocuments((current) => {
        const next = { ...current };
        delete next[path];
        return next;
      });
      setPreviewPath((current) => (current === path ? null : current));
      setOpenPaths((current) => current.filter((item) => item !== path));

      if (plan.closedActiveDocument) {
        if (plan.nextActivePath && plan.nextGitChange) {
          loadGitDiffDocument(plan.nextActivePath, plan.nextGitChange);
        } else {
          setActivePath(plan.nextActivePath);
        }
      }
    },
    [
      activePath,
      activeDocumentRef,
      clearLanguageServerDiagnosticsForPath,
      clearPhpLocalDiagnosticsForPath,
      documentsRef,
      gitStatus.changes,
      gitChangeForDiffDocumentPath,
      loadGitDiffDocument,
      openPathsRef,
      previewPathRef,
      prompter,
      currentWorkspaceRootRef,
      documentSaveCoordinator,
      recentlyClosedDocumentViewState,
      recentlyClosedTabsRef,
      hasExternalFileConflict,
      clearExternalFileConflict,
      workspaceRoot,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
    ],
  );

  const closeActiveSurface = useCallback((options: DocumentCloseOptions = {}) => {
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
  }, [
    activeDocument,
    activeDocumentRef,
    closeEmptyWorkbenchSurface,
    closeDocument,
    closeGitDiffPreview,
    gitDiffLoading,
    selectedGitChange,
    selectedGitChangeRef,
  ]);

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
    openRecentlyClosedDocument,
    onRecentlyClosedTabsChange,
    recentlyClosedTabsRef,
    restoreRecentlyClosedDocumentViewState,
  ]);

  return {
    captureLocalHistorySnapshot,
    saveActiveDocument,
    runWithDocumentSaveExclusion,
    closeDocument,
    closeActiveSurface,
    reopenClosedDocument,
    canReopenClosedDocument: Boolean(
      workspaceRoot &&
        hasRecentlyClosedTabs(recentlyClosedTabsRef.current, workspaceRoot),
    ),
  };
}
