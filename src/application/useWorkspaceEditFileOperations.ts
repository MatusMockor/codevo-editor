import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  isJavaScriptTypeScriptLanguageServerDocument,
  isLanguageServerDocument,
  languageServerUriSyncKey,
} from "../domain/languageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import {
  canUseLanguageServerFeature,
  pathFromLanguageServerUri,
  type LanguageServerFeaturesGateway,
  type LanguageServerTextEdit,
  type LanguageServerWorkspaceEdit,
  type LanguageServerWorkspaceFileChange,
  type LanguageServerWorkspaceFileOperation,
} from "../domain/languageServerFeatures";
import { isJavaScriptTypeScriptWatchedPath } from "../domain/javascriptTypeScriptWatchedFiles";
import {
  detectLanguage,
  getFileName,
  getParentPath,
  visibleEditorPaths,
  type EditorDocument,
  type WorkspaceFileGateway,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  canonicalWorkspaceEditDocumentVersion,
  canonicalWorkspaceEditDocumentPath,
  canonicalWorkspaceEditPath,
  mergeAliasedWorkspaceEditDocumentChanges,
} from "../domain/workspaceEditDocuments";
import { validateWorkspaceEditTextEditRanges } from "../domain/workspaceEditModelValidation";
import { applyLanguageServerTextEdits } from "./languageServerTextEdits";
import type {
  AppliedWorkspaceEditOpenDocument,
  WorkspaceEditApplicationContext,
  WorkspaceEditApplicationDecision,
} from "./workspaceEditApplication";
import { restoreUnchangedWorkspaceEditDocuments } from "./workspaceEditApplication";

export interface WorkspaceEditFileOperationsDependencies {
  workspaceRoot: string | null;
  hasPhpWorkspace: boolean;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  openPathsRef: MutableRefObject<string[]>;
  previewPathRef: MutableRefObject<string | null>;
  documentVersionsByUriRef: MutableRefObject<Record<string, number>>;
  javaScriptTypeScriptDocumentVersionsByUriRef: MutableRefObject<
    Record<string, number>
  >;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerFeaturesGateway: LanguageServerFeaturesGateway;
  workspaceFiles: WorkspaceFileGateway;
  reportChangedDocuments: (paths: readonly string[]) => void;
  setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  setOpenPaths: Dispatch<SetStateAction<string[]>>;
  setPreviewPath: Dispatch<SetStateAction<string | null>>;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  refreshDirectory: (path: string) => Promise<void>;
  syncClosedDocument: (document: EditorDocument) => Promise<void>;
  syncClosedJavaScriptTypeScriptDocument: (
    document: EditorDocument,
  ) => Promise<void>;
  isSessionPathInWorkspace: (rootPath: string, path: string) => boolean;
  isRunningLanguageServerForWorkspace: (
    status: LanguageServerRuntimeStatus | null,
    statusRoot: string | null,
    workspaceRoot: string | null | undefined,
  ) => status is Extract<LanguageServerRuntimeStatus, { kind: "running" }>;
  isLanguageServerSessionActiveForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  reportError: (source: string, error: unknown) => void;
}

export interface WorkspaceEditFileOperations {
  applyJavaScriptTypeScriptLanguageServerWorkspaceEdit: (
    edit: LanguageServerWorkspaceEdit,
    context: WorkspaceEditApplicationContext,
  ) => Promise<WorkspaceEditApplicationDecision>;
  applyPhpLanguageServerWorkspaceEdit: (
    edit: LanguageServerWorkspaceEdit,
    context: WorkspaceEditApplicationContext,
  ) => Promise<WorkspaceEditApplicationDecision>;
  applyJavaScriptTypeScriptRenameEdits: (
    oldPath: string,
    newPath: string,
  ) => Promise<boolean>;
  applyJavaScriptTypeScriptCreateEdits: (path: string) => Promise<boolean>;
  notifyJavaScriptTypeScriptFileCreated: (path: string) => Promise<void>;
  applyJavaScriptTypeScriptDeleteEdits: (path: string) => Promise<boolean>;
  notifyJavaScriptTypeScriptFileDeleted: (path: string) => Promise<void>;
  applyPhpRenameEdits: (oldPath: string, newPath: string) => Promise<void>;
  notifyJavaScriptTypeScriptFileRenamed: (
    oldPath: string,
    newPath: string,
  ) => Promise<void>;
  notifyPhpFileRenamed: (oldPath: string, newPath: string) => Promise<void>;
  notifyJavaScriptTypeScriptWatchedFilesChanged: (
    changes: LanguageServerWorkspaceFileChange[],
  ) => Promise<void>;
}

/**
 * Workspace-edit file operations (region Q of the workbench controller
 * decomposition). Owns open-document application, closed-file workspace edits,
 * file-operation reconciliation, and LSP will/did create/rename/delete hooks
 * for PHP and JavaScript/TypeScript. The shell still owns file explorer
 * commands and injects refs/setters/gateways so per-project root guards,
 * session guards, and PHP-vs-JS/TS isolation remain identical.
 */
