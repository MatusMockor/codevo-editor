import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ResolvedEditorConfig } from "../domain/editorConfig";
import type { FilePrefetchCache } from "../domain/filePrefetchCache";
import type { LocalHistoryGateway } from "../domain/localHistory";
import { isJavaScriptTypeScriptLanguageServerDocument } from "../domain/languageServerDocumentSync";
import type { WorkspaceSettings } from "../domain/settings";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import {
  isDirty,
  readWorkspaceTextFileSnapshot,
  workspaceRelativePath,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  ActiveDocumentSaveStore,
  type DocumentSaveTarget,
} from "./activeDocumentSaveStore";
import {
  DocumentSaveCoordinator,
  type DocumentSaveLease,
  type RunWithDocumentSaveExclusion,
} from "./documentSaveCoordinator";
import {
  DocumentSaveService,
  type DocumentSaveResult,
} from "./documentSaveService";

export type { DocumentSaveResult } from "./documentSaveService";

export interface DocumentSaveLifecycleDependencies {
  workspaceRoot: string | null;
  activeDocument: EditorDocument | null;
  workspaceSettings: WorkspaceSettings;

  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRequestTokenRef: MutableRefObject<number>;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  filePrefetchCacheRef: MutableRefObject<FilePrefetchCache>;

  setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  setMessage: Dispatch<SetStateAction<string | null>>;

  localHistoryGateway: LocalHistoryGateway;
  workspaceFiles: WorkspaceFileGateway;

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

  syncSavedDocument: (
    rootPath: string,
    document: EditorDocument,
    shouldEmit?: () => boolean,
  ) => Promise<void>;
  syncSavedJavaScriptTypeScriptDocument: (
    rootPath: string,
    document: EditorDocument,
    shouldEmit?: () => boolean,
  ) => Promise<void>;

  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
  hasExternalFileConflict?: (rootPath: string | null, path: string) => boolean;
  detectSaveConflict?: (
    rootPath: string,
    document: EditorDocument,
    disk: Awaited<ReturnType<typeof readWorkspaceTextFileSnapshot>> | null,
  ) => void;
  runEslintAnalysisOnSave: (rootPath: string) => void;
  runPhpstanAnalysisOnSave: (rootPath: string) => void;
}

export interface DocumentSaveLifecycle {
  captureLocalHistorySnapshot: (
    requestedRoot: string,
    absolutePath: string,
    content: string,
  ) => Promise<void>;
  saveDocument: (path: string) => Promise<DocumentSaveResult>;
  saveActiveDocument: () => Promise<void>;
  runWithDocumentSaveExclusion: RunWithDocumentSaveExclusion;
  invalidateDocumentSave: (rootPath: string, path: string) => void;
}

interface DocumentSaveIdentity {
  path: string;
  requestedRoot: string;
  workspaceRequestToken: number;
}

