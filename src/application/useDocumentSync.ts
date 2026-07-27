import { useCallback, useRef } from "react";
import type { EditorDocument } from "../domain/workspace";
import {
  createLanguageServerTextDocument,
  isLanguageServerDocument,
  languageServerDocumentSyncKey,
} from "../domain/languageServerDocumentSync";
import {
  defaultLargeSmartDocumentPolicy,
  isLargeSmartDocument,
} from "../domain/largeDocumentPolicy";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  DocumentSync,
  DocumentSyncDependencies,
  LanguageServerDocumentRequestLease,
} from "./documentSyncContracts";
import {
  closeJavaScriptTypeScriptDocumentsForRoot,
  closePhpDocumentsForRoot,
} from "./documentSyncCloseLifecycle";
import { clearDocumentSyncVersionState } from "./documentSyncVersionBookkeeping";
import { useJavaScriptTypeScriptDocumentRetirement } from "./useJavaScriptTypeScriptDocumentRetirement";

export type {
  DocumentSync,
  DocumentSyncDependencies,
  LanguageServerDocumentRequestLease,
} from "./documentSyncContracts";

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
export function useDocumentSync(dependencies: DocumentSyncDependencies): DocumentSync {
  const {
    largeSmartDocumentPolicy = defaultLargeSmartDocumentPolicy,
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
    nextDocumentLifecycleIdentityRef,
    documentLifecycleIdentitiesRef,
    pendingDocumentLifecycleIdentitiesRef,
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
  const javaScriptTypeScriptDocumentLifecycleIdentitiesRef = useRef<Record<string, number>>({});
  const javaScriptTypeScriptDocumentAuthorityVersionsRef = useRef<Record<string, number>>({});
  const nextJavaScriptTypeScriptDocumentAuthorityVersionRef = useRef(0);
  const issueJavaScriptTypeScriptDocumentVersion = useCallback(
    (rootPath: string, path: string): number => {
      const version = nextJavaScriptTypeScriptDocumentVersion(rootPath, path);
      nextJavaScriptTypeScriptDocumentAuthorityVersionRef.current += 1;
      javaScriptTypeScriptDocumentAuthorityVersionsRef.current[
        languageServerDocumentSyncKey(rootPath, path)
      ] = nextJavaScriptTypeScriptDocumentAuthorityVersionRef.current;
      return version;
    },
    [nextJavaScriptTypeScriptDocumentVersion],
  );
  const getLanguageServerDocumentLifecycleIdentity = useCallback(
    (rootPath: string, path: string): number | null => {
      const syncKey = languageServerDocumentSyncKey(rootPath, path);

      if (!syncedDocumentPathsRef.current.has(syncKey)) {
        return null;
      }

      return documentLifecycleIdentitiesRef.current[syncKey] ?? null;
    },
    [documentLifecycleIdentitiesRef, syncedDocumentPathsRef],
  );
  const getJavaScriptTypeScriptDocumentSyncVersion = useCallback(
    (rootPath: string, path: string): number | null => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return null;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, path);
      const document =
        activeDocumentRef.current?.path === path
          ? activeDocumentRef.current
          : documentsRef.current[path];
      if (
        !document ||
        isLargeSmartDocument(document, largeSmartDocumentPolicy) ||
        !javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey) ||
        javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey] !== undefined ||
        javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[syncKey] !== undefined ||
        javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey] === undefined ||
        javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] !== document.content
      ) {
        return null;
      }

      return javaScriptTypeScriptDocumentAuthorityVersionsRef.current[syncKey] ?? null;
    },
    [
      currentWorkspaceRootRef,
      activeDocumentRef,
      documentsRef,
      largeSmartDocumentPolicy,
      javaScriptTypeScriptPendingDocumentChangesRef,
      javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef,
      javaScriptTypeScriptSyncedDocumentContentRef,
      javaScriptTypeScriptSyncedDocumentPathsRef,
    ],
  );
  const {
    canOpen: canOpenJavaScriptTypeScriptDocument,
    retire: retireJavaScriptTypeScriptDocument,
  } = useJavaScriptTypeScriptDocumentRetirement({
    currentWorkspaceRootRef,
    syncedPathsRef: javaScriptTypeScriptSyncedDocumentPathsRef,
    syncedContentRef: javaScriptTypeScriptSyncedDocumentContentRef,
    pendingChangesRef: javaScriptTypeScriptPendingDocumentChangesRef,
    pendingOpenAttemptsRef: javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef,
    lifecycleIdentitiesRef: javaScriptTypeScriptDocumentLifecycleIdentitiesRef,
    authorityVersionsRef: javaScriptTypeScriptDocumentAuthorityVersionsRef,
    diagnosticVersionsByUriRef: javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
    documentVersionsByUriRef: javaScriptTypeScriptDocumentVersionsByUriRef,
    documentVersionsRef: javaScriptTypeScriptDocumentVersionsRef,
    syncGenerationRef: javaScriptTypeScriptDocumentSyncGenerationRef,
    runtimeStatusRef: javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    runtimeStatusRootRef: javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    clearChangeTimer: clearJavaScriptTypeScriptDocumentChangeTimer,
    enqueueSync: enqueueJavaScriptTypeScriptDocumentSync,
    gateway: javaScriptTypeScriptLanguageServerDocumentSyncGateway,
    isRunningForWorkspace: isRunningLanguageServerForWorkspace,
    isSessionCurrent: isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
    reportError: (rootPath, error) =>
      reportErrorForActiveWorkspaceRoot(rootPath, "JavaScript/TypeScript", error),
  });

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

      if (isLargeSmartDocument(document, largeSmartDocumentPolicy)) {
        return;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, document.path);

      if (syncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      for (const activeSyncKey of Object.keys(documentLifecycleIdentitiesRef.current)) {
        if (!syncedDocumentPathsRef.current.has(activeSyncKey)) {
          delete documentLifecycleIdentitiesRef.current[activeSyncKey];
        }
      }

      nextDocumentLifecycleIdentityRef.current += 1;
      const requestedLifecycleIdentity = nextDocumentLifecycleIdentityRef.current;
      pendingDocumentLifecycleIdentitiesRef.current[syncKey] = requestedLifecycleIdentity;

      const version = nextDocumentVersion(rootPath, document.path);
      const syncedDocument = createLanguageServerTextDocument(document, version);
      syncedDocumentPathsRef.current.add(syncKey);
      syncedDocumentContentRef.current[syncKey] = document.content;
      const openSyncAttemptId = documentOpenSyncAttemptIdRef.current + 1;
      documentOpenSyncAttemptIdRef.current = openSyncAttemptId;
      pendingDocumentOpenSyncAttemptsRef.current[syncKey] = openSyncAttemptId;
      const clearPendingOpenSyncState = () => {
        if (pendingDocumentOpenSyncAttemptsRef.current[syncKey] !== openSyncAttemptId) {
          return;
        }

        syncedDocumentPathsRef.current.delete(syncKey);
        delete documentLifecycleIdentitiesRef.current[syncKey];
        delete pendingDocumentLifecycleIdentitiesRef.current[syncKey];
        delete syncedDocumentContentRef.current[syncKey];
        delete pendingDocumentOpenSyncAttemptsRef.current[syncKey];
        clearDocumentSyncVersionState(
          {
            diagnosticVersionsByUriRef: lastAppliedDiagnosticVersionByUriRef,
            documentVersionsByUriRef,
            documentVersionsRef,
          },
          rootPath,
          document.path,
          syncKey,
        );
      };
      const clearPendingOpenSyncAttempt = () => {
        if (pendingDocumentOpenSyncAttemptsRef.current[syncKey] === openSyncAttemptId) {
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
            requestedSessionId,
          );

          if (
            pendingDocumentOpenSyncAttemptsRef.current[syncKey] !== openSyncAttemptId ||
            documentSyncGenerationRef.current !== requestedSyncGeneration ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
            !isLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId)
          ) {
            clearPendingOpenSyncState();
            return;
          }

          documentLifecycleIdentitiesRef.current[syncKey] = requestedLifecycleIdentity;
          delete pendingDocumentLifecycleIdentitiesRef.current[syncKey];
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
      currentWorkspaceRootRef,
      documentLifecycleIdentitiesRef,
      documentOpenSyncAttemptIdRef,
      documentSyncGenerationRef,
      documentVersionsByUriRef,
      documentVersionsRef,
      enqueueDocumentSync,
      isLanguageServerSessionCurrentForRoot,
      isRunningLanguageServerForWorkspace,
      largeSmartDocumentPolicy,
      lastAppliedDiagnosticVersionByUriRef,
      languageServerDocumentSyncGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      nextDocumentLifecycleIdentityRef,
      nextDocumentVersion,
      pendingDocumentLifecycleIdentitiesRef,
      pendingDocumentOpenSyncAttemptsRef,
      reportLanguageServerError,
      syncedDocumentContentRef,
      syncedDocumentPathsRef,
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

      if (isLargeSmartDocument(document, largeSmartDocumentPolicy)) {
        return;
      }

      if (!canOpenJavaScriptTypeScriptDocument(rootPath, document.path)) {
        return;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, document.path);

      if (javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      const version = issueJavaScriptTypeScriptDocumentVersion(rootPath, document.path);
      const syncedDocument = createLanguageServerTextDocument(document, version);
      javaScriptTypeScriptSyncedDocumentPathsRef.current.add(syncKey);
      javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] = document.content;
      const openSyncAttemptId = javaScriptTypeScriptDocumentOpenSyncAttemptIdRef.current + 1;
      javaScriptTypeScriptDocumentOpenSyncAttemptIdRef.current = openSyncAttemptId;
      javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey] = openSyncAttemptId;
      javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[syncKey] = openSyncAttemptId;
      const clearPendingOpenSyncState = () => {
        if (
          javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[syncKey] !==
          openSyncAttemptId
        ) {
          return;
        }

        javaScriptTypeScriptSyncedDocumentPathsRef.current.delete(syncKey);
        if (
          javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey] === openSyncAttemptId
        ) {
          delete javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey];
        }
        delete javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey];
        delete javaScriptTypeScriptDocumentAuthorityVersionsRef.current[syncKey];
        delete javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[syncKey];
        clearDocumentSyncVersionState(
          {
            diagnosticVersionsByUriRef: javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
            documentVersionsByUriRef: javaScriptTypeScriptDocumentVersionsByUriRef,
            documentVersionsRef: javaScriptTypeScriptDocumentVersionsRef,
          },
          rootPath,
          document.path,
          syncKey,
        );
      };
      const clearPendingOpenSyncAttempt = () => {
        if (
          javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[syncKey] ===
          openSyncAttemptId
        ) {
          delete javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[syncKey];
        }
      };
      const requestedSessionId = javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const requestedSyncGeneration = javaScriptTypeScriptDocumentSyncGenerationRef.current;

      try {
        await enqueueJavaScriptTypeScriptDocumentSync(syncKey, async () => {
          if (
            javaScriptTypeScriptDocumentSyncGenerationRef.current !== requestedSyncGeneration ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
            !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
              rootPath,
              requestedSessionId,
            ) ||
            !canOpenJavaScriptTypeScriptDocument(rootPath, document.path)
          ) {
            clearPendingOpenSyncState();
            return;
          }

          await javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen(
            rootPath,
            syncedDocument,
          );

          if (
            javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[syncKey] !==
              openSyncAttemptId ||
            javaScriptTypeScriptDocumentSyncGenerationRef.current !== requestedSyncGeneration ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
            !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId)
          ) {
            clearPendingOpenSyncState();
            return;
          }

          clearPendingOpenSyncAttempt();
        });
      } catch (error) {
        clearPendingOpenSyncState();
        if (
          javaScriptTypeScriptDocumentSyncGenerationRef.current !== requestedSyncGeneration ||
          !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
          !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId)
        ) {
          return;
        }

        reportErrorForActiveWorkspaceRoot(rootPath, "JavaScript/TypeScript", error);
      }
    },
    [
      canOpenJavaScriptTypeScriptDocument,
      currentWorkspaceRootRef,
      enqueueJavaScriptTypeScriptDocumentSync,
      isJavaScriptTypeScriptDocumentSyncableForRoot,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      isRunningLanguageServerForWorkspace,
      largeSmartDocumentPolicy,
      javaScriptTypeScriptDocumentOpenSyncAttemptIdRef,
      javaScriptTypeScriptDocumentSyncGenerationRef,
      javaScriptTypeScriptDocumentVersionsByUriRef,
      javaScriptTypeScriptDocumentVersionsRef,
      javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef,
      javaScriptTypeScriptSyncedDocumentContentRef,
      javaScriptTypeScriptSyncedDocumentPathsRef,
      issueJavaScriptTypeScriptDocumentVersion,
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

      const syncKey = rootPath ? languageServerDocumentSyncKey(rootPath, document.path) : null;

      if (!rootPath || !syncKey || !syncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      if (isLargeSmartDocument(document, largeSmartDocumentPolicy)) {
        clearDocumentChangeTimer(syncKey);
        delete pendingDocumentChangesRef.current[syncKey];
        syncedDocumentContentRef.current[syncKey] = document.content;
        return;
      }

      const currentPendingDocument = pendingDocumentChangesRef.current[syncKey];

      if (currentPendingDocument?.text === document.content) {
        return;
      }

      if (
        !currentPendingDocument &&
        syncedDocumentContentRef.current[syncKey] === document.content
      ) {
        return;
      }

      clearDocumentChangeTimer(syncKey);

      const version = nextDocumentVersion(rootPath, document.path);
      const syncedDocument = createLanguageServerTextDocument(document, version);
      pendingDocumentChangesRef.current[syncKey] = syncedDocument;
      documentChangeTimersRef.current[syncKey] = window.setTimeout(() => {
        const pendingDocument = pendingDocumentChangesRef.current[syncKey];
        delete documentChangeTimersRef.current[syncKey];

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

          const requestedLifecycleIdentity = documentLifecycleIdentitiesRef.current[syncKey];

          if (requestedLifecycleIdentity === undefined) {
            return;
          }

          try {
            await languageServerDocumentSyncGateway.didChange(
              rootPath,
              pendingDocument,
              requestedSessionId,
            );
          } catch (error) {
            if (documentLifecycleIdentitiesRef.current[syncKey] !== requestedLifecycleIdentity) {
              return;
            }

            if (
              pendingDocumentChangesRef.current[syncKey] === pendingDocument &&
              syncedDocumentPathsRef.current.has(syncKey) &&
              documentSyncGenerationRef.current === requestedSyncGeneration &&
              workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
              isLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId)
            ) {
              pendingDocumentChangesRef.current[syncKey] = {
                ...pendingDocument,
                version: nextDocumentVersion(rootPath, pendingDocument.path),
              };
            }

            throw error;
          }

          if (
            !syncedDocumentPathsRef.current.has(syncKey) ||
            documentSyncGenerationRef.current !== requestedSyncGeneration ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
            !isLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId) ||
            documentLifecycleIdentitiesRef.current[syncKey] !== requestedLifecycleIdentity
          ) {
            return;
          }

          syncedDocumentContentRef.current[syncKey] = pendingDocument.text;

          if (pendingDocumentChangesRef.current[syncKey] === pendingDocument) {
            delete pendingDocumentChangesRef.current[syncKey];
          }
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
      currentWorkspaceRootRef,
      documentChangeTimersRef,
      documentLifecycleIdentitiesRef,
      documentSyncGenerationRef,
      enqueueDocumentSync,
      isLanguageServerSessionCurrentForRoot,
      isRunningLanguageServerForWorkspace,
      largeSmartDocumentPolicy,
      languageServerDocumentSyncGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      nextDocumentVersion,
      pendingDocumentChangesRef,
      reportLanguageServerError,
      syncedDocumentContentRef,
      syncedDocumentPathsRef,
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

      const syncKey = rootPath ? languageServerDocumentSyncKey(rootPath, document.path) : null;

      if (
        !rootPath ||
        !syncKey ||
        !isJavaScriptTypeScriptDocumentSyncableForRoot(rootPath, document)
      ) {
        return;
      }

      if (isLargeSmartDocument(document, largeSmartDocumentPolicy)) {
        void retireJavaScriptTypeScriptDocument(rootPath, document.path);
        return;
      }

      if (!javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)) {
        void syncOpenJavaScriptTypeScriptDocument(document);
        return;
      }

      const currentPendingDocument = javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];

      if (currentPendingDocument?.text === document.content) {
        return;
      }

      if (
        !currentPendingDocument &&
        javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] === document.content
      ) {
        return;
      }

      clearJavaScriptTypeScriptDocumentChangeTimer(syncKey);

      const version = issueJavaScriptTypeScriptDocumentVersion(rootPath, document.path);
      const syncedDocument = createLanguageServerTextDocument(document, version);
      javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey] = syncedDocument;
      javaScriptTypeScriptDocumentChangeTimersRef.current[syncKey] = window.setTimeout(() => {
        const pendingDocument = javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];
        delete javaScriptTypeScriptDocumentChangeTimersRef.current[syncKey];

        if (!pendingDocument) {
          return;
        }

        const currentRuntimeStatus = javaScriptTypeScriptLanguageServerRuntimeStatusRef.current;

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
        const requestedSyncGeneration = javaScriptTypeScriptDocumentSyncGenerationRef.current;

        void enqueueJavaScriptTypeScriptDocumentSync(syncKey, async () => {
          // The debounce timer can fire after closeDocument ->
          // syncClosedJavaScriptTypeScriptDocument has already removed this
          // document from the synced set (and sent didClose). Single-tab close
          // does not bump the sync generation, so check synced-set membership
          // first; sending a didChange now would target a closed document
          // (UnknownDocument / desync), so drop it if no longer synced.
          if (
            !javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey) ||
            javaScriptTypeScriptDocumentSyncGenerationRef.current !== requestedSyncGeneration ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
            !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId)
          ) {
            return;
          }

          const requestedLifecycleIdentity =
            javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey];

          if (requestedLifecycleIdentity === undefined) {
            return;
          }

          try {
            await javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange(
              rootPath,
              pendingDocument,
            );
          } catch (error) {
            if (
              javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey] !==
              requestedLifecycleIdentity
            ) {
              return;
            }

            if (
              javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey] === pendingDocument &&
              javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey) &&
              javaScriptTypeScriptDocumentSyncGenerationRef.current === requestedSyncGeneration &&
              workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
              isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
                rootPath,
                requestedSessionId,
              ) &&
              javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey] ===
                requestedLifecycleIdentity
            ) {
              javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey] = {
                ...pendingDocument,
                version: issueJavaScriptTypeScriptDocumentVersion(rootPath, pendingDocument.path),
              };
            }

            throw error;
          }

          if (
            !javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey) ||
            javaScriptTypeScriptDocumentSyncGenerationRef.current !== requestedSyncGeneration ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
            !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
              rootPath,
              requestedSessionId,
            ) ||
            javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey] !==
              requestedLifecycleIdentity
          ) {
            return;
          }

          javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] = pendingDocument.text;

          if (javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey] === pendingDocument) {
            delete javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];
          }
        }).catch((error) => {
          if (
            !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId)
          ) {
            return;
          }

          reportErrorForActiveWorkspaceRoot(rootPath, "JavaScript/TypeScript", error);
        });
      }, 150);
    },
    [
      clearJavaScriptTypeScriptDocumentChangeTimer,
      currentWorkspaceRootRef,
      enqueueJavaScriptTypeScriptDocumentSync,
      isJavaScriptTypeScriptDocumentSyncableForRoot,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      isRunningLanguageServerForWorkspace,
      largeSmartDocumentPolicy,
      javaScriptTypeScriptDocumentChangeTimersRef,
      javaScriptTypeScriptDocumentSyncGenerationRef,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      javaScriptTypeScriptPendingDocumentChangesRef,
      javaScriptTypeScriptSyncedDocumentContentRef,
      javaScriptTypeScriptSyncedDocumentPathsRef,
      issueJavaScriptTypeScriptDocumentVersion,
      reportErrorForActiveWorkspaceRoot,
      retireJavaScriptTypeScriptDocument,
      syncOpenJavaScriptTypeScriptDocument,
    ],
  );

  const flushPendingDocumentChangeForRoot = useCallback(
    async (requestedRoot: string, path: string) => {
      if (!workspaceRootKeysEqual(requestedRoot, currentWorkspaceRootRef.current)) {
        return;
      }

      const rootPath = requestedRoot;
      const syncKey = languageServerDocumentSyncKey(rootPath, path);

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

      await enqueueDocumentSync(syncKey, async () => {
        if (!isRequestedSyncCurrent()) {
          return;
        }

        const pendingDocumentToSend = pendingDocumentChangesRef.current[syncKey];

        if (!pendingDocumentToSend) {
          return;
        }

        const requestedLifecycleIdentity = documentLifecycleIdentitiesRef.current[syncKey];

        if (requestedLifecycleIdentity === undefined) {
          return;
        }

        try {
          await languageServerDocumentSyncGateway.didChange(
            rootPath,
            pendingDocumentToSend,
            requestedSessionId,
          );
        } catch (error) {
          if (documentLifecycleIdentitiesRef.current[syncKey] !== requestedLifecycleIdentity) {
            return;
          }

          if (
            pendingDocumentChangesRef.current[syncKey] === pendingDocumentToSend &&
            isRequestedSyncCurrent()
          ) {
            pendingDocumentChangesRef.current[syncKey] = {
              ...pendingDocumentToSend,
              version: nextDocumentVersion(rootPath, pendingDocumentToSend.path),
            };
          }

          throw error;
        }

        if (
          !isRequestedSyncCurrent() ||
          documentLifecycleIdentitiesRef.current[syncKey] !== requestedLifecycleIdentity
        ) {
          return;
        }

        syncedDocumentContentRef.current[syncKey] = pendingDocumentToSend.text;

        if (pendingDocumentChangesRef.current[syncKey] === pendingDocumentToSend) {
          delete pendingDocumentChangesRef.current[syncKey];
        }
      });
    },
    [
      activeDocumentRef,
      clearDocumentChangeTimer,
      currentWorkspaceRootRef,
      documentLifecycleIdentitiesRef,
      documentSyncGenerationRef,
      documentSyncQueuesRef,
      documentsRef,
      enqueueDocumentSync,
      isLanguageServerSessionCurrentForRoot,
      isRunningLanguageServerForWorkspace,
      languageServerDocumentSyncGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      nextDocumentVersion,
      pendingDocumentChangesRef,
      syncedDocumentContentRef,
      syncedDocumentPathsRef,
      syncOpenDocument,
    ],
  );

  const flushPendingDocumentChange = useCallback(
    (path: string) => {
      const requestedRoot = currentWorkspaceRootRef.current;

      if (!requestedRoot) {
        return Promise.resolve();
      }

      return flushPendingDocumentChangeForRoot(requestedRoot, path);
    },
    [currentWorkspaceRootRef, flushPendingDocumentChangeForRoot],
  );

  const isLanguageServerDocumentRequestLeaseCurrent = useCallback(
    (lease: LanguageServerDocumentRequestLease): boolean => {
      const syncKey = languageServerDocumentSyncKey(lease.rootPath, lease.path);

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, lease.rootPath)) {
        return false;
      }

      if (documentSyncGenerationRef.current !== lease.syncGeneration) {
        return false;
      }

      if (!isLanguageServerSessionCurrentForRoot(lease.rootPath, lease.sessionId)) {
        return false;
      }

      if (!syncedDocumentPathsRef.current.has(syncKey)) {
        return false;
      }

      if (pendingDocumentOpenSyncAttemptsRef.current[syncKey] !== undefined) {
        return false;
      }

      return documentLifecycleIdentitiesRef.current[syncKey] === lease.lifecycleIdentity;
    },
    [
      currentWorkspaceRootRef,
      documentLifecycleIdentitiesRef,
      documentSyncGenerationRef,
      isLanguageServerSessionCurrentForRoot,
      pendingDocumentOpenSyncAttemptsRef,
      syncedDocumentPathsRef,
    ],
  );

  const requestLanguageServerDocumentLease = useCallback(
    async (rootPath: string, path: string): Promise<LanguageServerDocumentRequestLease | null> => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return null;
      }

      if (
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return null;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, path);
      const requestedSessionId = languageServerRuntimeStatus.sessionId;
      const requestedSyncGeneration = documentSyncGenerationRef.current;
      const flushPromise = flushPendingDocumentChangeForRoot(rootPath, path);
      const requestedLifecycleIdentity =
        documentLifecycleIdentitiesRef.current[syncKey] ??
        pendingDocumentLifecycleIdentitiesRef.current[syncKey];

      if (requestedLifecycleIdentity === undefined) {
        await flushPromise;
        return null;
      }

      await flushPromise;

      const lease: LanguageServerDocumentRequestLease = {
        lifecycleIdentity: requestedLifecycleIdentity,
        path,
        rootPath,
        sessionId: requestedSessionId,
        syncGeneration: requestedSyncGeneration,
      };

      if (!isLanguageServerDocumentRequestLeaseCurrent(lease)) {
        return null;
      }

      return lease;
    },
    [
      currentWorkspaceRootRef,
      documentLifecycleIdentitiesRef,
      documentSyncGenerationRef,
      flushPendingDocumentChangeForRoot,
      isLanguageServerDocumentRequestLeaseCurrent,
      isRunningLanguageServerForWorkspace,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      pendingDocumentLifecycleIdentitiesRef,
    ],
  );

  // BUG 2 gate: reports whether a PHP document has already been opened
  // (`didOpen` sent) on the active workspace's language server. Outline /
  // breadcrumb DocumentSymbol fetches consult this so they never race ahead of
  // the document sync and trigger an UnknownDocument error. Isolated per
  // workspace via the active-root sync key.
  const isLanguageServerDocumentSynced = useCallback(
    (path: string): boolean => {
      const rootPath = currentWorkspaceRootRef.current;

      if (!rootPath) {
        return false;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, path);

      return (
        syncedDocumentPathsRef.current.has(syncKey) &&
        pendingDocumentOpenSyncAttemptsRef.current[syncKey] === undefined &&
        documentLifecycleIdentitiesRef.current[syncKey] !== undefined
      );
    },
    [
      currentWorkspaceRootRef,
      documentLifecycleIdentitiesRef,
      pendingDocumentOpenSyncAttemptsRef,
      syncedDocumentPathsRef,
    ],
  );

  const flushPendingJavaScriptTypeScriptDocumentChangeForRoot = useCallback(
    async (requestedRoot: string, path: string) => {
      if (!workspaceRootKeysEqual(requestedRoot, currentWorkspaceRootRef.current)) {
        return;
      }

      const rootPath = requestedRoot;
      const syncKey = languageServerDocumentSyncKey(rootPath, path);

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

      const requestedSessionId = javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const requestedSyncGeneration = javaScriptTypeScriptDocumentSyncGenerationRef.current;
      const isRequestedSessionCurrent = () =>
        javaScriptTypeScriptDocumentSyncGenerationRef.current === requestedSyncGeneration &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId);
      const currentDocument =
        activeDocumentRef.current?.path === path
          ? activeDocumentRef.current
          : documentsRef.current[path];

      if (
        currentDocument &&
        isJavaScriptTypeScriptDocumentSyncableForRoot(rootPath, currentDocument) &&
        isLargeSmartDocument(currentDocument, largeSmartDocumentPolicy)
      ) {
        await retireJavaScriptTypeScriptDocument(rootPath, path);
        return;
      }

      if (!javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)) {
        if (
          currentDocument &&
          isJavaScriptTypeScriptDocumentSyncableForRoot(rootPath, currentDocument)
        ) {
          await syncOpenJavaScriptTypeScriptDocument(currentDocument);
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

      let pendingDocument = javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];

      if (!pendingDocument) {
        await javaScriptTypeScriptDocumentSyncQueuesRef.current[syncKey];
        if (!isRequestedSessionCurrent()) {
          return;
        }
        pendingDocument = javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];

        if (!pendingDocument) {
          return;
        }
      }

      if (!isRequestedSessionCurrent()) {
        return;
      }

      clearJavaScriptTypeScriptDocumentChangeTimer(syncKey);

      try {
        await enqueueJavaScriptTypeScriptDocumentSync(syncKey, async () => {
          if (!isRequestedSessionCurrent()) {
            return;
          }

          const pendingDocumentToSend =
            javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];

          if (!pendingDocumentToSend) {
            return;
          }

          const requestedLifecycleIdentity =
            javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey];

          if (requestedLifecycleIdentity === undefined) {
            return;
          }

          try {
            await javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange(
              rootPath,
              pendingDocumentToSend,
            );
          } catch (error) {
            if (
              javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey] !==
              requestedLifecycleIdentity
            ) {
              return;
            }

            if (
              javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey] ===
                pendingDocumentToSend &&
              isRequestedSessionCurrent()
            ) {
              javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey] = {
                ...pendingDocumentToSend,
                version: issueJavaScriptTypeScriptDocumentVersion(
                  rootPath,
                  pendingDocumentToSend.path,
                ),
              };
            }

            throw error;
          }

          if (
            !isRequestedSessionCurrent() ||
            javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey] !==
              requestedLifecycleIdentity
          ) {
            return;
          }

          javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] =
            pendingDocumentToSend.text;

          if (
            javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey] === pendingDocumentToSend
          ) {
            delete javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];
          }
        });
      } catch (error) {
        if (isRequestedSessionCurrent()) {
          throw error;
        }
      }
    },
    [
      activeDocumentRef,
      clearJavaScriptTypeScriptDocumentChangeTimer,
      currentWorkspaceRootRef,
      documentsRef,
      enqueueJavaScriptTypeScriptDocumentSync,
      isJavaScriptTypeScriptDocumentSyncableForRoot,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      isRunningLanguageServerForWorkspace,
      isSessionPathInWorkspace,
      largeSmartDocumentPolicy,
      javaScriptTypeScriptDocumentSyncGenerationRef,
      javaScriptTypeScriptDocumentSyncQueuesRef,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      javaScriptTypeScriptPendingDocumentChangesRef,
      javaScriptTypeScriptSyncedDocumentContentRef,
      javaScriptTypeScriptSyncedDocumentPathsRef,
      issueJavaScriptTypeScriptDocumentVersion,
      retireJavaScriptTypeScriptDocument,
      syncOpenJavaScriptTypeScriptDocument,
    ],
  );

  const flushPendingJavaScriptTypeScriptDocumentChange = useCallback(
    (path: string) => {
      const requestedRoot = currentWorkspaceRootRef.current;

      if (!requestedRoot) {
        return Promise.resolve();
      }

      return flushPendingJavaScriptTypeScriptDocumentChangeForRoot(requestedRoot, path);
    },
    [currentWorkspaceRootRef, flushPendingJavaScriptTypeScriptDocumentChangeForRoot],
  );

  const syncSavedDocument = useCallback(
    async (
      requestedRoot: string,
      document: EditorDocument,
      shouldEmit: () => boolean = () => true,
    ) => {
      if (!workspaceRootKeysEqual(requestedRoot, currentWorkspaceRootRef.current)) {
        return;
      }

      const rootPath = requestedRoot;
      const syncKey = languageServerDocumentSyncKey(rootPath, document.path);

      if (!syncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      if (!isLanguageServerDocument(document)) {
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
      const requestedLifecycleIdentity =
        documentLifecycleIdentitiesRef.current[syncKey] ??
        pendingDocumentLifecycleIdentitiesRef.current[syncKey];

      if (requestedLifecycleIdentity === undefined) {
        return;
      }

      const isRequestedSyncCurrent = () =>
        documentSyncGenerationRef.current === requestedSyncGeneration &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        isLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId) &&
        syncedDocumentPathsRef.current.has(syncKey) &&
        pendingDocumentOpenSyncAttemptsRef.current[syncKey] === undefined &&
        documentLifecycleIdentitiesRef.current[syncKey] === requestedLifecycleIdentity &&
        shouldEmit();
      const isSavedContentCurrent = () =>
        isRequestedSyncCurrent() && syncedDocumentContentRef.current[syncKey] === document.content;

      try {
        await flushPendingDocumentChangeForRoot(rootPath, document.path);

        if (!isRequestedSyncCurrent()) {
          return;
        }

        await enqueueDocumentSync(syncKey, async () => {
          if (!isRequestedSyncCurrent()) {
            return;
          }

          if (syncedDocumentContentRef.current[syncKey] !== document.content) {
            const previousSyncedContent = syncedDocumentContentRef.current[syncKey];
            const version = nextDocumentVersion(rootPath, document.path);
            const syncedDocument = createLanguageServerTextDocument(document, version);

            try {
              await languageServerDocumentSyncGateway.didChange(
                rootPath,
                syncedDocument,
                requestedSessionId,
              );
            } catch (error) {
              if (
                isRequestedSyncCurrent() &&
                documentVersionsRef.current[syncKey] === version &&
                pendingDocumentChangesRef.current[syncKey] === undefined
              ) {
                pendingDocumentChangesRef.current[syncKey] = {
                  ...syncedDocument,
                  version: nextDocumentVersion(rootPath, document.path),
                };
              }

              throw error;
            }

            if (!isRequestedSyncCurrent()) {
              return;
            }

            if (documentVersionsRef.current[syncKey] !== version) {
              return;
            }

            if (syncedDocumentContentRef.current[syncKey] !== previousSyncedContent) {
              return;
            }

            syncedDocumentContentRef.current[syncKey] = document.content;
          }

          if (!isSavedContentCurrent()) {
            return;
          }

          await languageServerDocumentSyncGateway.didSave(
            rootPath,
            createLanguageServerTextDocument(document, documentVersionsRef.current[syncKey] || 0),
            requestedSessionId,
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
      currentWorkspaceRootRef,
      documentLifecycleIdentitiesRef,
      documentSyncGenerationRef,
      documentVersionsRef,
      enqueueDocumentSync,
      flushPendingDocumentChangeForRoot,
      isLanguageServerSessionCurrentForRoot,
      isRunningLanguageServerForWorkspace,
      languageServerDocumentSyncGateway,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      nextDocumentVersion,
      pendingDocumentChangesRef,
      pendingDocumentLifecycleIdentitiesRef,
      pendingDocumentOpenSyncAttemptsRef,
      reportLanguageServerErrorForActiveWorkspaceRoot,
      syncedDocumentContentRef,
      syncedDocumentPathsRef,
    ],
  );

  const syncSavedJavaScriptTypeScriptDocument = useCallback(
    async (
      requestedRoot: string,
      document: EditorDocument,
      shouldEmit: () => boolean = () => true,
    ) => {
      if (!workspaceRootKeysEqual(requestedRoot, currentWorkspaceRootRef.current)) {
        return;
      }

      const rootPath = requestedRoot;
      const syncKey = languageServerDocumentSyncKey(rootPath, document.path);

      if (!javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      if (!isJavaScriptTypeScriptDocumentSyncableForRoot(rootPath, document)) {
        return;
      }

      if (isLargeSmartDocument(document, largeSmartDocumentPolicy)) {
        await retireJavaScriptTypeScriptDocument(rootPath, document.path);
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

      const requestedSessionId = javaScriptTypeScriptLanguageServerRuntimeStatus.sessionId;
      const requestedSyncGeneration = javaScriptTypeScriptDocumentSyncGenerationRef.current;
      const requestedLifecycleIdentity =
        javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey];

      if (requestedLifecycleIdentity === undefined) {
        return;
      }

      const isRequestedSessionCurrent = () =>
        javaScriptTypeScriptDocumentSyncGenerationRef.current === requestedSyncGeneration &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId) &&
        javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey) &&
        javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[syncKey] === undefined &&
        javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey] ===
          requestedLifecycleIdentity &&
        shouldEmit();
      const isSavedContentCurrent = () =>
        isRequestedSessionCurrent() &&
        javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] === document.content;

      try {
        await flushPendingJavaScriptTypeScriptDocumentChangeForRoot(rootPath, document.path);

        if (!isRequestedSessionCurrent()) {
          return;
        }

        await enqueueJavaScriptTypeScriptDocumentSync(syncKey, async () => {
          if (!isRequestedSessionCurrent()) {
            return;
          }

          if (javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] !== document.content) {
            const previousSyncedContent =
              javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey];
            const version = issueJavaScriptTypeScriptDocumentVersion(rootPath, document.path);
            const syncedDocument = createLanguageServerTextDocument(document, version);

            try {
              await javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange(
                rootPath,
                syncedDocument,
              );
            } catch (error) {
              if (
                isRequestedSessionCurrent() &&
                javaScriptTypeScriptDocumentVersionsRef.current[syncKey] === version &&
                javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey] === undefined
              ) {
                javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey] = {
                  ...syncedDocument,
                  version: issueJavaScriptTypeScriptDocumentVersion(rootPath, document.path),
                };
              }

              throw error;
            }

            if (!isRequestedSessionCurrent()) {
              return;
            }

            if (javaScriptTypeScriptDocumentVersionsRef.current[syncKey] !== version) {
              return;
            }

            if (
              javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] !==
              previousSyncedContent
            ) {
              return;
            }

            javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] = document.content;
          }

          if (!isSavedContentCurrent()) {
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

        reportErrorForActiveWorkspaceRoot(rootPath, "JavaScript/TypeScript", error);
      }
    },
    [
      currentWorkspaceRootRef,
      enqueueJavaScriptTypeScriptDocumentSync,
      flushPendingJavaScriptTypeScriptDocumentChangeForRoot,
      isJavaScriptTypeScriptDocumentSyncableForRoot,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      isRunningLanguageServerForWorkspace,
      largeSmartDocumentPolicy,
      javaScriptTypeScriptDocumentSyncGenerationRef,
      javaScriptTypeScriptDocumentVersionsRef,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      javaScriptTypeScriptPendingDocumentChangesRef,
      javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef,
      javaScriptTypeScriptSyncedDocumentContentRef,
      javaScriptTypeScriptSyncedDocumentPathsRef,
      issueJavaScriptTypeScriptDocumentVersion,
      reportErrorForActiveWorkspaceRoot,
      retireJavaScriptTypeScriptDocument,
    ],
  );

  const syncClosedDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;
      const syncKey = rootPath ? languageServerDocumentSyncKey(rootPath, document.path) : null;

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
      delete documentLifecycleIdentitiesRef.current[syncKey];
      delete pendingDocumentLifecycleIdentitiesRef.current[syncKey];
      delete syncedDocumentContentRef.current[syncKey];
      delete pendingDocumentChangesRef.current[syncKey];
      delete pendingDocumentOpenSyncAttemptsRef.current[syncKey];
      clearDocumentSyncVersionState(
        {
          diagnosticVersionsByUriRef: lastAppliedDiagnosticVersionByUriRef,
          documentVersionsByUriRef,
          documentVersionsRef,
        },
        rootPath,
        document.path,
        syncKey,
      );

      try {
        await enqueueDocumentSync(syncKey, () => {
          if (requestedSessionId === null) {
            return Promise.resolve();
          }

          return languageServerDocumentSyncGateway.didClose(
            rootPath,
            document.path,
            requestedSessionId,
          );
        });
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
      currentWorkspaceRootRef,
      documentLifecycleIdentitiesRef,
      documentVersionsByUriRef,
      documentVersionsRef,
      enqueueDocumentSync,
      isLanguageServerSessionCurrentForRoot,
      isRunningLanguageServerForWorkspace,
      languageServerDocumentSyncGateway,
      languageServerRuntimeStatusRef,
      languageServerRuntimeStatusRootRef,
      lastAppliedDiagnosticVersionByUriRef,
      pendingDocumentChangesRef,
      pendingDocumentLifecycleIdentitiesRef,
      pendingDocumentOpenSyncAttemptsRef,
      reportLanguageServerErrorForActiveWorkspaceRoot,
      syncedDocumentContentRef,
      syncedDocumentPathsRef,
    ],
  );

  const syncClosedJavaScriptTypeScriptDocument = useCallback(
    (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (!rootPath) {
        return Promise.resolve();
      }

      return retireJavaScriptTypeScriptDocument(rootPath, document.path);
    },
    [currentWorkspaceRootRef, retireJavaScriptTypeScriptDocument],
  );

  const closeSyncedLanguageServerDocumentsForRoot = useCallback(
    (rootPath: string) =>
      closePhpDocumentsForRoot({
        rootPath,
        syncGenerationRef: documentSyncGenerationRef,
        state: {
          syncedPathsRef: syncedDocumentPathsRef,
          syncedContentRef: syncedDocumentContentRef,
          pendingChangesRef: pendingDocumentChangesRef,
          pendingOpenAttemptsRef: pendingDocumentOpenSyncAttemptsRef,
          lifecycleIdentitiesRef: documentLifecycleIdentitiesRef,
          pendingLifecycleIdentitiesRef: pendingDocumentLifecycleIdentitiesRef,
          versionState: {
            diagnosticVersionsByUriRef: lastAppliedDiagnosticVersionByUriRef,
            documentVersionsByUriRef,
            documentVersionsRef,
          },
        },
        runtimeAuthority: {
          statusRef: languageServerRuntimeStatusRef,
          statusRootRef: languageServerRuntimeStatusRootRef,
          statusByRootRef: languageServerRuntimeStatusByRootRef,
          isRunningForWorkspace: isRunningLanguageServerForWorkspace,
        },
        clearChangeTimer: clearDocumentChangeTimer,
        enqueueSync: enqueueDocumentSync,
        gateway: languageServerDocumentSyncGateway,
        isSessionCurrent: isLanguageServerSessionCurrentForRoot,
        reportError: reportLanguageServerErrorForActiveWorkspaceRoot,
        resetDocuments: resetLanguageServerDocuments,
      }),
    [
      clearDocumentChangeTimer,
      documentLifecycleIdentitiesRef,
      documentSyncGenerationRef,
      documentVersionsByUriRef,
      documentVersionsRef,
      enqueueDocumentSync,
      isLanguageServerSessionCurrentForRoot,
      isRunningLanguageServerForWorkspace,
      languageServerDocumentSyncGateway,
      languageServerRuntimeStatusByRootRef,
      languageServerRuntimeStatusRef,
      languageServerRuntimeStatusRootRef,
      lastAppliedDiagnosticVersionByUriRef,
      pendingDocumentChangesRef,
      pendingDocumentLifecycleIdentitiesRef,
      pendingDocumentOpenSyncAttemptsRef,
      reportLanguageServerErrorForActiveWorkspaceRoot,
      resetLanguageServerDocuments,
      syncedDocumentContentRef,
      syncedDocumentPathsRef,
    ],
  );

  const closeSyncedJavaScriptTypeScriptDocumentsForRoot = useCallback(
    (rootPath: string) =>
      closeJavaScriptTypeScriptDocumentsForRoot({
        rootPath,
        syncGenerationRef: javaScriptTypeScriptDocumentSyncGenerationRef,
        state: {
          syncedPathsRef: javaScriptTypeScriptSyncedDocumentPathsRef,
          syncedContentRef: javaScriptTypeScriptSyncedDocumentContentRef,
          pendingChangesRef: javaScriptTypeScriptPendingDocumentChangesRef,
          pendingOpenAttemptsRef: javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef,
          lifecycleIdentitiesRef: javaScriptTypeScriptDocumentLifecycleIdentitiesRef,
          authorityVersionsRef: javaScriptTypeScriptDocumentAuthorityVersionsRef,
          versionState: {
            diagnosticVersionsByUriRef: javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
            documentVersionsByUriRef: javaScriptTypeScriptDocumentVersionsByUriRef,
            documentVersionsRef: javaScriptTypeScriptDocumentVersionsRef,
          },
        },
        runtimeAuthority: {
          statusRef: javaScriptTypeScriptLanguageServerRuntimeStatusRef,
          statusRootRef: javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
          statusByRootRef: javaScriptTypeScriptRuntimeStatusByRootRef,
          isRunningForWorkspace: isRunningLanguageServerForWorkspace,
        },
        isPathInWorkspace: isSessionPathInWorkspace,
        clearChangeTimer: clearJavaScriptTypeScriptDocumentChangeTimer,
        enqueueSync: enqueueJavaScriptTypeScriptDocumentSync,
        gateway: javaScriptTypeScriptLanguageServerDocumentSyncGateway,
        isSessionCurrent: isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
        reportError: (requestedRoot, error) =>
          reportErrorForActiveWorkspaceRoot(requestedRoot, "JavaScript/TypeScript", error),
      }),
    [
      clearJavaScriptTypeScriptDocumentChangeTimer,
      enqueueJavaScriptTypeScriptDocumentSync,
      isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      isRunningLanguageServerForWorkspace,
      isSessionPathInWorkspace,
      javaScriptTypeScriptDocumentSyncGenerationRef,
      javaScriptTypeScriptDocumentVersionsByUriRef,
      javaScriptTypeScriptDocumentVersionsRef,
      javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
      javaScriptTypeScriptPendingDocumentChangesRef,
      javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      javaScriptTypeScriptSyncedDocumentContentRef,
      javaScriptTypeScriptSyncedDocumentPathsRef,
      reportErrorForActiveWorkspaceRoot,
    ],
  );

  return {
    syncOpenDocument,
    syncOpenJavaScriptTypeScriptDocument,
    scheduleDocumentChange,
    scheduleJavaScriptTypeScriptDocumentChange,
    flushPendingDocumentChange,
    flushPendingDocumentChangeForRoot,
    flushPendingJavaScriptTypeScriptDocumentChange,
    flushPendingJavaScriptTypeScriptDocumentChangeForRoot,
    isLanguageServerDocumentSynced,
    getLanguageServerDocumentLifecycleIdentity,
    getJavaScriptTypeScriptDocumentSyncVersion,
    requestLanguageServerDocumentLease,
    isLanguageServerDocumentRequestLeaseCurrent,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    closeSyncedLanguageServerDocumentsForRoot,
    closeSyncedJavaScriptTypeScriptDocumentsForRoot,
  };
}