export function useWorkspaceEditFileOperations(
  dependencies: WorkspaceEditFileOperationsDependencies,
): WorkspaceEditFileOperations {
  const {
    workspaceRoot,
    hasPhpWorkspace,
    currentWorkspaceRootRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    documentVersionsByUriRef,
    javaScriptTypeScriptDocumentVersionsByUriRef,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    workspaceFiles,
    reportChangedDocuments,
    setDocuments,
    setOpenPaths,
    setPreviewPath,
    setActivePath,
    setMessage,
    refreshDirectory,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    isSessionPathInWorkspace,
    isRunningLanguageServerForWorkspace,
    isLanguageServerSessionActiveForRoot,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
    reportError,
  } = dependencies;

  const applyWorkspaceEditToOpenDocuments = useCallback(
    (
      edit: LanguageServerWorkspaceEdit,
      rootPath: string,
      documentVersionsByUri: Record<string, number> = {},
    ): { editedPaths: string[]; rollback: () => void } => {
      const originalDocuments = documentsRef.current;
      const editedPaths = changedOpenDocumentPathsForWorkspaceEdit(
        edit,
        documentsRef.current,
        rootPath,
        documentVersionsByUri,
        isSessionPathInWorkspace,
      );

      const apply = (current: Record<string, EditorDocument>) => {
        let changed = false;
        const next = { ...current };

        for (const [uri, textEdits] of Object.entries(edit.changes)) {
          const path = pathFromLanguageServerUri(uri);

          if (!path) {
            continue;
          }

          if (!isSessionPathInWorkspace(rootPath, path)) {
            continue;
          }

          if (
            !isWorkspaceEditDocumentVersionCurrent(
              edit,
              rootPath,
              uri,
              documentVersionsByUri,
            )
          ) {
            continue;
          }

          const document = current[path];

          if (!document) {
            continue;
          }

          const nextContent = applyLanguageServerTextEdits(
            document.content,
            textEdits,
          );

          if (nextContent === document.content) {
            continue;
          }

          next[path] = {
            ...document,
            content: nextContent,
          };
          changed = true;
        }

        return changed ? next : current;
      };
      const appliedDocuments = apply(originalDocuments);
      documentsRef.current = appliedDocuments;
      setDocuments(appliedDocuments);
      reportChangedDocuments(editedPaths);

      return {
        editedPaths,
        rollback: () => {
          const restoreTouchedDocuments = (
            current: Record<string, EditorDocument>,
          ) =>
            restoreUnchangedWorkspaceEditDocuments(
              current,
              originalDocuments,
              appliedDocuments,
              editedPaths,
            );
          documentsRef.current = restoreTouchedDocuments(documentsRef.current);
          setDocuments(restoreTouchedDocuments);
          reportChangedDocuments(editedPaths);
        },
      };
    },
    [
      documentsRef,
      isSessionPathInWorkspace,
      reportChangedDocuments,
      setDocuments,
    ],
  );

  const reconcileJavaScriptTypeScriptWorkspaceEditFileOperations = useCallback(
    async (edit: LanguageServerWorkspaceEdit, rootPath: string) => {
      const fileOperations = edit.fileOperations ?? [];

      if (fileOperations.length === 0) {
        return;
      }

      const documentsToClose = Object.values(documentsRef.current).filter(
        (document) =>
          reconciledPathForWorkspaceFileOperations(
            document.path,
            fileOperations,
          ) !== document.path,
      );

      await Promise.all(
        documentsToClose.map((document) =>
          isJavaScriptTypeScriptLanguageServerDocument(document)
            ? syncClosedJavaScriptTypeScriptDocument(document)
            : Promise.resolve(),
        ),
      );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      setDocuments((current) =>
        reconciledDocumentsForWorkspaceEditFileOperations(current, edit),
      );
      setOpenPaths((current) =>
        reconciledEditorPathsForWorkspaceFileOperations(
          current,
          fileOperations,
        ),
      );
      setPreviewPath((current) =>
        current
          ? reconciledPathForWorkspaceFileOperations(current, fileOperations)
          : current,
      );
      setActivePath((current) =>
        current
          ? reconciledActivePathForWorkspaceFileOperations(
              current,
              openPathsRef.current,
              previewPathRef.current,
              fileOperations,
            )
          : current,
      );
    },
    [
      currentWorkspaceRootRef,
      documentsRef,
      openPathsRef,
      previewPathRef,
      setActivePath,
      setDocuments,
      setOpenPaths,
      setPreviewPath,
      syncClosedJavaScriptTypeScriptDocument,
    ],
  );

  const refreshJavaScriptTypeScriptWorkspaceEditFileOperationDirectories =
    useCallback(
      async (edit: LanguageServerWorkspaceEdit, rootPath: string) => {
        const directories = directoryPathsForWorkspaceEditFileOperations(
          edit,
        ).filter((directory) => isSessionPathInWorkspace(rootPath, directory));

        for (const directory of directories) {
          if (
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)
          ) {
            return;
          }

          await refreshDirectory(directory);
        }
      },
      [currentWorkspaceRootRef, isSessionPathInWorkspace, refreshDirectory],
    );

  const reconcilePhpWorkspaceEditFileOperations = useCallback(
    async (edit: LanguageServerWorkspaceEdit, rootPath: string) => {
      const fileOperations = edit.fileOperations ?? [];

      if (fileOperations.length === 0) {
        return;
      }

      const documentsToClose = Object.values(documentsRef.current).filter(
        (document) =>
          isLanguageServerDocument(document) &&
          reconciledPathForWorkspaceFileOperations(
            document.path,
            fileOperations,
          ) !== document.path,
      );

      await Promise.all(
        documentsToClose.map((document) => syncClosedDocument(document)),
      );

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      setDocuments((current) =>
        reconciledDocumentsForWorkspaceEditFileOperations(current, edit),
      );
      setOpenPaths((current) =>
        reconciledEditorPathsForWorkspaceFileOperations(
          current,
          fileOperations,
        ),
      );
      setPreviewPath((current) =>
        current
          ? reconciledPathForWorkspaceFileOperations(current, fileOperations)
          : current,
      );
      setActivePath((current) =>
        current
          ? reconciledActivePathForWorkspaceFileOperations(
              current,
              openPathsRef.current,
              previewPathRef.current,
              fileOperations,
            )
          : current,
      );
    },
    [
      currentWorkspaceRootRef,
      documentsRef,
      openPathsRef,
      previewPathRef,
      setActivePath,
      setDocuments,
      setOpenPaths,
      setPreviewPath,
      syncClosedDocument,
    ],
  );

  const refreshPhpWorkspaceEditFileOperationDirectories = useCallback(
    async (edit: LanguageServerWorkspaceEdit, rootPath: string) => {
      const directories = directoryPathsForWorkspaceEditFileOperations(
        edit,
      ).filter((directory) => isSessionPathInWorkspace(rootPath, directory));

      for (const directory of directories) {
        if (
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)
        ) {
          return;
        }

        await refreshDirectory(directory);
      }
    },
    [currentWorkspaceRootRef, isSessionPathInWorkspace, refreshDirectory],
  );

  const synchronizeAppliedOpenDocuments = useCallback(
    (
      appliedOpenDocuments: AppliedWorkspaceEditOpenDocument[],
      rootPath: string,
    ) => {
      const appliedDocuments = appliedOpenDocuments.filter(({ path }) =>
        isSessionPathInWorkspace(rootPath, path),
      );

      if (appliedDocuments.length === 0) {
        return;
      }

      const synchronize = (current: Record<string, EditorDocument>) => {
        let changed = false;
        const next = { ...current };

        for (const appliedDocument of appliedDocuments) {
          const document = current[appliedDocument.path];

          if (!document || document.content === appliedDocument.content) {
            continue;
          }

          next[appliedDocument.path] = {
            ...document,
            content: appliedDocument.content,
          };
          changed = true;
        }

        return changed ? next : current;
      };

      const changedPaths = appliedDocuments
        .filter(
          ({ path, content }) =>
            documentsRef.current[path]?.content !== content,
        )
        .map(({ path }) => path);
      documentsRef.current = synchronize(documentsRef.current);
      setDocuments(synchronize);
      reportChangedDocuments(changedPaths);
    },
    [
      documentsRef,
      isSessionPathInWorkspace,
      reportChangedDocuments,
      setDocuments,
    ],
  );

  const commitWorkspaceEdit = useCallback(
    async (
      rootEdit: LanguageServerWorkspaceEdit,
      context: WorkspaceEditApplicationContext,
      documentVersionsByUri: Record<string, number>,
    ): Promise<WorkspaceEditApplicationDecision> => {
      const requestedRoot = context.rootPath;
      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return { kind: "rejected", reason: "inactiveWorkspace" };
      }
      const openDocumentPaths = Object.keys(documentsRef.current);
      const transactionalApply = workspaceFiles.applyWorkspaceEditTransaction;
      if (
        (Object.keys(context.expectedClosedFileHashes ?? {}).length > 0 ||
          context.requiresAtomicFinalization === true) &&
        !transactionalApply
      ) {
        return {
          kind: "rejected",
          reason: "atomicWorkspaceEditUnavailable",
        };
      }
      const transaction = transactionalApply
        ? await transactionalApply(
            requestedRoot,
            rootEdit,
            openDocumentPaths,
            context.expectedClosedFileHashes,
          )
        : null;
      let openModelCommit: Extract<
        ReturnType<
          NonNullable<WorkspaceEditApplicationContext["applyOpenModels"]>
        >,
        { kind: "applied" }
      > | null = null;
      let controllerCommit: ReturnType<
        typeof applyWorkspaceEditToOpenDocuments
      > | null = null;

      try {
        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          )
        ) {
          await transaction?.rollback();
          return { kind: "rejected", reason: "inactiveWorkspace" };
        }

        const candidateOpenModelCommit = context.applyOpenModels?.() ?? {
          documents: [],
          kind: "applied" as const,
        };

        if (candidateOpenModelCommit.kind === "rejected") {
          await transaction?.rollback();
          return candidateOpenModelCommit;
        }
        openModelCommit = candidateOpenModelCommit;

        if (!transactionalApply) {
          await workspaceFiles.applyWorkspaceEdit(
            requestedRoot,
            rootEdit,
            openDocumentPaths,
          );
        }

        const controllerEdit = workspaceEditWithoutPaths(
          rootEdit,
          context.openPaths,
        );
        controllerCommit = applyWorkspaceEditToOpenDocuments(
          controllerEdit,
          requestedRoot,
          documentVersionsByUri,
        );
        const finalizedOpenModelCommit =
          openModelCommit.finalize?.() ?? openModelCommit;

        if (finalizedOpenModelCommit.kind === "rejected") {
          controllerCommit.rollback();
          openModelCommit.rollback?.();
          await transaction?.rollback();
          return finalizedOpenModelCommit;
        }

        openModelCommit = finalizedOpenModelCommit;
        synchronizeAppliedOpenDocuments(
          finalizedOpenModelCommit.documents,
          requestedRoot,
        );
        return { kind: "accepted" };
      } catch (error) {
        controllerCommit?.rollback();
        openModelCommit?.rollback?.();
        try {
          await transaction?.rollback();
        } catch (rollbackError) {
          const applyMessage =
            error instanceof Error ? error.message : String(error);
          const rollbackMessage =
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError);
          throw new Error(
            `Workspace edit failed (${applyMessage}) and its closed-file rollback also failed (${rollbackMessage}).`,
          );
        }
        throw error;
      }
    },
    [
      applyWorkspaceEditToOpenDocuments,
      currentWorkspaceRootRef,
      documentsRef,
      synchronizeAppliedOpenDocuments,
      workspaceFiles,
    ],
  );

  const applyJavaScriptTypeScriptLanguageServerWorkspaceEdit = useCallback(
    async (
      edit: LanguageServerWorkspaceEdit,
      context: WorkspaceEditApplicationContext,
    ): Promise<WorkspaceEditApplicationDecision> => {
      const requestedRoot = context.rootPath;

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return { kind: "rejected", reason: "inactiveWorkspace" };
      }

      const stalePath = staleOpenDocumentPath(
        edit,
        documentsRef.current,
        requestedRoot,
        javaScriptTypeScriptDocumentVersionsByUriRef.current,
        isSessionPathInWorkspace,
      );

      if (stalePath) {
        return {
          kind: "rejected",
          path: stalePath,
          reason: "staleDocumentVersion",
        };
      }

      const rootEdit = workspaceEditForRoot(
        edit,
        requestedRoot,
        isSessionPathInWorkspace,
      );
      const invalidOpenDocumentPath = invalidControllerOnlyOpenDocumentPath(
        rootEdit,
        documentsRef.current,
        context.openPaths,
      );

      if (invalidOpenDocumentPath) {
        return {
          kind: "rejected",
          path: invalidOpenDocumentPath,
          reason: "invalidOpenModelEdits",
        };
      }

      const decision = await commitWorkspaceEdit(
        rootEdit,
        context,
        javaScriptTypeScriptDocumentVersionsByUriRef.current,
      );

      if (decision.kind === "rejected") {
        return decision;
      }

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return { kind: "accepted" };
      }

      await reconcileJavaScriptTypeScriptWorkspaceEditFileOperations(
        rootEdit,
        requestedRoot,
      );

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return { kind: "accepted" };
      }

      await refreshJavaScriptTypeScriptWorkspaceEditFileOperationDirectories(
        rootEdit,
        requestedRoot,
      );
      return { kind: "accepted" };
    },
    [
      commitWorkspaceEdit,
      currentWorkspaceRootRef,
      documentsRef,
      isSessionPathInWorkspace,
      javaScriptTypeScriptDocumentVersionsByUriRef,
      reconcileJavaScriptTypeScriptWorkspaceEditFileOperations,
      refreshJavaScriptTypeScriptWorkspaceEditFileOperationDirectories,
    ],
  );

  const applyPhpLanguageServerWorkspaceEdit = useCallback(
    async (
      edit: LanguageServerWorkspaceEdit,
      context: WorkspaceEditApplicationContext,
    ): Promise<WorkspaceEditApplicationDecision> => {
      const requestedRoot = context.rootPath;

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return { kind: "rejected", reason: "inactiveWorkspace" };
      }

      const stalePath = staleOpenDocumentPath(
        edit,
        documentsRef.current,
        requestedRoot,
        documentVersionsByUriRef.current,
        isSessionPathInWorkspace,
      );

      if (stalePath) {
        return {
          kind: "rejected",
          path: stalePath,
          reason: "staleDocumentVersion",
        };
      }

      const rootEdit = workspaceEditForRoot(
        edit,
        requestedRoot,
        isSessionPathInWorkspace,
      );
      const invalidOpenDocumentPath = invalidControllerOnlyOpenDocumentPath(
        rootEdit,
        documentsRef.current,
        context.openPaths,
      );

      if (invalidOpenDocumentPath) {
        return {
          kind: "rejected",
          path: invalidOpenDocumentPath,
          reason: "invalidOpenModelEdits",
        };
      }

      const decision = await commitWorkspaceEdit(
        rootEdit,
        context,
        documentVersionsByUriRef.current,
      );

      if (decision.kind === "rejected") {
        return decision;
      }

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return { kind: "accepted" };
      }

      await reconcilePhpWorkspaceEditFileOperations(rootEdit, requestedRoot);

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return { kind: "accepted" };
      }

      await refreshPhpWorkspaceEditFileOperationDirectories(
        rootEdit,
        requestedRoot,
      );
      return { kind: "accepted" };
    },
    [
      commitWorkspaceEdit,
      currentWorkspaceRootRef,
      documentVersionsByUriRef,
      documentsRef,
      isSessionPathInWorkspace,
      reconcilePhpWorkspaceEditFileOperations,
      refreshPhpWorkspaceEditFileOperationDirectories,
    ],
  );

  const commitRenameWorkspaceEdit = useCallback(
    async (
      rootEdit: LanguageServerWorkspaceEdit,
      requestedRoot: string,
      documentVersionsByUri: Record<string, number>,
      isRequestedSessionActive: () => boolean,
    ): Promise<number | null> => {
      if (
        !isRequestedSessionActive() ||
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return null;
      }

      changedOpenDocumentPathsForWorkspaceEdit(
        rootEdit,
        documentsRef.current,
        requestedRoot,
        documentVersionsByUri,
        isSessionPathInWorkspace,
      );
      const openDocumentPaths = Object.keys(documentsRef.current);
      const transaction = workspaceFiles.applyWorkspaceEditTransaction
        ? await workspaceFiles.applyWorkspaceEditTransaction(
            requestedRoot,
            rootEdit,
            openDocumentPaths,
          )
        : null;

      if (!isRequestedSessionActive()) {
        await transaction?.rollback();
        return null;
      }

      let openDocumentCommit: ReturnType<
        typeof applyWorkspaceEditToOpenDocuments
      > | null = null;

      try {
        openDocumentCommit = applyWorkspaceEditToOpenDocuments(
          rootEdit,
          requestedRoot,
          documentVersionsByUri,
        );
        const changedClosedFiles = transaction
          ? transaction.appliedCount
          : await workspaceFiles.applyWorkspaceEdit(
              requestedRoot,
              rootEdit,
              openDocumentPaths,
            );

        if (!isRequestedSessionActive()) {
          openDocumentCommit.rollback();
          await transaction?.rollback();
          return null;
        }

        return changedClosedFiles + openDocumentCommit.editedPaths.length;
      } catch (error) {
        openDocumentCommit?.rollback();
        await transaction?.rollback();
        throw error;
      }
    },
    [
      applyWorkspaceEditToOpenDocuments,
      currentWorkspaceRootRef,
      documentsRef,
      isSessionPathInWorkspace,
      workspaceFiles,
    ],
  );

  const applyJavaScriptTypeScriptRenameEdits = useCallback(
    async (oldPath: string, newPath: string) => {
      if (
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        ) ||
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "willRenameFiles",
        )
      ) {
        return true;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );

      try {
        const edit =
          await javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles(
            requestedRoot,
            oldPath,
            newPath,
          );

        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return true;
        }

        if (!edit) {
          return true;
        }

        const rootEdit = workspaceEditForRoot(
          edit,
          requestedRoot,
          isSessionPathInWorkspace,
        );
        const stalePath = staleOpenDocumentPath(
          rootEdit,
          documentsRef.current,
          requestedRoot,
          javaScriptTypeScriptDocumentVersionsByUriRef.current,
          isSessionPathInWorkspace,
        );

        if (stalePath) {
          return false;
        }

        const changedFiles = await commitRenameWorkspaceEdit(
          rootEdit,
          requestedRoot,
          javaScriptTypeScriptDocumentVersionsByUriRef.current,
          isRequestedJavaScriptTypeScriptSessionActive,
        );

        if (changedFiles === null) {
          return true;
        }

        if (changedFiles > 0) {
          setMessage(
            `Updated ${changedFiles} import path${changedFiles === 1 ? "" : "s"}.`,
          );
        }

        return true;
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return true;
        }

        reportError("JavaScript/TypeScript Rename", error);
        return false;
      }
    },
    [
      commitRenameWorkspaceEdit,
      documentsRef,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      isRunningLanguageServerForWorkspace,
      isSessionPathInWorkspace,
      javaScriptTypeScriptDocumentVersionsByUriRef,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      setMessage,
      workspaceRoot,
    ],
  );

  const applyJavaScriptTypeScriptCreateEdits = useCallback(
    async (path: string) => {
      if (
        !isJavaScriptTypeScriptWatchedPath(path) ||
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        ) ||
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "willCreateFiles",
        )
      ) {
        return true;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );

      try {
        const edit =
          await javaScriptTypeScriptLanguageServerFeaturesGateway.willCreateFiles(
            requestedRoot,
            path,
          );

        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return true;
        }

        if (edit) {
          await applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
            openPaths: [],
            rootPath: requestedRoot,
          });
        }

        return true;
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return true;
        }

        reportError("JavaScript/TypeScript Create", error);
        return false;
      }
    },
    [
      applyJavaScriptTypeScriptLanguageServerWorkspaceEdit,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      isRunningLanguageServerForWorkspace,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      workspaceRoot,
    ],
  );

  const notifyJavaScriptTypeScriptFileCreated = useCallback(
    async (path: string) => {
      if (
        !isJavaScriptTypeScriptWatchedPath(path) ||
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      try {
        if (
          canUseLanguageServerFeature(
            javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
            "didCreateFiles",
          )
        ) {
          await javaScriptTypeScriptLanguageServerFeaturesGateway.didCreateFiles(
            requestedRoot,
            path,
          );
        } else {
          await javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles(
            requestedRoot,
            [
              {
                changeType: "created",
                path,
              },
            ],
          );
        }
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return;
        }

        reportError("JavaScript/TypeScript Create", error);
      }
    },
    [
      currentWorkspaceRootRef,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      isRunningLanguageServerForWorkspace,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      workspaceRoot,
    ],
  );

  const applyJavaScriptTypeScriptDeleteEdits = useCallback(
    async (path: string) => {
      if (
        !isJavaScriptTypeScriptWatchedPath(path) ||
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        ) ||
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "willDeleteFiles",
        )
      ) {
        return true;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );

      try {
        const edit =
          await javaScriptTypeScriptLanguageServerFeaturesGateway.willDeleteFiles(
            requestedRoot,
            path,
          );

        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return true;
        }

        if (edit) {
          await applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
            openPaths: [],
            rootPath: requestedRoot,
          });
        }

        return true;
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return true;
        }

        reportError("JavaScript/TypeScript Delete", error);
        return false;
      }
    },
    [
      applyJavaScriptTypeScriptLanguageServerWorkspaceEdit,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      isRunningLanguageServerForWorkspace,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      workspaceRoot,
    ],
  );

  const notifyJavaScriptTypeScriptFileDeleted = useCallback(
    async (path: string) => {
      if (
        !isJavaScriptTypeScriptWatchedPath(path) ||
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      try {
        if (
          canUseLanguageServerFeature(
            javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
            "didDeleteFiles",
          )
        ) {
          await javaScriptTypeScriptLanguageServerFeaturesGateway.didDeleteFiles(
            requestedRoot,
            path,
          );
        } else {
          await javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles(
            requestedRoot,
            [
              {
                changeType: "deleted",
                path,
              },
            ],
          );
        }
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return;
        }

        reportError("JavaScript/TypeScript Delete", error);
      }
    },
    [
      currentWorkspaceRootRef,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      isRunningLanguageServerForWorkspace,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      workspaceRoot,
    ],
  );

  const applyPhpRenameEdits = useCallback(
    async (oldPath: string, newPath: string) => {
      if (
        !workspaceRoot ||
        !hasPhpWorkspace ||
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        ) ||
        !canUseLanguageServerFeature(
          languageServerRuntimeStatus.capabilities,
          "willRenameFiles",
        )
      ) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId = languageServerRuntimeStatus.sessionId;
      const isRequestedPhpSessionActive = () =>
        isLanguageServerSessionActiveForRoot(requestedRoot, requestedSessionId);

      try {
        const edit = await languageServerFeaturesGateway.willRenameFiles(
          requestedRoot,
          oldPath,
          newPath,
        );

        if (!isRequestedPhpSessionActive()) {
          return;
        }

        if (!edit) {
          return;
        }

        const rootEdit = workspaceEditForRoot(
          edit,
          requestedRoot,
          isSessionPathInWorkspace,
        );
        const stalePath = staleOpenDocumentPath(
          rootEdit,
          documentsRef.current,
          requestedRoot,
          documentVersionsByUriRef.current,
          isSessionPathInWorkspace,
        );

        if (stalePath) {
          return;
        }

        const changedFiles = await commitRenameWorkspaceEdit(
          rootEdit,
          requestedRoot,
          documentVersionsByUriRef.current,
          isRequestedPhpSessionActive,
        );

        if (changedFiles === null) {
          return;
        }

        if (changedFiles > 0) {
          setMessage(
            `Updated ${changedFiles} PHP rename reference${changedFiles === 1 ? "" : "s"}.`,
          );
        }
      } catch (error) {
        if (!isRequestedPhpSessionActive()) {
          return;
        }

        reportError("PHP Rename", error);
      }
    },
    [
      commitRenameWorkspaceEdit,
      documentVersionsByUriRef,
      documentsRef,
      hasPhpWorkspace,
      isLanguageServerSessionActiveForRoot,
      isRunningLanguageServerForWorkspace,
      isSessionPathInWorkspace,
      languageServerFeaturesGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      reportError,
      setMessage,
      workspaceRoot,
    ],
  );

  const notifyJavaScriptTypeScriptFileRenamed = useCallback(
    async (oldPath: string, newPath: string) => {
      if (
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        ) ||
        !canUseLanguageServerFeature(
          javaScriptTypeScriptLanguageServerRuntimeStatus.capabilities,
          "didRenameFiles",
        )
      ) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      try {
        await javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles(
          requestedRoot,
          oldPath,
          newPath,
        );

        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          )
        ) {
          return;
        }
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return;
        }

        reportError("JavaScript/TypeScript Rename", error);
      }
    },
    [
      currentWorkspaceRootRef,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      isRunningLanguageServerForWorkspace,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      workspaceRoot,
    ],
  );

  const notifyPhpFileRenamed = useCallback(
    async (oldPath: string, newPath: string) => {
      if (
        !workspaceRoot ||
        !hasPhpWorkspace ||
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          workspaceRoot,
        ) ||
        !canUseLanguageServerFeature(
          languageServerRuntimeStatus.capabilities,
          "didRenameFiles",
        )
      ) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId = languageServerRuntimeStatus.sessionId;
      const isRequestedPhpSessionActive = () =>
        isLanguageServerSessionActiveForRoot(requestedRoot, requestedSessionId);

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      try {
        await languageServerFeaturesGateway.didRenameFiles(
          requestedRoot,
          oldPath,
          newPath,
        );

        if (
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          )
        ) {
          return;
        }
      } catch (error) {
        if (!isRequestedPhpSessionActive()) {
          return;
        }

        reportError("PHP Rename", error);
      }
    },
    [
      currentWorkspaceRootRef,
      hasPhpWorkspace,
      isLanguageServerSessionActiveForRoot,
      isRunningLanguageServerForWorkspace,
      languageServerFeaturesGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      reportError,
      workspaceRoot,
    ],
  );

  const notifyJavaScriptTypeScriptWatchedFilesChanged = useCallback(
    async (changes: LanguageServerWorkspaceFileChange[]) => {
      if (
        !workspaceRoot ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          workspaceRoot,
        )
      ) {
        return;
      }

      const relevantChanges = changes.filter((change) =>
        isJavaScriptTypeScriptWatchedPath(change.path),
      );

      if (relevantChanges.length === 0) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const isRequestedJavaScriptTypeScriptSessionActive = () =>
        isJavaScriptTypeScriptLanguageServerSessionActiveForRoot(
          requestedRoot,
          requestedSessionId,
        );

      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)
      ) {
        return;
      }

      try {
        await javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles(
          requestedRoot,
          relevantChanges,
        );
      } catch (error) {
        if (!isRequestedJavaScriptTypeScriptSessionActive()) {
          return;
        }

        reportError("JavaScript/TypeScript", error);
      }
    },
    [
      currentWorkspaceRootRef,
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot,
      isRunningLanguageServerForWorkspace,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportError,
      workspaceRoot,
    ],
  );

  return {
    applyJavaScriptTypeScriptLanguageServerWorkspaceEdit,
    applyPhpLanguageServerWorkspaceEdit,
    applyJavaScriptTypeScriptRenameEdits,
    applyJavaScriptTypeScriptCreateEdits,
    notifyJavaScriptTypeScriptFileCreated,
    applyJavaScriptTypeScriptDeleteEdits,
    notifyJavaScriptTypeScriptFileDeleted,
    applyPhpRenameEdits,
    notifyJavaScriptTypeScriptFileRenamed,
    notifyPhpFileRenamed,
    notifyJavaScriptTypeScriptWatchedFilesChanged,
  };
}

