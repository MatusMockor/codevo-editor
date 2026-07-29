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
import type {
  EditorDocument,
  WorkspaceFileGateway,
  WorkspaceOwnerRelativeFileGateway,
} from "../domain/workspace";
import { isDirty, readWorkspaceTextFileSnapshot, workspaceRelativePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { ActiveDocumentSaveStore, type DocumentSaveTarget } from "./activeDocumentSaveStore";
import {
  DocumentSaveCoordinator,
  type DocumentSaveInvalidationScope,
  type DocumentSaveLease,
  type RunWithDocumentSaveExclusion,
} from "./documentSaveCoordinator";
import {
  isRegisteredDocumentSaveIdentity,
  legacyDocumentSaveIdentity,
  legacyDocumentSaveOwnership,
  type DocumentSaveOwnership,
  type ResolveDocumentSaveOwnership,
} from "./documentSaveIdentity";
import {
  runDocumentSaveParticipants,
  type DocumentSaveParticipant,
} from "./documentSaveParticipants";
import {
  DocumentSaveService,
  type DocumentSaveResult,
  type DocumentSaveServiceDependencies,
} from "./documentSaveService";
import type { DocumentSelfWriteLease } from "./documentSelfWriteCoordinator";
import {
  EditorActiveLiveDocumentSaveCoordinator,
  type EditorActiveLiveDocumentSaveAdmissionPort,
  type EditorActiveLiveDocumentSaveBinding,
} from "./editorActiveLiveDocumentSaveCoordinator";

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
  workspaceOwnerRelativeFiles?: WorkspaceOwnerRelativeFileGateway | null;
  resolveDocumentSaveOwnership?: ResolveDocumentSaveOwnership;

  formattedContentForSave: (document: EditorDocument, requestedRoot: string) => Promise<string>;
  optimizedImportsContentForSave: (document: EditorDocument, content: string) => string;
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
  beginDocumentSelfWrite: (
    rootPath: string,
    path: string,
    content: string,
  ) => DocumentSelfWriteLease | null;
  beginRegisteredDocumentSelfWrite?: DocumentSaveServiceDependencies["beginRegisteredDocumentSelfWrite"];
  detectSaveConflict?: (
    rootPath: string,
    document: EditorDocument,
    disk: Awaited<ReturnType<typeof readWorkspaceTextFileSnapshot>> | null,
  ) => void;
  runEslintAnalysisOnSave: (rootPath: string) => void;
  runPhpstanAnalysisOnSave: (rootPath: string) => void;
  onDidSaveDocument?: (rootPath: string, document: EditorDocument) => void;
  saveParticipants?: readonly DocumentSaveParticipant[];
  activeLiveDocumentSaveCoordinator?: EditorActiveLiveDocumentSaveAdmissionPort;
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
  runWithIssuedWriteDrain: RunWithDocumentSaveExclusion;
  requestOwnerDocumentSave: (
    ownership: DocumentSaveOwnership,
    operation: (lease: DocumentSaveLease) => Promise<DocumentSaveResult>,
  ) => Promise<DocumentSaveResult>;
  invalidateDocumentSave: (rootPath: string, path: string) => void;
  onActiveLiveDocumentSaveBindingChange: (
    binding: EditorActiveLiveDocumentSaveBinding | null,
  ) => void;
}

