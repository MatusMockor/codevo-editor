import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn as TauriUnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  useCallback,
  useEffect,
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
import type { WorkspaceSettings } from "../domain/settings";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import { isDirty, workspaceRelativePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { createSafeUnsubscribe } from "../infrastructure/safeUnsubscribe";
import { planDocumentClose } from "./documentCloseLifecycle";
import type { WorkbenchPrompter } from "./workbenchPrompter";

const CLOSE_ACTIVE_TAB_EVENT = "mockor-close-active-tab";

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
  syncSavedDocument: (document: EditorDocument) => Promise<void>;
  syncSavedJavaScriptTypeScriptDocument: (
    document: EditorDocument,
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
  isGitDiffDocumentPath: (path: string) => boolean;
  gitChangeForDiffDocumentPath: (
    path: string,
    changes: GitChangedFile[],
  ) => GitChangedFile | null;

  // Error reporters (shell-owned, workspace-root isolated).
  reportError: (source: string, error: unknown) => void;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
}

export interface DocumentLifecycle {
  captureLocalHistorySnapshot: (
    requestedRoot: string,
    absolutePath: string,
    content: string,
  ) => Promise<void>;
  saveActiveDocument: () => Promise<void>;
  closeDocument: (path: string) => void;
  closeActiveSurface: () => void;
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
    activeDocumentRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    filePrefetchCacheRef,
    externallyRemovedDocumentRootByPathRef,
    gitDiffRequestTokenRef,
    selectedGitChangeRef,
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
    isGitDiffDocumentPath,
    gitChangeForDiffDocumentPath,
    reportError,
    reportErrorForActiveWorkspaceRoot,
  } = dependencies;

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

  const saveActiveDocument = useCallback(async () => {
    const documentToFormat = activeDocumentRef.current;
    if (!documentToFormat || documentToFormat.readOnly) {
      return;
    }

    const requestedRoot = workspaceRoot;
    if (!requestedRoot) {
      return;
    }

    try {
      const formattedContent = await formattedContentForSave(
        documentToFormat,
        requestedRoot,
      );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      // Optimize imports AFTER formatting and AFTER the root re-check, on the
      // formatted content, so the two save-time fixers compose (format then
      // organize imports) and never act on a stale or cross-tab document. PHP
      // uses a synchronous reorganizer; this is a no-op for any other language.
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

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
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

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      const editorConfiguredContent = applyEditorConfigOnSave(
        contentToSave,
        editorConfigForSave,
      );

      const documentToSave: EditorDocument = {
        ...documentToFormat,
        content: editorConfiguredContent,
      };
      const savedDocument: EditorDocument = {
        ...documentToSave,
        savedContent: documentToSave.content,
      };

      await workspaceFiles.writeTextFile(
        documentToSave.path,
        documentToSave.content,
      );
      filePrefetchCacheRef.current.invalidate(documentToSave.path);
      // Capture a Local History snapshot of the just-saved content, scoped to
      // the workspace root that was active when the save began. The gateway
      // dedupes identical content and the storage is per-workspace, so this is
      // a no-op when nothing changed and never leaks across tabs.
      void captureLocalHistorySnapshot(
        requestedRoot,
        documentToSave.path,
        documentToSave.content,
      );
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      if (documentsRef.current[documentToSave.path]) {
        documentsRef.current = {
          ...documentsRef.current,
          [documentToSave.path]: {
            ...documentsRef.current[documentToSave.path],
            content: documentToSave.content,
            savedContent: documentToSave.content,
          },
        };
      }
      if (activeDocumentRef.current?.path === documentToSave.path) {
        activeDocumentRef.current = savedDocument;
      }

      setDocuments((current) => {
        const existing = current[documentToSave.path];

        if (!existing) {
          return current;
        }

        return {
          ...current,
          [documentToSave.path]: {
            ...existing,
            content: documentToSave.content,
            savedContent: documentToSave.content,
          },
        };
      });
      await syncSavedDocument(documentToSave);
      await syncSavedJavaScriptTypeScriptDocument(documentToSave);
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(`Saved ${documentToSave.name}`);
    } catch (error) {
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Save File", error);
    }
  }, [
    captureLocalHistorySnapshot,
    activeDocumentRef,
    documentsRef,
    formattedContentForSave,
    optimizedImportsContentForSave,
    organizedImportsContentForSave,
    reportErrorForActiveWorkspaceRoot,
    resolveEditorConfigForFile,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    workspaceFiles,
    workspaceRoot,
  ]);

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
    (path: string) => {
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
        isDirty(document) &&
        !prompter.confirm("Discard changes?")
      ) {
        return;
      }

      if (document) {
        void syncClosedDocument(document);
        void syncClosedJavaScriptTypeScriptDocument(document);
        clearPhpLocalDiagnosticsForPath(path);
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
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
    ],
  );

  const closeApplicationWindow = useCallback(() => {
    if (!isTauri()) {
      return;
    }

    void getCurrentWindow()
      .close()
      .catch((error) => reportError("Window", error));
  }, [reportError]);

  const closeActiveSurface = useCallback(() => {
    if (selectedGitChangeRef.current || selectedGitChange || gitDiffLoading) {
      closeGitDiffPreview();
      return;
    }

    const currentActiveDocument = activeDocumentRef.current ?? activeDocument;
    if (currentActiveDocument) {
      closeDocument(currentActiveDocument.path);
      return;
    }

    closeApplicationWindow();
  }, [
    activeDocument,
    activeDocumentRef,
    closeApplicationWindow,
    closeDocument,
    closeGitDiffPreview,
    gitDiffLoading,
    selectedGitChange,
    selectedGitChangeRef,
  ]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let active = true;
    let unlisten: TauriUnlistenFn | null = null;

    listen(CLOSE_ACTIVE_TAB_EVENT, () => {
      closeActiveSurface();
    })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unlisten = createSafeUnsubscribe(dispose);
      })
      .catch((error) => reportError("Shortcuts", error));

    return () => {
      active = false;
      unlisten?.();
    };
  }, [closeActiveSurface, reportError]);

  return {
    captureLocalHistorySnapshot,
    saveActiveDocument,
    closeDocument,
    closeActiveSurface,
  };
}