function changedOpenDocumentPathsForWorkspaceEdit(
  edit: LanguageServerWorkspaceEdit,
  documents: Record<string, EditorDocument>,
  rootPath: string,
  documentVersionsByUri: Record<string, number>,
  isSessionPathInWorkspace: (rootPath: string, path: string) => boolean,
): string[] {
  return Object.entries(edit.changes).flatMap(([uri, textEdits]) => {
    const path = pathFromLanguageServerUri(uri);

    if (!path) {
      return [];
    }

    if (!isSessionPathInWorkspace(rootPath, path)) {
      return [];
    }

    if (
      !isWorkspaceEditDocumentVersionCurrent(
        edit,
        rootPath,
        uri,
        documentVersionsByUri,
      )
    ) {
      return [];
    }

    const document = documents[path];

    if (!document) {
      return [];
    }

    return applyLanguageServerTextEdits(document.content, textEdits) ===
      document.content
      ? []
      : [path];
  });
}

function isWorkspaceEditDocumentVersionCurrent(
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
  uri: string,
  documentVersionsByUri: Record<string, number>,
): boolean {
  const editVersion = canonicalWorkspaceEditDocumentVersion(edit, uri);

  if (editVersion.kind === "unversioned") {
    return true;
  }

  if (editVersion.kind === "conflict") {
    return false;
  }

  return (
    documentVersionsByUri[languageServerUriSyncKey(rootPath, uri)] ===
    editVersion.version
  );
}

