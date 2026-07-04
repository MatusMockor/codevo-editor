import { useCallback, type MutableRefObject } from "react";
import type { EditorDocument } from "../domain/workspace";
import {
  createLanguageServerTextDocument,
  fileUriFromPath,
  isLanguageServerDocument,
  languageServerDocumentSyncKey,
  languageServerPathFromDocumentSyncKey,
  languageServerUriSyncKey,
  type LanguageServerDocumentSyncGateway,
  type LanguageServerTextDocument,
} from "../domain/languageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { cachedLanguageServerRuntimeStatusForRoot } from "../domain/languageServerRuntimeStatusCache";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

/**
 * LSP document-sync collaborators the workbench shell owns and injects. Two
 * symmetric-but-separate families run in parallel: PHP (phpactor) and
 * JavaScript/TypeScript (tsserver). Their document-open/change/save/close
 * lifecycle, per-document monotonic versioning, debounce timers, pending-change
 * buffers, and sync generation are all timing-sensitive and race-safe, so every
 * piece of state stays a shell-owned ref and is injected here verbatim rather
 * than duplicated. The version/enqueue/clear/reset helpers and the session /
 * runtime guards are shared with other shell flows (diagnostics, format-on-save,
 * LSP restart), so they stay in the shell and are injected too.
 */
export interface DocumentSyncDependencies {
  // Shared workspace + document state (shell-owned).
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;

  // PHP (phpactor) document-sync state (shell-owned).
  syncedDocumentPathsRef: MutableRefObject<Set<string>>;
  syncedDocumentContentRef: MutableRefObject<Record<string, string>>;
  pendingDocumentChangesRef: MutableRefObject<
    Record<string, LanguageServerTextDocument>
  >;
  pendingDocumentOpenSyncAttemptsRef: MutableRefObject<Record<string, number>>;
  documentOpenSyncAttemptIdRef: MutableRefObject<number>;
  documentChangeTimersRef: MutableRefObject<Record<string, number>>;
  documentSyncQueuesRef: MutableRefObject<Record<string, Promise<void>>>;
  documentSyncGenerationRef: MutableRefObject<number>;
  documentVersionsRef: MutableRefObject<Record<string, number>>;
  documentVersionsByUriRef: MutableRefObject<Record<string, number>>;
  lastAppliedDiagnosticVersionByUriRef: MutableRefObject<
    Record<string, number>
  >;
  languageServerRuntimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  languageServerRuntimeStatusRootRef: MutableRefObject<string | null>;
  languageServerRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;

  // JavaScript/TypeScript (tsserver) document-sync state (shell-owned).
  javaScriptTypeScriptSyncedDocumentPathsRef: MutableRefObject<Set<string>>;
  javaScriptTypeScriptSyncedDocumentContentRef: MutableRefObject<
    Record<string, string>
  >;
  javaScriptTypeScriptPendingDocumentChangesRef: MutableRefObject<
    Record<string, LanguageServerTextDocument>
  >;
  javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef: MutableRefObject<
    Record<string, number>
  >;
  javaScriptTypeScriptDocumentOpenSyncAttemptIdRef: MutableRefObject<number>;
  javaScriptTypeScriptDocumentChangeTimersRef: MutableRefObject<
    Record<string, number>
  >;
  javaScriptTypeScriptDocumentSyncQueuesRef: MutableRefObject<
    Record<string, Promise<void>>
  >;
  javaScriptTypeScriptDocumentSyncGenerationRef: MutableRefObject<number>;
  javaScriptTypeScriptDocumentVersionsRef: MutableRefObject<
    Record<string, number>
  >;
  javaScriptTypeScriptDocumentVersionsByUriRef: MutableRefObject<
    Record<string, number>
  >;
  javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef: MutableRefObject<
    Record<string, number>
  >;
  javaScriptTypeScriptLanguageServerRuntimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: MutableRefObject<string | null>;
  javaScriptTypeScriptRuntimeStatusByRootRef: MutableRefObject<
    Record<string, LanguageServerRuntimeStatus>
  >;

  // Live runtime-status values (drive useCallback identity, matching the shell).
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;

  // Document-sync gateways (one per language family).
  languageServerDocumentSyncGateway: LanguageServerDocumentSyncGateway;
  javaScriptTypeScriptLanguageServerDocumentSyncGateway: LanguageServerDocumentSyncGateway;