interface DocumentSaveIdentity {
  ownership: DocumentSaveOwnership;
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
    workspaceOwnerRelativeFiles,
    resolveDocumentSaveOwnership,
    formattedContentForSave,
    optimizedImportsContentForSave,
    organizedImportsContentForSave,
    resolveEditorConfigForFile,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    reportErrorForActiveWorkspaceRoot,
    hasExternalFileConflict = () => false,
    beginDocumentSelfWrite,
    beginRegisteredDocumentSelfWrite,
    detectSaveConflict = () => {},
    runEslintAnalysisOnSave,
    runPhpstanAnalysisOnSave,
    onDidSaveDocument = () => undefined,
    saveParticipants,
    activeLiveDocumentSaveCoordinator,
  } = dependencies;
  const documentSaveCoordinatorRef = useRef<DocumentSaveCoordinator<DocumentSaveResult> | null>(
    null,
  );
  if (!documentSaveCoordinatorRef.current) {
    documentSaveCoordinatorRef.current = new DocumentSaveCoordinator<DocumentSaveResult>();
  }
  const documentSaveCoordinator = documentSaveCoordinatorRef.current;
  const activeLiveSaveCoordinatorRef = useRef<EditorActiveLiveDocumentSaveCoordinator | null>(null);
  if (!activeLiveSaveCoordinatorRef.current) {
    activeLiveSaveCoordinatorRef.current = new EditorActiveLiveDocumentSaveCoordinator();
  }
  const activeLiveSaveCoordinator =
    activeLiveDocumentSaveCoordinator ?? activeLiveSaveCoordinatorRef.current;
  const workspaceSaveGeneration = workspaceRequestTokenRef.current;
  useEffect(() => {
    activeLiveSaveCoordinator.resetRetiredOwnership?.();
  }, [activeLiveSaveCoordinator, workspaceRoot, workspaceSaveGeneration]);
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

  useEffect(() => clearAnalysisOnSaveTimers, [clearAnalysisOnSaveTimers, workspaceRoot]);

  useEffect(() => {
    const effectGenerationRef = documentSaveCoordinatorEffectGenerationRef;
    const generation = ++effectGenerationRef.current;

    return () => {
      queueMicrotask(() => {
        if (effectGenerationRef.current !== generation) {
          return;
        }

        documentSaveCoordinator.dispose();
      });
    };
  }, [documentSaveCoordinator]);

  const scheduleAnalysisOnSave = useCallback(
    (document: EditorDocument, requestedRoot: string) => {
      if (
        (workspaceSettings.eslintAnalyseOnSave || workspaceSettings.eslintFixOnSave) &&
        isJavaScriptTypeScriptLanguageServerDocument(document)
      ) {
        if (eslintAnalysisOnSaveTimerRef.current !== null) {
          window.clearTimeout(eslintAnalysisOnSaveTimerRef.current);
        }
        eslintAnalysisOnSaveTimerRef.current = window.setTimeout(() => {
          eslintAnalysisOnSaveTimerRef.current = null;
          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
            return;
          }
          runEslintAnalysisOnSave(requestedRoot);
        }, 500);
      }
      if (workspaceSettings.phpstanAnalyseOnSave && document.language === "php") {
        if (phpstanAnalysisOnSaveTimerRef.current !== null) {
          window.clearTimeout(phpstanAnalysisOnSaveTimerRef.current);
        }
        phpstanAnalysisOnSaveTimerRef.current = window.setTimeout(() => {
          phpstanAnalysisOnSaveTimerRef.current = null;
          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
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
      workspaceSettings.eslintFixOnSave,
      workspaceSettings.phpstanAnalyseOnSave,
    ],
  );

  const organizedContentForSaveWithParticipants = useCallback(
    async (
      document: EditorDocument,
      content: string,
      requestedRoot: string,
      isCurrentDocument: () => boolean,
    ): Promise<string> => {
      const organizedContent = await organizedImportsContentForSave(
        document,
        content,
        requestedRoot,
      );
      if (!isCurrentDocument()) {
        return organizedContent;
      }
      if (!saveParticipants || saveParticipants.length === 0) {
        return organizedContent;
      }

      const requestToken = workspaceRequestTokenRef.current;
      const isStale = () =>
        workspaceRequestTokenRef.current !== requestToken ||
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) ||
        !isCurrentDocument();
      const participantsRun = await runDocumentSaveParticipants({
        participants: saveParticipants,
        content: organizedContent,
        context: {
          document,
          requestedRoot,
          settings: workspaceSettings,
          isStale,
        },
      });
      participantsRun.failures.forEach((failure) => {
        reportErrorForActiveWorkspaceRoot(
          requestedRoot,
          `Save Participant "${failure.participantId}"`,
          failure.error,
        );
      });
      if (isStale()) {
        return organizedContent;
      }

      return participantsRun.content;
    },
    [
      currentWorkspaceRootRef,
      organizedImportsContentForSave,
      reportErrorForActiveWorkspaceRoot,
      saveParticipants,
      workspaceRequestTokenRef,
      workspaceSettings,
    ],
  );

  // Records a Local History snapshot for a saved document, scoped to the
  // workspace root captured by the caller. Best-effort: a snapshot failure must
  // never surface as a save error, so it is swallowed (logged) rather than
  // thrown. The absolute path is converted to a workspace-relative path so the
  // snapshot lands in the requested workspace's bucket only.
  const captureLocalHistorySnapshot = useCallback(
    async (requestedRoot: string, absolutePath: string, content: string): Promise<void> => {
      const relativePath = workspaceRelativePath(requestedRoot, absolutePath);

      if (!relativePath) {
        return;
      }

      try {
        await localHistoryGateway.recordSnapshot(requestedRoot, relativePath, content);
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
        } else if (result.reason === "exactLiveDocumentTooLarge") {
          setMessage(
            "The live editor content is too large to save safely. Reduce the file size and try again.",
          );
        } else if (result.reason === "exactLiveDocumentUnavailable") {
          setMessage(
            "The live editor content changed before it could be captured safely. Try saving again.",
          );
        }
        return;
      }
      if (result.status === "conflict") {
        detectSaveConflict(requestedRoot, result.document, result.snapshot);
        setMessage("The file changed on disk. Review the conflict before saving.");
        return;
      }
      if (result.status === "partial" || result.status === "failed") {
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Save File", result.error);
        return;
      }
      if (result.status !== "saved" || !result.contentIsCurrent) {
        return;
      }

      setMessage(`Saved ${result.document.name}`);
      if (result.persistence === "unchanged" && result.contentChanged === false) {
        return;
      }
      scheduleAnalysisOnSave(result.document, requestedRoot);
    },
    [detectSaveConflict, reportErrorForActiveWorkspaceRoot, scheduleAnalysisOnSave, setMessage],
  );

  const performDocumentSave = useCallback(
    async (
      identity: DocumentSaveIdentity,
      lease: DocumentSaveLease,
    ): Promise<DocumentSaveResult> => {
      const target: DocumentSaveTarget = {
        path: identity.path,
        registeredIdentity: isRegisteredDocumentSaveIdentity(identity.ownership)
          ? identity.ownership
          : null,
        rootPath: identity.requestedRoot,
        workspaceRequestToken: identity.workspaceRequestToken,
        lease,
      };
      const legacyDocument = activeDocumentSaveStore.current(target);
      const liveAdmission =
        legacyDocument && isJavaScriptTypeScriptLanguageServerDocument(legacyDocument)
          ? activeLiveSaveCoordinator.admit({
              document: legacyDocument,
              legacySaveStore: activeDocumentSaveStore,
              lease,
              requireExactLiveSave: activeDocumentRef.current?.path === identity.path,
              target,
            })
          : { status: "fallback" as const };
      if (liveAdmission.status === "rejected") {
        const result: DocumentSaveResult = {
          status: "blocked",
          reason:
            liveAdmission.reason === "document-too-large"
              ? "exactLiveDocumentTooLarge"
              : "exactLiveDocumentUnavailable",
        };
        if (!lease.isCurrent()) {
          return result;
        }
        if (workspaceRequestTokenRef.current !== identity.workspaceRequestToken) {
          return result;
        }
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, identity.requestedRoot)) {
          return result;
        }
        presentSaveResult(identity.requestedRoot, result);
        return result;
      }
      const effectiveTarget = liveAdmission.status === "admitted" ? liveAdmission.target : target;
      const effectiveSaveStore =
        liveAdmission.status === "admitted" ? liveAdmission.saveStore : activeDocumentSaveStore;
      const service = new DocumentSaveService({
        workspaceFiles,
        workspaceOwnerRelativeFiles,
        saveStore: effectiveSaveStore,
        invalidatePrefetch: (path) => filePrefetchCacheRef.current.invalidate(path),
        captureLocalHistorySnapshot,
        formattedContentForSave,
        optimizedImportsContentForSave,
        organizedImportsContentForSave: organizedContentForSaveWithParticipants,
        resolveEditorConfigForFile,
        syncSavedDocument,
        syncSavedJavaScriptTypeScriptDocument,
        hasExternalFileConflict,
        beginDocumentSelfWrite,
        beginRegisteredDocumentSelfWrite,
      });
      let result: DocumentSaveResult;
      try {
        result = await service.saveDocument(effectiveTarget);
      } finally {
        if (liveAdmission.status === "admitted") {
          liveAdmission.settle();
        }
      }
      if (!lease.isCurrent()) {
        return result;
      }
      if (workspaceRequestTokenRef.current !== identity.workspaceRequestToken) {
        return result;
      }
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, identity.requestedRoot)) {
        return result;
      }
      if (result.status === "saved" && result.persistence === "written") {
        onDidSaveDocument(identity.requestedRoot, result.document);
      }
      presentSaveResult(identity.requestedRoot, result);
      return result;
    },
    [
      activeDocumentSaveStore,
      activeLiveSaveCoordinator,
      captureLocalHistorySnapshot,
      filePrefetchCacheRef,
      formattedContentForSave,
      hasExternalFileConflict,
      beginDocumentSelfWrite,
      beginRegisteredDocumentSelfWrite,
      optimizedImportsContentForSave,
      onDidSaveDocument,
      organizedContentForSaveWithParticipants,
      presentSaveResult,
      resolveEditorConfigForFile,
      currentWorkspaceRootRef,
      syncSavedDocument,
      syncSavedJavaScriptTypeScriptDocument,
      workspaceFiles,
      workspaceOwnerRelativeFiles,
      workspaceRequestTokenRef,
    ],
  );

  const saveDocument = useCallback(
    async (path: string): Promise<DocumentSaveResult> => {
      if (!workspaceRoot) {
        return { status: "stale" };
      }

      const ownership = resolveDocumentSaveOwnership
        ? resolveDocumentSaveOwnership(workspaceRoot, path)
        : legacyDocumentSaveOwnership(workspaceRoot, path);
      if (!ownership) {
        return { status: "stale" };
      }
      const identity: DocumentSaveIdentity = {
        ownership,
        path,
        requestedRoot: workspaceRoot,
        workspaceRequestToken: workspaceRequestTokenRef.current,
      };
      const outcome = await documentSaveCoordinator.request(ownership, (lease) =>
        performDocumentSave(identity, lease),
      );
      if (outcome.status !== "saved") {
        return { status: "stale" };
      }

      return outcome.result;
    },
    [
      documentSaveCoordinator,
      performDocumentSave,
      resolveDocumentSaveOwnership,
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

  const onActiveLiveDocumentSaveBindingChange = useCallback(
    (binding: EditorActiveLiveDocumentSaveBinding | null) => {
      activeLiveSaveCoordinator.publish(binding);
    },
    [activeLiveSaveCoordinator],
  );

  const runWithDocumentSaveExclusion = useCallback<RunWithDocumentSaveExclusion>(
    (scope, operation) => {
      const resolvedScope = resolveDocumentSaveInvalidationScope(
        scope,
        resolveDocumentSaveOwnership,
      );
      if (!resolvedScope) {
        return Promise.reject(documentSaveOwnershipResolutionError(scope));
      }

      return documentSaveCoordinator.runWithExclusion(resolvedScope, operation);
    },
    [documentSaveCoordinator, resolveDocumentSaveOwnership],
  );

  const requestOwnerDocumentSave = useCallback(
    async (
      ownership: DocumentSaveOwnership,
      operation: (lease: DocumentSaveLease) => Promise<DocumentSaveResult>,
    ): Promise<DocumentSaveResult> => {
      const outcome = await documentSaveCoordinator.request(ownership, operation);
      if (outcome.status !== "saved") {
        return { status: "stale" };
      }

      return outcome.result;
    },
    [documentSaveCoordinator],
  );

  const runWithIssuedWriteDrain = useCallback<RunWithDocumentSaveExclusion>(
    (scope, operation) => {
      const resolvedScope = resolveDocumentSaveInvalidationScope(
        scope,
        resolveDocumentSaveOwnership,
      );
      if (!resolvedScope) {
        return Promise.reject(documentSaveOwnershipResolutionError(scope));
      }

      return documentSaveCoordinator.runWithIssuedWriteDrain(resolvedScope, operation);
    },
    [documentSaveCoordinator, resolveDocumentSaveOwnership],
  );

  const invalidateDocumentSave = useCallback(
    (rootPath: string, path: string): void => {
      const ownership = resolveDocumentSaveOwnership
        ? resolveDocumentSaveOwnership(rootPath, path)
        : legacyDocumentSaveIdentity(rootPath, path);
      if (!ownership) {
        return;
      }

      documentSaveCoordinator.invalidate(ownership);
    },
    [documentSaveCoordinator, resolveDocumentSaveOwnership],
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

  return {
    captureLocalHistorySnapshot,
    saveDocument,
    saveActiveDocument,
    runWithDocumentSaveExclusion,
    runWithIssuedWriteDrain,
    requestOwnerDocumentSave,
    invalidateDocumentSave,
    onActiveLiveDocumentSaveBindingChange,
  };
}

function resolveDocumentSaveInvalidationScope(
  scope: DocumentSaveInvalidationScope,
  resolveOwnership: ResolveDocumentSaveOwnership | undefined,
): DocumentSaveInvalidationScope | null {
  if ("canonicalRoot" in scope && scope.canonicalRoot !== undefined) {
    return scope;
  }
  if (!resolveOwnership) {
    return scope;
  }

  if (scope.kind === "workspace") {
    const separator = scope.rootPath.includes("\\") ? "\\" : "/";
    const sentinelPath = `${scope.rootPath.replace(/[\\/]+$/, "")}${separator}.document-save-scope`;
    const ownership = resolveOwnership(scope.rootPath, sentinelPath);
    if (!ownership) {
      return null;
    }
    if ("canonicalRoot" in ownership) {
      return { kind: "workspace", canonicalRoot: ownership.canonicalRoot };
    }

    return scope;
  }

  const ownership = resolveOwnership(scope.rootPath, scope.path);
  if (!ownership) {
    return null;
  }

  return { kind: scope.kind, ...ownership };
}

function documentSaveOwnershipResolutionError(scope: DocumentSaveInvalidationScope): Error {
  return new Error(`Cannot resolve document save ${scope.kind} ownership.`);
}