function invalidControllerOnlyOpenDocumentPath(
  edit: LanguageServerWorkspaceEdit,
  documents: Record<string, EditorDocument>,
  stagedOpenPaths: string[],
): string | null {
  const stagedPaths = new Set(stagedOpenPaths.map(canonicalWorkspaceEditPath));
  const documentsByPath = new Map(
    Object.values(documents).map((document) => [
      canonicalWorkspaceEditPath(document.path),
      document,
    ]),
  );

  for (const [uri, edits] of Object.entries(edit.changes)) {
    const path = canonicalWorkspaceEditDocumentPath(uri);

    if (!path || stagedPaths.has(path)) {
      continue;
    }

    const document = documentsByPath.get(path);

    if (!document) {
      continue;
    }

    if (
      validateWorkspaceEditTextEditRanges(document.content, edits) !== "valid"
    ) {
      return document.path;
    }
  }

  return null;
}

function staleOpenDocumentPath(
  edit: LanguageServerWorkspaceEdit,
  documents: Record<string, EditorDocument>,
  rootPath: string,
  documentVersionsByUri: Record<string, number>,
  isSessionPathInWorkspace: (rootPath: string, path: string) => boolean,
): string | null {
  for (const uri of Object.keys(edit.changes)) {
    const path = pathFromLanguageServerUri(uri);

    if (
      !path ||
      !documents[path] ||
      !isSessionPathInWorkspace(rootPath, path)
    ) {
      continue;
    }

    if (
      !isWorkspaceEditDocumentVersionCurrent(
        edit,
        rootPath,
        uri,
        documentVersionsByUri,
      )
    ) {
      return path;
    }
  }

  return null;
}