export function useDocumentSaveLifecycle(
  dependencies: DocumentSaveLifecycleDependencies,
): DocumentSaveLifecycle {
  const {
    workspaceRoot,
    activeDocument,
    workspaceSettings,
    currentWorkspaceRootRef,
    workspaceRequestTokenRef,
    activeDocumentRef,
    documentsRef,
    filePrefetchCacheRef,
    setDocuments,
    setMessage,
    localHistoryGateway,
    workspaceFiles,
    formattedContentForSave,
    optimizedImportsContentForSave,
    organizedImportsContentForSave,
    resolveEditorConfigForFile,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    reportErrorForActiveWorkspaceRoot,
    hasExternalFileConflict = () => false,
    detectSaveConflict = () => {},
    runEslintAnalysisOnSave,
    runPhpstanAnalysisOnSave,
  } = dependencies;
  const documentSaveCoordinatorRef =
    useRef<DocumentSaveCoordinator<DocumentSaveResult> | null>(null);
  if (!documentSaveCoordinatorRef.current) {
    documentSaveCoordinatorRef.current =
      new DocumentSaveCoordinator<DocumentSaveResult>();
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

  useEffect(
    () => clearAnalysisOnSaveTimers,
    [clearAnalysisOnSaveTimers, workspaceRoot],
  );

  useEffect(() => {
    const generation = ++documentSaveCoordinatorEffectGenerationRef.current;

    return () => {
      queueMicrotask(() => {
        if (documentSaveCoordinatorEffectGenerationRef.current !== generation) {
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

  const activeDocumentSaveStore = useMemo(
    () =>
      new ActiveDocumentSaveStore({
        currentWorkspaceRootRef,
        workspaceRequestTokenRef,
        activeDocumentRef,
        documentsRef,
        setDocuments,
      }),
    [
      activeDocumentRef,
      currentWorkspaceRootRef,
      documentsRef,
      setDocuments,
      workspaceRequestTokenRef,
    ],
  );

  const presentSaveResult = useCallback(
    (requestedRoot: string, result: DocumentSaveResult): void => {
      if (result.status === "blocked") {
        if (result.reason === "external" && !result.silent) {
          setMessage("Resolve the external file conflict before saving.");
        }
        return;
      }
      if (result.status === "conflict") {
        detectSaveConflict(requestedRoot, result.document, result.snapshot);
        setMessage(
          "The file changed on disk. Review the conflict before saving.",
        );
        return;
      }
      if (result.status === "partial" || result.status === "failed") {
        reportErrorForActiveWorkspaceRoot(
          requestedRoot,
          "Save File",
          result.error,
        );
        return;
      }
      if (result.status !== "saved" || !result.contentIsCurrent) {
        return;
      }

      setMessage(`Saved ${result.document.name}`);
      scheduleAnalysisOnSave(result.document, requestedRoot);
    },
    [
      detectSaveConflict,
      reportErrorForActiveWorkspaceRoot,
      scheduleAnalysisOnSave,
      setMessage,
    ],
  );

  const performDocumentSave = useCallback(
    async (
      identity: DocumentSaveIdentity,
      lease: DocumentSaveLease,
    ): Promise<DocumentSaveResult> => {
      const target: DocumentSaveTarget = {
        path: identity.path,
        rootPath: identity.requestedRoot,
        workspaceRequestToken: identity.workspaceRequestToken,
        lease,
      };
      const service = new DocumentSaveService({
        workspaceFiles,
        saveStore: activeDocumentSaveStore,
        invalidatePrefetch: (path) =>
          filePrefetchCacheRef.current.invalidate(path),
        captureLocalHistorySnapshot,
        formattedContentForSave,
        optimizedImportsContentForSave,
        organizedImportsContentForSave,
        resolveEditorConfigForFile,
        syncSavedDocument,
        syncSavedJavaScriptTypeScriptDocument,
        hasExternalFileConflict,
      });
      const result = await service.saveDocument(target);
      presentSaveResult(identity.requestedRoot, result);
      return result;
    },
    [
      activeDocumentSaveStore,
      captureLocalHistorySnapshot,
      filePrefetchCacheRef,
      formattedContentForSave,
      hasExternalFileConflict,
      optimizedImportsContentForSave,
      organizedImportsContentForSave,
      presentSaveResult,
      resolveEditorConfigForFile,
      syncSavedDocument,
      syncSavedJavaScriptTypeScriptDocument,
      workspaceFiles,
    ],
  );

  const saveDocument = useCallback(
    async (path: string): Promise<DocumentSaveResult> => {
      if (!workspaceRoot) {
        return { status: "stale" };
      }

      const identity: DocumentSaveIdentity = {
        path,
        requestedRoot: workspaceRoot,
        workspaceRequestToken: workspaceRequestTokenRef.current,
      };
      const outcome = await documentSaveCoordinator.request(
        { rootPath: identity.requestedRoot, path: identity.path },
        (lease) => performDocumentSave(identity, lease),
      );
      if (outcome.status !== "saved") {
        return { status: "stale" };
      }

      return outcome.result;
    },
    [
      documentSaveCoordinator,
      performDocumentSave,
      workspaceRequestTokenRef,
      workspaceRoot,
    ],
  );

  const saveActiveDocument = useCallback(async (): Promise<void> => {
    const document = activeDocumentRef.current;
    if (!document || document.readOnly) {
      return;
    }

    await saveDocument(document.path);
  }, [activeDocumentRef, saveDocument]);

  const runWithDocumentSaveExclusion =
    useCallback<RunWithDocumentSaveExclusion>(
      (scope, operation) =>
        documentSaveCoordinator.runWithExclusion(scope, operation),
      [documentSaveCoordinator],
    );

  const invalidateDocumentSave = useCallback(
    (rootPath: string, path: string): void => {
      documentSaveCoordinator.invalidate({ rootPath, path });
    },
    [documentSaveCoordinator],
  );

  useEffect(() => {
    if (!workspaceSettings.autoSave) {
      return;
    }

    if (
      !activeDocument ||
      activeDocument.readOnly ||
      !isDirty(activeDocument)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void saveActiveDocument();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [activeDocument, saveActiveDocument, workspaceSettings.autoSave]);

  return {
    captureLocalHistorySnapshot,
    saveDocument,
    saveActiveDocument,
    runWithDocumentSaveExclusion,
    invalidateDocumentSave,
  };
}