  // Shared sync primitives (shell-owned, also used by other shell flows).
  nextDocumentVersion: (rootPath: string, path: string) => number;
  nextJavaScriptTypeScriptDocumentVersion: (
    rootPath: string,
    path: string,
  ) => number;
  clearDocumentChangeTimer: (key: string) => void;
  clearJavaScriptTypeScriptDocumentChangeTimer: (key: string) => void;
  enqueueDocumentSync: (
    path: string,
    operation: () => Promise<void>,
  ) => Promise<void>;
  enqueueJavaScriptTypeScriptDocumentSync: (
    key: string,
    operation: () => Promise<void>,
  ) => Promise<void>;
  resetLanguageServerDocuments: () => void;
  warmUpPhpLanguageServerIndex: (
    rootPath: string,
    path: string,
    requestedSessionId: number,
  ) => void;

  // Session / runtime guards (shell-owned).
  isLanguageServerSessionCurrentForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot: (
    rootPath: string,
    sessionId: number,
  ) => boolean;
  isRunningLanguageServerForWorkspace: (
    status: LanguageServerRuntimeStatus | null,
    statusRoot: string | null,
    workspaceRoot: string | null | undefined,
  ) => status is Extract<LanguageServerRuntimeStatus, { kind: "running" }>;
  isSessionPathInWorkspace: (rootPath: string, path: string) => boolean;
  isJavaScriptTypeScriptDocumentSyncableForRoot: (
    rootPath: string,
    document: EditorDocument,
  ) => boolean;

  // Error reporters (shell-owned, workspace-root isolated).
  reportLanguageServerError: (error: unknown) => void;
  reportLanguageServerErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    error: unknown,
  ) => void;
  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
}

export interface DocumentSync {
  syncOpenDocument: (document: EditorDocument) => Promise<void>;
  syncOpenJavaScriptTypeScriptDocument: (
    document: EditorDocument,
  ) => Promise<void>;
  scheduleDocumentChange: (document: EditorDocument) => void;
  scheduleJavaScriptTypeScriptDocumentChange: (
    document: EditorDocument,
  ) => void;
  flushPendingDocumentChange: (path: string) => Promise<void>;
  flushPendingJavaScriptTypeScriptDocumentChange: (
    path: string,
  ) => Promise<void>;
  isLanguageServerDocumentSynced: (path: string) => boolean;
  syncSavedDocument: (document: EditorDocument) => Promise<void>;
  syncSavedJavaScriptTypeScriptDocument: (
    document: EditorDocument,
  ) => Promise<void>;
  syncClosedDocument: (document: EditorDocument) => Promise<void>;
  syncClosedJavaScriptTypeScriptDocument: (
    document: EditorDocument,
  ) => Promise<void>;
  closeSyncedLanguageServerDocumentsForRoot: (
    rootPath: string,
  ) => Promise<void>;
  closeSyncedJavaScriptTypeScriptDocumentsForRoot: (
    rootPath: string,
  ) => Promise<void>;
}

/**
 * LSP document sync (region I of the workbench controller decomposition).
 * Owns the didOpen/didChange/didSave/didClose lifecycle for both the PHP
 * (phpactor) and JavaScript/TypeScript (tsserver) language servers. Every flow
 * captures the requested workspace root, sync generation, and session up front
 * and re-checks them after each await so a stale result from a switched-away or
 * restarted workspace tab is dropped (per-project isolation). Moved verbatim
 * from useWorkbenchController to keep the timing-sensitive debounce/version/
 * ordering behavior byte-for-byte identical.
 */