function workspaceEditForRoot(
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
  isSessionPathInWorkspace: (rootPath: string, path: string) => boolean,
): LanguageServerWorkspaceEdit {
  const changes = Object.fromEntries(
    Object.entries(edit.changes).filter(([uri]) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? isSessionPathInWorkspace(rootPath, path) : false;
    }),
  );
  const documentVersions = Object.fromEntries(
    Object.entries(edit.documentVersions ?? {}).filter(([uri]) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? isSessionPathInWorkspace(rootPath, path) : false;
    }),
  );
  const fileOperations = (edit.fileOperations ?? []).filter((operation) => {
    const uris =
      operation.kind === "rename"
        ? [operation.oldUri, operation.newUri]
        : [operation.uri];

    return uris.every((uri) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? isSessionPathInWorkspace(rootPath, path) : false;
    });
  });

  return mergeAliasedWorkspaceEditDocumentChanges({
    ...(fileOperations.length > 0 ? { fileOperations } : {}),
    ...(Object.keys(documentVersions).length > 0 ? { documentVersions } : {}),
    changes,
  });
}

function workspaceEditWithoutPaths(
  edit: LanguageServerWorkspaceEdit,
  paths: string[],
): LanguageServerWorkspaceEdit {
  if (paths.length === 0) {
    return edit;
  }

  const skippedPaths = new Set(paths.map(normalizedWorkspaceEditPath));
  const documentVersions = Object.fromEntries(
    Object.entries(edit.documentVersions ?? {}).filter(([uri]) => {
      const path = pathFromLanguageServerUri(uri);

      return !path || !skippedPaths.has(normalizedWorkspaceEditPath(path));
    }),
  );

  return {
    ...(edit.fileOperations && edit.fileOperations.length > 0
      ? { fileOperations: edit.fileOperations }
      : {}),
    ...(Object.keys(documentVersions).length > 0 ? { documentVersions } : {}),
    changes: Object.fromEntries(
      Object.entries(edit.changes).filter(([uri]) => {
        const path = pathFromLanguageServerUri(uri);

        return !path || !skippedPaths.has(normalizedWorkspaceEditPath(path));
      }),
    ),
  };
}

function directoryPathsForWorkspaceEditFileOperations(
  edit: LanguageServerWorkspaceEdit,
): string[] {
  const directories = new Set<string>();

  for (const operation of edit.fileOperations ?? []) {
    for (const path of pathsForWorkspaceFileOperation(operation)) {
      directories.add(getParentPath(path));
    }
  }

  return Array.from(directories);
}

function reconciledDocumentsForWorkspaceEditFileOperations(
  documents: Record<string, EditorDocument>,
  edit: LanguageServerWorkspaceEdit,
): Record<string, EditorDocument> {
  const operations = edit.fileOperations ?? [];
  let changed = false;
  const next: Record<string, EditorDocument> = {};

  for (const [path, document] of Object.entries(documents)) {
    const nextPath = reconciledPathForWorkspaceFileOperations(path, operations);

    if (!nextPath) {
      changed = true;
      continue;
    }

    if (nextPath === path) {
      next[path] = document;
      continue;
    }

    const renamedPathTextEdits =
      nextPath !== path ? textEditsForWorkspacePath(edit, nextPath) : null;
    const nextContent = renamedPathTextEdits
      ? applyLanguageServerTextEdits(document.content, renamedPathTextEdits)
      : document.content;

    changed = true;
    next[nextPath] = {
      ...document,
      content: nextContent,
      language: detectLanguage(nextPath),
      name: getFileName(nextPath),
      path: nextPath,
    };
  }

  return changed ? next : documents;
}