export function useDocumentSync(
  dependencies: DocumentSyncDependencies,
): DocumentSync {
  const {
    currentWorkspaceRootRef,
    activeDocumentRef,
    documentsRef,
    syncedDocumentPathsRef,
    syncedDocumentContentRef,
    pendingDocumentChangesRef,
    pendingDocumentOpenSyncAttemptsRef,
    documentOpenSyncAttemptIdRef,
    documentChangeTimersRef,
    documentSyncQueuesRef,
    documentSyncGenerationRef,
    documentVersionsRef,
    documentVersionsByUriRef,
    lastAppliedDiagnosticVersionByUriRef,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRootRef,
    languageServerRuntimeStatusByRootRef,
    javaScriptTypeScriptSyncedDocumentPathsRef,
    javaScriptTypeScriptSyncedDocumentContentRef,
    javaScriptTypeScriptPendingDocumentChangesRef,
    javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef,
    javaScriptTypeScriptDocumentOpenSyncAttemptIdRef,
    javaScriptTypeScriptDocumentChangeTimersRef,
    javaScriptTypeScriptDocumentSyncQueuesRef,
    javaScriptTypeScriptDocumentSyncGenerationRef,
    javaScriptTypeScriptDocumentVersionsRef,
    javaScriptTypeScriptDocumentVersionsByUriRef,
    javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerDocumentSyncGateway,
    javaScriptTypeScriptLanguageServerDocumentSyncGateway,
    nextDocumentVersion,
    nextJavaScriptTypeScriptDocumentVersion,
    clearDocumentChangeTimer,
    clearJavaScriptTypeScriptDocumentChangeTimer,
    enqueueDocumentSync,
    enqueueJavaScriptTypeScriptDocumentSync,
    resetLanguageServerDocuments,
    warmUpPhpLanguageServerIndex,
    isLanguageServerSessionCurrentForRoot,
    isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
    isRunningLanguageServerForWorkspace,
    isSessionPathInWorkspace,
    isJavaScriptTypeScriptDocumentSyncableForRoot,
    reportLanguageServerError,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    reportErrorForActiveWorkspaceRoot,
  } = dependencies;

  const syncOpenDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      if (!rootPath || !isLanguageServerDocument(document)) {
        return;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, document.path);

      if (syncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      const version = nextDocumentVersion(rootPath, document.path);
      const syncedDocument = createLanguageServerTextDocument(document, version);
      syncedDocumentPathsRef.current.add(syncKey);
      syncedDocumentContentRef.current[syncKey] = document.content;
      const openSyncAttemptId = documentOpenSyncAttemptIdRef.current + 1;
      documentOpenSyncAttemptIdRef.current = openSyncAttemptId;
      pendingDocumentOpenSyncAttemptsRef.current[syncKey] = openSyncAttemptId;
      const clearPendingOpenSyncState = () => {
        if (
          pendingDocumentOpenSyncAttemptsRef.current[syncKey] !==
          openSyncAttemptId
        ) {
          return;
        }

        syncedDocumentPathsRef.current.delete(syncKey);
        delete syncedDocumentContentRef.current[syncKey];
        delete pendingDocumentOpenSyncAttemptsRef.current[syncKey];
        delete documentVersionsRef.current[syncKey];
        delete documentVersionsByUriRef.current[
          languageServerUriSyncKey(rootPath, fileUriFromPath(document.path))
        ];
        delete lastAppliedDiagnosticVersionByUriRef.current[
          languageServerUriSyncKey(rootPath, fileUriFromPath(document.path))
        ];
      };
      const clearPendingOpenSyncAttempt = () => {
        if (
          pendingDocumentOpenSyncAttemptsRef.current[syncKey] ===
          openSyncAttemptId
        ) {
          delete pendingDocumentOpenSyncAttemptsRef.current[syncKey];
        }
      };
      const requestedSessionId = languageServerRuntimeStatus.sessionId;
      const requestedSyncGeneration = documentSyncGenerationRef.current;

      try {
        await enqueueDocumentSync(syncKey, async () => {
          if (
            documentSyncGenerationRef.current !== requestedSyncGeneration ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
            !isLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId)
          ) {
            clearPendingOpenSyncState();
            return;
          }

          await languageServerDocumentSyncGateway.didOpen(
            rootPath,
            syncedDocument,
          );
          clearPendingOpenSyncAttempt();
          // The first PHP document is now open on the active phpactor session:
          // force-warm its index off the back of this didOpen so the user's
          // first real navigation is warm. Fire-and-forget (does not block the
          // sync queue), once per root, self-isolating.
          warmUpPhpLanguageServerIndex(rootPath, document.path, requestedSessionId);
        });
      } catch (error) {
        clearPendingOpenSyncState();
        reportLanguageServerError(error);
      }
    },
    [
      enqueueDocumentSync,
      isLanguageServerSessionCurrentForRoot,
      languageServerDocumentSyncGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      nextDocumentVersion,
      reportLanguageServerError,
      warmUpPhpLanguageServerIndex,
    ],
  );

  const syncOpenJavaScriptTypeScriptDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (
        !rootPath ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      if (!isJavaScriptTypeScriptDocumentSyncableForRoot(rootPath, document)) {
        return;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, document.path);

      if (javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      const version = nextJavaScriptTypeScriptDocumentVersion(
        rootPath,
        document.path,
      );
      const syncedDocument = createLanguageServerTextDocument(document, version);
      javaScriptTypeScriptSyncedDocumentPathsRef.current.add(syncKey);
      javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] =
        document.content;
      const openSyncAttemptId =
        javaScriptTypeScriptDocumentOpenSyncAttemptIdRef.current + 1;
      javaScriptTypeScriptDocumentOpenSyncAttemptIdRef.current = openSyncAttemptId;
      javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[syncKey] =
        openSyncAttemptId;
      const clearPendingOpenSyncState = () => {
        if (
          javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[
            syncKey
          ] !== openSyncAttemptId
        ) {
          return;
        }

        javaScriptTypeScriptSyncedDocumentPathsRef.current.delete(syncKey);
        delete javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey];
        delete javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[
          syncKey
        ];
        delete javaScriptTypeScriptDocumentVersionsRef.current[syncKey];
        delete javaScriptTypeScriptDocumentVersionsByUriRef.current[
          languageServerUriSyncKey(rootPath, fileUriFromPath(document.path))
        ];
        delete javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef.current[
          languageServerUriSyncKey(rootPath, fileUriFromPath(document.path))
        ];
      };
      const clearPendingOpenSyncAttempt = () => {
        if (
          javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[
            syncKey
          ] === openSyncAttemptId
        ) {
          delete javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[
            syncKey
          ];
        }
      };
      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const requestedSyncGeneration =
        javaScriptTypeScriptDocumentSyncGenerationRef.current;

      try {
        await enqueueJavaScriptTypeScriptDocumentSync(syncKey, async () => {
          if (
            javaScriptTypeScriptDocumentSyncGenerationRef.current !==
              requestedSyncGeneration ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
            !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
              rootPath,
              requestedSessionId,
            )
          ) {
            clearPendingOpenSyncState();
            return;
          }

          await javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen(
            rootPath,
            syncedDocument,
          );
          clearPendingOpenSyncAttempt();
        });
      } catch (error) {
        if (
          !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
            rootPath,
            requestedSessionId,
          )
        ) {
          return;
        }

        clearPendingOpenSyncState();
        reportErrorForActiveWorkspaceRoot(
          rootPath,
          "JavaScript/TypeScript",
          error,
        );
      }
    },
    [
      enqueueJavaScriptTypeScriptDocumentSync,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      nextJavaScriptTypeScriptDocumentVersion,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  const scheduleDocumentChange = useCallback(
    (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, document.path)
        : null;

      if (!rootPath || !syncKey || !syncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      if (syncedDocumentContentRef.current[syncKey] === document.content) {
        return;
      }

      clearDocumentChangeTimer(syncKey);
      syncedDocumentContentRef.current[syncKey] = document.content;

      const version = nextDocumentVersion(rootPath, document.path);
      const syncedDocument = createLanguageServerTextDocument(document, version);
      pendingDocumentChangesRef.current[syncKey] = syncedDocument;
      documentChangeTimersRef.current[syncKey] = window.setTimeout(() => {
        const pendingDocument = pendingDocumentChangesRef.current[syncKey];
        delete documentChangeTimersRef.current[syncKey];
        delete pendingDocumentChangesRef.current[syncKey];

        if (!pendingDocument) {
          return;
        }

        const requestedSessionId =
          languageServerRuntimeStatus?.kind === "running"
            ? languageServerRuntimeStatus.sessionId
            : null;

        if (requestedSessionId === null) {
          return;
        }

        const requestedSyncGeneration = documentSyncGenerationRef.current;

        void enqueueDocumentSync(syncKey, async () => {
          // The debounce timer can fire after closeDocument -> syncClosedDocument
          // has already removed this document from the synced set (and sent
          // didClose). Sending a didChange now would target a closed document
          // (UnknownDocument / desync), so drop it if the document is no longer
          // synced.
          if (
            !syncedDocumentPathsRef.current.has(syncKey) ||
            documentSyncGenerationRef.current !== requestedSyncGeneration ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
            !isLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId)
          ) {
            return;
          }

          await languageServerDocumentSyncGateway.didChange(
            rootPath,
            pendingDocument,
          );
        }).catch((error) => {
          if (!isLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId)) {
            return;
          }

          reportLanguageServerError(error);
        });
      }, 150);
    },
    [
      clearDocumentChangeTimer,
      enqueueDocumentSync,
      isLanguageServerSessionCurrentForRoot,
      languageServerDocumentSyncGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      nextDocumentVersion,
      reportLanguageServerError,
    ],
  );

  const scheduleJavaScriptTypeScriptDocumentChange = useCallback(
    (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (
        !rootPath ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, document.path)
        : null;

      if (
        !rootPath ||
        !syncKey ||
        !isJavaScriptTypeScriptDocumentSyncableForRoot(rootPath, document) ||
        !javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)
      ) {
        return;
      }

      if (
        javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] ===
        document.content
      ) {
        return;
      }

      clearJavaScriptTypeScriptDocumentChangeTimer(syncKey);
      javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] =
        document.content;

      const version = nextJavaScriptTypeScriptDocumentVersion(
        rootPath,
        document.path,
      );
      const syncedDocument = createLanguageServerTextDocument(document, version);
      javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey] =
        syncedDocument;
      javaScriptTypeScriptDocumentChangeTimersRef.current[syncKey] =
        window.setTimeout(() => {
          const pendingDocument =
            javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];
          delete javaScriptTypeScriptDocumentChangeTimersRef.current[syncKey];
          delete javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];

          if (!pendingDocument) {
            return;
          }

          const currentRuntimeStatus =
            javaScriptTypeScriptLanguageServerRuntimeStatusRef.current;

          if (
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
            !isRunningLanguageServerForWorkspace(
              currentRuntimeStatus,
              javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
              rootPath,
            )
          ) {
            return;
          }

          const requestedSessionId = currentRuntimeStatus.sessionId;
          const requestedSyncGeneration =
            javaScriptTypeScriptDocumentSyncGenerationRef.current;

          void enqueueJavaScriptTypeScriptDocumentSync(syncKey, async () => {
            // The debounce timer can fire after closeDocument ->
            // syncClosedJavaScriptTypeScriptDocument has already removed this
            // document from the synced set (and sent didClose). Single-tab close
            // does not bump the sync generation, so check synced-set membership
            // first; sending a didChange now would target a closed document
            // (UnknownDocument / desync), so drop it if no longer synced.
            if (
              !javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey) ||
              javaScriptTypeScriptDocumentSyncGenerationRef.current !==
                requestedSyncGeneration ||
              !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
              !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
                rootPath,
                requestedSessionId,
              )
            ) {
              return;
            }

            await javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange(
              rootPath,
              pendingDocument,
            );
          }).catch((error) => {
            if (
              !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
                rootPath,
                requestedSessionId,
              )
            ) {
              return;
            }

            reportErrorForActiveWorkspaceRoot(
              rootPath,
              "JavaScript/TypeScript",
              error,
            );
          });
        }, 150);
    },
    [
      clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueJavaScriptTypeScriptDocumentSync,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      nextJavaScriptTypeScriptDocumentVersion,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  const flushPendingDocumentChange = useCallback(
    async (path: string) => {
      const rootPath = currentWorkspaceRootRef.current;
      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, path)
        : null;

      if (!rootPath || !syncKey) {
        return;
      }

      if (
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      const requestedSessionId = languageServerRuntimeStatus.sessionId;
      const requestedSyncGeneration = documentSyncGenerationRef.current;
      const isRequestedSyncCurrent = () =>
        documentSyncGenerationRef.current === requestedSyncGeneration &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        isLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId);

      if (!syncedDocumentPathsRef.current.has(syncKey)) {
        const document =
          activeDocumentRef.current?.path === path
            ? activeDocumentRef.current
            : documentsRef.current[path];

        if (document && isLanguageServerDocument(document)) {
          await syncOpenDocument(document);
        }

        if (!isRequestedSyncCurrent()) {
          return;
        }
      }

      if (!syncedDocumentPathsRef.current.has(syncKey)) {
        await documentSyncQueuesRef.current[syncKey];
        if (!isRequestedSyncCurrent()) {
          return;
        }
        return;
      }

      let pendingDocument = pendingDocumentChangesRef.current[syncKey];

      if (!pendingDocument) {
        await documentSyncQueuesRef.current[syncKey];
        if (!isRequestedSyncCurrent()) {
          return;
        }
        pendingDocument = pendingDocumentChangesRef.current[syncKey];

        if (!pendingDocument) {
          return;
        }
      }

      if (!isRequestedSyncCurrent()) {
        return;
      }

      clearDocumentChangeTimer(syncKey);
      delete pendingDocumentChangesRef.current[syncKey];

      await enqueueDocumentSync(syncKey, async () => {
        if (!isRequestedSyncCurrent()) {
          return;
        }

        await languageServerDocumentSyncGateway.didChange(
          rootPath,
          pendingDocument,
        );
      });
    },
    [
      clearDocumentChangeTimer,
      enqueueDocumentSync,
      isLanguageServerSessionCurrentForRoot,
      languageServerDocumentSyncGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      syncOpenDocument,
    ],
  );

  // BUG 2 gate: reports whether a PHP document has already been opened
  // (`didOpen` sent) on the active workspace's language server. Outline /
  // breadcrumb DocumentSymbol fetches consult this so they never race ahead of
  // the document sync and trigger an UnknownDocument error. Isolated per
  // workspace via the active-root sync key.
  const isLanguageServerDocumentSynced = useCallback((path: string): boolean => {
    const rootPath = currentWorkspaceRootRef.current;

    if (!rootPath) {
      return false;
    }

    return syncedDocumentPathsRef.current.has(
      languageServerDocumentSyncKey(rootPath, path),
    );
  }, []);

  const flushPendingJavaScriptTypeScriptDocumentChange = useCallback(
    async (path: string) => {
      const rootPath = currentWorkspaceRootRef.current;
      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, path)
        : null;

      if (!rootPath || !syncKey) {
        return;
      }

      if (!isSessionPathInWorkspace(rootPath, path)) {
        return;
      }

      if (
        !rootPath ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const requestedSyncGeneration =
        javaScriptTypeScriptDocumentSyncGenerationRef.current;
      const isRequestedSessionCurrent = () =>
        javaScriptTypeScriptDocumentSyncGenerationRef.current ===
          requestedSyncGeneration &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
          rootPath,
          requestedSessionId,
        );

      if (!javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)) {
        const document =
          activeDocumentRef.current?.path === path
            ? activeDocumentRef.current
            : documentsRef.current[path];

        if (
          document &&
          isJavaScriptTypeScriptDocumentSyncableForRoot(rootPath, document)
        ) {
          await syncOpenJavaScriptTypeScriptDocument(document);
        }

        if (!isRequestedSessionCurrent()) {
          return;
        }
      }

      if (!javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)) {
        await javaScriptTypeScriptDocumentSyncQueuesRef.current[syncKey];
        if (!isRequestedSessionCurrent()) {
          return;
        }
        return;
      }

      let pendingDocument =
        javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];

      if (!pendingDocument) {
        await javaScriptTypeScriptDocumentSyncQueuesRef.current[syncKey];
        if (!isRequestedSessionCurrent()) {
          return;
        }
        pendingDocument =
          javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];

        if (!pendingDocument) {
          return;
        }
      }

      if (!isRequestedSessionCurrent()) {
        return;
      }

      clearJavaScriptTypeScriptDocumentChangeTimer(syncKey);
      delete javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];

      try {
        await enqueueJavaScriptTypeScriptDocumentSync(syncKey, async () => {
          if (!isRequestedSessionCurrent()) {
            return;
          }

          await javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange(
            rootPath,
            pendingDocument,
          );
        });
      } catch (error) {
        if (isRequestedSessionCurrent()) {
          throw error;
        }
      }
    },
    [
      clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueJavaScriptTypeScriptDocumentSync,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      syncOpenJavaScriptTypeScriptDocument,
    ],
  );

  const syncSavedDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;
      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, document.path)
        : null;

      if (!rootPath || !syncKey || !syncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      if (!rootPath || !isLanguageServerDocument(document)) {
        return;
      }

      if (
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      const requestedSessionId = languageServerRuntimeStatus.sessionId;
      const requestedSyncGeneration = documentSyncGenerationRef.current;
      const isRequestedSyncCurrent = () =>
        documentSyncGenerationRef.current === requestedSyncGeneration &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        isLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId);

      try {
        await flushPendingDocumentChange(document.path);

        if (!isRequestedSyncCurrent()) {
          return;
        }

        await enqueueDocumentSync(syncKey, async () => {
          if (!isRequestedSyncCurrent()) {
            return;
          }

          await languageServerDocumentSyncGateway.didSave(
            rootPath,
            createLanguageServerTextDocument(
              document,
              documentVersionsRef.current[syncKey] || 0,
            ),
          );
        });
      } catch (error) {
        if (!isRequestedSyncCurrent()) {
          return;
        }

        reportLanguageServerErrorForActiveWorkspaceRoot(rootPath, error);
      }
    },
    [
      enqueueDocumentSync,
      flushPendingDocumentChange,
      isLanguageServerSessionCurrentForRoot,
      languageServerDocumentSyncGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      reportLanguageServerErrorForActiveWorkspaceRoot,
    ],
  );

  const syncSavedJavaScriptTypeScriptDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;
      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, document.path)
        : null;

      if (
        !syncKey ||
        !javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)
      ) {
        return;
      }

      if (
        !rootPath ||
        !isJavaScriptTypeScriptDocumentSyncableForRoot(rootPath, document)
      ) {
        return;
      }

      if (
        !rootPath ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      const requestedSessionId =
        javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const requestedSyncGeneration =
        javaScriptTypeScriptDocumentSyncGenerationRef.current;
      const isRequestedSessionCurrent = () =>
        javaScriptTypeScriptDocumentSyncGenerationRef.current ===
          requestedSyncGeneration &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
          rootPath,
          requestedSessionId,
        );

      try {
        await flushPendingJavaScriptTypeScriptDocumentChange(document.path);

        if (!isRequestedSessionCurrent()) {
          return;
        }

        await enqueueJavaScriptTypeScriptDocumentSync(syncKey, async () => {
          if (!isRequestedSessionCurrent()) {
            return;
          }

          await javaScriptTypeScriptLanguageServerDocumentSyncGateway.didSave(
            rootPath,
            createLanguageServerTextDocument(
              document,
              javaScriptTypeScriptDocumentVersionsRef.current[syncKey] || 0,
            ),
          );
        });
      } catch (error) {
        if (!isRequestedSessionCurrent()) {
          return;
        }

        reportErrorForActiveWorkspaceRoot(
          rootPath,
          "JavaScript/TypeScript",
          error,
        );
      }
    },
    [
      enqueueJavaScriptTypeScriptDocumentSync,
      flushPendingJavaScriptTypeScriptDocumentChange,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  const syncClosedDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;
      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, document.path)
        : null;

      if (!rootPath || !syncKey || !syncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      const currentRuntimeStatus = languageServerRuntimeStatusRef.current;
      const requestedSessionId = isRunningLanguageServerForWorkspace(
        currentRuntimeStatus,
        languageServerRuntimeStatusRootRef.current,
        rootPath,
      )
        ? currentRuntimeStatus.sessionId
        : null;

      clearDocumentChangeTimer(syncKey);
      syncedDocumentPathsRef.current.delete(syncKey);
      delete syncedDocumentContentRef.current[syncKey];
      delete pendingDocumentChangesRef.current[syncKey];
      delete pendingDocumentOpenSyncAttemptsRef.current[syncKey];
      delete documentVersionsRef.current[syncKey];
      delete documentVersionsByUriRef.current[
        languageServerUriSyncKey(rootPath, fileUriFromPath(document.path))
      ];
      delete lastAppliedDiagnosticVersionByUriRef.current[
        languageServerUriSyncKey(rootPath, fileUriFromPath(document.path))
      ];

      try {
        await enqueueDocumentSync(syncKey, () =>
          languageServerDocumentSyncGateway.didClose(rootPath, document.path),
        );
      } catch (error) {
        if (
          requestedSessionId !== null &&
          !isLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId)
        ) {
          return;
        }

        reportLanguageServerErrorForActiveWorkspaceRoot(rootPath, error);
      }
    },
    [
      clearDocumentChangeTimer,
      enqueueDocumentSync,
      isLanguageServerSessionCurrentForRoot,
      languageServerDocumentSyncGateway,
      reportLanguageServerErrorForActiveWorkspaceRoot,
    ],
  );

  const syncClosedJavaScriptTypeScriptDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;
      const syncKey = rootPath
        ? languageServerDocumentSyncKey(rootPath, document.path)
        : null;

      if (
        !rootPath ||
        !syncKey ||
        !javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)
      ) {
        return;
      }

      const currentRuntimeStatus =
        javaScriptTypeScriptLanguageServerRuntimeStatusRef.current;
      const requestedSessionId = isRunningLanguageServerForWorkspace(
        currentRuntimeStatus,
        javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
        rootPath,
      )
        ? currentRuntimeStatus.sessionId
        : null;

      clearJavaScriptTypeScriptDocumentChangeTimer(syncKey);
      javaScriptTypeScriptSyncedDocumentPathsRef.current.delete(syncKey);
      delete javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey];
      delete javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];
      delete javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[
        syncKey
      ];
      delete javaScriptTypeScriptDocumentVersionsRef.current[syncKey];
      delete javaScriptTypeScriptDocumentVersionsByUriRef.current[
        languageServerUriSyncKey(rootPath, fileUriFromPath(document.path))
      ];
      delete javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef.current[
        languageServerUriSyncKey(rootPath, fileUriFromPath(document.path))
      ];

      try {
        await enqueueJavaScriptTypeScriptDocumentSync(syncKey, () =>
          javaScriptTypeScriptLanguageServerDocumentSyncGateway.didClose(
            rootPath,
            document.path,
          ),
        );
      } catch (error) {
        if (
          requestedSessionId !== null &&
          !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
            rootPath,
            requestedSessionId,
          )
        ) {
          return;
        }

        reportErrorForActiveWorkspaceRoot(
          rootPath,
          "JavaScript/TypeScript",
          error,
        );
      }
    },
    [
      clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueJavaScriptTypeScriptDocumentSync,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  const closeSyncedLanguageServerDocumentsForRoot = useCallback(
    async (rootPath: string) => {
      const syncedDocuments = Array.from(syncedDocumentPathsRef.current).flatMap(
        (key) => {
          const path = languageServerPathFromDocumentSyncKey(rootPath, key);

          return path ? [{ key, path }] : [];
        },
      );

      if (syncedDocuments.length > 0) {
        documentSyncGenerationRef.current += 1;
      }

      const currentRuntimeStatus =
        cachedLanguageServerRuntimeStatusForRoot(
          languageServerRuntimeStatusByRootRef.current,
          rootPath,
        ) ??
        (workspaceRootKeysEqual(languageServerRuntimeStatusRootRef.current, rootPath)
          ? languageServerRuntimeStatusRef.current
          : null);
      const requestedSessionId = isRunningLanguageServerForWorkspace(
        currentRuntimeStatus,
        currentRuntimeStatus?.rootPath ?? languageServerRuntimeStatusRootRef.current,
        rootPath,
      )
        ? currentRuntimeStatus.sessionId
        : null;

      await Promise.all(
        syncedDocuments.map(async ({ key, path }) => {
          clearDocumentChangeTimer(key);
          syncedDocumentPathsRef.current.delete(key);
          delete syncedDocumentContentRef.current[key];
          delete pendingDocumentChangesRef.current[key];
          delete pendingDocumentOpenSyncAttemptsRef.current[key];
          delete documentVersionsRef.current[key];
          delete documentVersionsByUriRef.current[
            languageServerUriSyncKey(rootPath, fileUriFromPath(path))
          ];
          delete lastAppliedDiagnosticVersionByUriRef.current[
            languageServerUriSyncKey(rootPath, fileUriFromPath(path))
          ];

          try {
            await enqueueDocumentSync(key, () =>
              languageServerDocumentSyncGateway.didClose(rootPath, path),
            );
          } catch (error) {
            if (
              requestedSessionId !== null &&
              !isLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId)
            ) {
              return;
            }

            reportLanguageServerErrorForActiveWorkspaceRoot(rootPath, error);
          }
        }),
      );

      if (syncedDocumentPathsRef.current.size === 0) {
        resetLanguageServerDocuments();
      }
    },
    [
      clearDocumentChangeTimer,
      enqueueDocumentSync,
      isLanguageServerSessionCurrentForRoot,
      languageServerDocumentSyncGateway,
      reportLanguageServerErrorForActiveWorkspaceRoot,
      resetLanguageServerDocuments,
    ],
  );

  const closeSyncedJavaScriptTypeScriptDocumentsForRoot = useCallback(
    async (rootPath: string) => {
      const syncedDocuments = Array.from(
        javaScriptTypeScriptSyncedDocumentPathsRef.current,
      ).flatMap((key) => {
        const path = languageServerPathFromDocumentSyncKey(rootPath, key);

        return path && isSessionPathInWorkspace(rootPath, path)
          ? [{ key, path }]
          : [];
      });

      if (syncedDocuments.length > 0) {
        javaScriptTypeScriptDocumentSyncGenerationRef.current += 1;
      }

      const currentRuntimeStatus =
        cachedLanguageServerRuntimeStatusForRoot(
          javaScriptTypeScriptRuntimeStatusByRootRef.current,
          rootPath,
        ) ??
        (workspaceRootKeysEqual(
          javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
          rootPath,
        )
          ? javaScriptTypeScriptLanguageServerRuntimeStatusRef.current
          : null);
      const requestedSessionId = isRunningLanguageServerForWorkspace(
        currentRuntimeStatus,
        currentRuntimeStatus?.rootPath ??
          javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current,
        rootPath,
      )
        ? currentRuntimeStatus.sessionId
        : null;

      await Promise.all(
        syncedDocuments.map(async ({ key, path }) => {
          clearJavaScriptTypeScriptDocumentChangeTimer(key);
          javaScriptTypeScriptSyncedDocumentPathsRef.current.delete(key);
          delete javaScriptTypeScriptSyncedDocumentContentRef.current[key];
          delete javaScriptTypeScriptPendingDocumentChangesRef.current[key];
          delete javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[
            key
          ];
          delete javaScriptTypeScriptDocumentVersionsRef.current[key];
          delete javaScriptTypeScriptDocumentVersionsByUriRef.current[
            languageServerUriSyncKey(rootPath, fileUriFromPath(path))
          ];
          delete javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef
            .current[languageServerUriSyncKey(rootPath, fileUriFromPath(path))];

          try {
            await enqueueJavaScriptTypeScriptDocumentSync(key, () =>
              javaScriptTypeScriptLanguageServerDocumentSyncGateway.didClose(
                rootPath,
                path,
              ),
            );
          } catch (error) {
            if (
              requestedSessionId !== null &&
              !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
                rootPath,
                requestedSessionId,
              )
            ) {
              return;
            }

            reportErrorForActiveWorkspaceRoot(
              rootPath,
              "JavaScript/TypeScript",
              error,
            );
          }
        }),
      );
    },
    [
      clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueJavaScriptTypeScriptDocumentSync,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  return {
    syncOpenDocument,
    syncOpenJavaScriptTypeScriptDocument,
    scheduleDocumentChange,
    scheduleJavaScriptTypeScriptDocumentChange,
    flushPendingDocumentChange,
    flushPendingJavaScriptTypeScriptDocumentChange,
    isLanguageServerDocumentSynced,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    closeSyncedLanguageServerDocumentsForRoot,
    closeSyncedJavaScriptTypeScriptDocumentsForRoot,
  };
}