function textEditsForWorkspacePath(
  edit: LanguageServerWorkspaceEdit,
  path: string,
): LanguageServerTextEdit[] | null {
  const normalizedPath = normalizedWorkspaceEditPath(path);

  for (const [uri, textEdits] of Object.entries(edit.changes)) {
    const editPath = pathFromLanguageServerUri(uri);

    if (editPath && normalizedWorkspaceEditPath(editPath) === normalizedPath) {
      return textEdits;
    }
  }

  return null;
}

function reconciledEditorPathsForWorkspaceFileOperations(
  paths: string[],
  operations: LanguageServerWorkspaceFileOperation[],
): string[] {
  let changed = false;
  const next: string[] = [];

  for (const path of paths) {
    const nextPath = reconciledPathForWorkspaceFileOperations(path, operations);

    if (!nextPath) {
      changed = true;
      continue;
    }

    if (nextPath !== path) {
      changed = true;
    }

    if (next.includes(nextPath)) {
      changed = true;
      continue;
    }

    next.push(nextPath);
  }

  return changed ? next : paths;
}

function reconciledActivePathForWorkspaceFileOperations(
  activePath: string,
  openPaths: string[],
  previewPath: string | null,
  operations: LanguageServerWorkspaceFileOperation[],
): string | null {
  const nextActivePath = reconciledPathForWorkspaceFileOperations(
    activePath,
    operations,
  );

  if (nextActivePath) {
    return nextActivePath;
  }

  const nextVisiblePaths = reconciledEditorPathsForWorkspaceFileOperations(
    visibleEditorPaths(openPaths, previewPath),
    operations,
  );

  return nextVisiblePaths[nextVisiblePaths.length - 1] ?? null;
}

function reconciledPathForWorkspaceFileOperations(
  path: string,
  operations: LanguageServerWorkspaceFileOperation[],
): string | null {
  let nextPath: string | null = path;

  for (const operation of operations) {
    if (!nextPath) {
      return null;
    }

    if (operation.kind === "create") {
      continue;
    }

    if (operation.kind === "delete") {
      const deletedPath = pathFromLanguageServerUri(operation.uri);

      if (deletedPath && isSameOrChildWorkspacePath(nextPath, deletedPath)) {
        return null;
      }

      continue;
    }

    const oldPath = pathFromLanguageServerUri(operation.oldUri);
    const newPath = pathFromLanguageServerUri(operation.newUri);

    if (oldPath && newPath) {
      nextPath = replacedWorkspacePathPrefix(nextPath, oldPath, newPath);
    }
  }

  return nextPath;
}

function pathsForWorkspaceFileOperation(
  operation: LanguageServerWorkspaceFileOperation,
): string[] {
  if (operation.kind === "rename") {
    const oldPath = pathFromLanguageServerUri(operation.oldUri);
    const newPath = pathFromLanguageServerUri(operation.newUri);

    return oldPath && newPath ? [oldPath, newPath] : [];
  }

  const path = pathFromLanguageServerUri(operation.uri);

  return path ? [path] : [];
}

function replacedWorkspacePathPrefix(
  path: string,
  oldPath: string,
  newPath: string,
): string {
  if (!isSameOrChildWorkspacePath(path, oldPath)) {
    return path;
  }

  const normalizedPath = normalizedWorkspaceEditPath(path);
  const normalizedOldPath = normalizedWorkspaceEditPath(oldPath);
  const normalizedNewPath = normalizedWorkspaceEditPath(newPath);

  if (normalizedPath === normalizedOldPath) {
    return normalizedNewPath;
  }

  return `${normalizedNewPath}${normalizedPath.slice(normalizedOldPath.length)}`;
}

function isSameOrChildWorkspacePath(path: string, parentPath: string): boolean {
  const normalizedPath = normalizedWorkspaceEditPath(path);
  const normalizedParentPath = normalizedWorkspaceEditPath(parentPath);

  return (
    normalizedPath === normalizedParentPath ||
    normalizedPath.startsWith(`${normalizedParentPath}/`)
  );
}

function normalizedWorkspaceEditPath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}
