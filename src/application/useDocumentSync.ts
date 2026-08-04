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
import type { DocumentSync, DocumentSyncDependencies } from "./documentSyncContracts";
import { clearDocumentSyncVersionState } from "./documentSyncVersionBookkeeping";
import {
  DocumentSyncLargePolicyMemo,
  evaluateDocumentSyncOpenAdmission,
} from "./documentSyncLargePolicyMemo";
import { useJavaScriptTypeScriptDocumentRetirement } from "./useJavaScriptTypeScriptDocumentRetirement";
import { useJavaScriptTypeScriptDocumentSyncVersion } from "./useJavaScriptTypeScriptDocumentSyncVersion";
import { useJavaScriptTypeScriptDocumentSaveSync } from "./incrementalDocumentSavePreparation";
import { syncLegacyFullTextDocumentSave } from "./legacyFullTextDocumentSave";
import { useJavaScriptTypeScriptLegacyHandoff } from "./useJavaScriptTypeScriptLegacyHandoff";
import { useJavaScriptTypeScriptDocumentCloseSync } from "./useJavaScriptTypeScriptDocumentCloseSync";
import { useJavaScriptTypeScriptDocumentVersionIssuer } from "./useJavaScriptTypeScriptDocumentVersionIssuer";
import { useLanguageServerDocumentLifecycleIdentity } from "./useLanguageServerDocumentLifecycleIdentity";
import { useDocumentSyncRootCleanup } from "./documentSync/useDocumentSyncRootCleanup";
import { usePhpDocumentRequestLeases } from "./documentSync/usePhpDocumentRequestLeases";
import { isJavaScriptTypeScriptDocumentSyncBlockedBySize } from "./javaScriptTypeScriptDocumentSyncAdmission";

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
    javaScriptTypeScriptDocumentChangeMailbox,
    javaScriptTypeScriptDocumentSyncQueuesRef,
    javaScriptTypeScriptDocumentSyncGenerationRef,
    javaScriptTypeScriptDocumentVersionsRef,
    javaScriptTypeScriptDocumentVersionsByUriRef,
    javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    javaScriptTypeScriptIncrementalSyncRef,
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
  const javaScriptTypeScriptLargePolicyMemoRef = useRef(new DocumentSyncLargePolicyMemo());
  const issueJavaScriptTypeScriptDocumentVersion = useJavaScriptTypeScriptDocumentVersionIssuer(
    nextJavaScriptTypeScriptDocumentVersion,
    javaScriptTypeScriptDocumentAuthorityVersionsRef,
    nextJavaScriptTypeScriptDocumentAuthorityVersionRef,
  );
  const getLanguageServerDocumentLifecycleIdentity = useLanguageServerDocumentLifecycleIdentity(
    documentLifecycleIdentitiesRef,
    syncedDocumentPathsRef,
  );
  const getJavaScriptTypeScriptDocumentSyncVersion = useJavaScriptTypeScriptDocumentSyncVersion({
    activeDocumentRef,
    authorityVersionsRef: javaScriptTypeScriptDocumentAuthorityVersionsRef,
    currentWorkspaceRootRef,
    documentsRef,
    lifecycleIdentitiesRef: javaScriptTypeScriptDocumentLifecycleIdentitiesRef,
    incrementalSyncRef: javaScriptTypeScriptIncrementalSyncRef,
    pendingChangesRef: javaScriptTypeScriptPendingDocumentChangesRef,
    pendingOpenAttemptsRef: javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef,
    syncedContentRef: javaScriptTypeScriptSyncedDocumentContentRef,
    syncedPathsRef: javaScriptTypeScriptSyncedDocumentPathsRef,
  });
  const {
    canOpen: canOpenJavaScriptTypeScriptDocument,
    retire: retireJavaScriptTypeScriptDocument,
    retireMalformed: retireMalformedJavaScriptTypeScriptDocument,
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
    reportError: reportErrorForActiveWorkspaceRoot,
    changeMailbox: javaScriptTypeScriptDocumentChangeMailbox,
  });

  const syncOpenDocument = useCallback(
    async (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (
        !rootPath ||
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          rootPath,
        ) ||
        !isLanguageServerDocument(document)
      ) {
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
      const documentPath = document.path;
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
          documentPath,
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
          warmUpPhpLanguageServerIndex(rootPath, documentPath, requestedSessionId);
        }, [syncedDocument.text]);
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
    async (document: EditorDocument, isCurrent: () => boolean = () => true) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (
        !isCurrent() ||
        !rootPath ||
        !isRunningLanguageServerForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
          rootPath,
        ) ||
        !isJavaScriptTypeScriptDocumentSyncableForRoot(rootPath, document) ||
        javaScriptTypeScriptIncrementalSyncRef?.current?.ownsLifecycle(document.path)
      ) {
        return;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, document.path);
      const admission = evaluateDocumentSyncOpenAdmission({
        document,
        memo: javaScriptTypeScriptLargePolicyMemoRef.current,
        policy: largeSmartDocumentPolicy,
        syncKey,
        syncedContent: javaScriptTypeScriptSyncedDocumentContentRef.current,
        syncedPaths: javaScriptTypeScriptSyncedDocumentPathsRef.current,
      });
      if (admission.kind === "unchanged") {
        return;
      }

      if (admission.kind === "large") {
        if (admission.wasAlreadySynced) {
          javaScriptTypeScriptDocumentChangeMailbox.drop(syncKey);
          await retireJavaScriptTypeScriptDocument(rootPath, document.path);
          javaScriptTypeScriptLargePolicyMemoRef.current.delete(syncKey);
        }
        return;
      }

      if (!canOpenJavaScriptTypeScriptDocument(rootPath, document.path)) {
        return;
      }

      if (admission.wasAlreadySynced) {
        return;
      }

      const version = issueJavaScriptTypeScriptDocumentVersion(rootPath, document.path);
      const syncedDocument = createLanguageServerTextDocument(document, version);
      const documentPath = document.path;
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
          documentPath,
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
            !isCurrent() ||
            !canOpenJavaScriptTypeScriptDocument(rootPath, documentPath)
          ) {
            clearPendingOpenSyncState();
            return;
          }

          await javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen(
            rootPath,
            syncedDocument,
            requestedSessionId,
          );

          if (
            javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef.current[syncKey] !==
              openSyncAttemptId ||
            javaScriptTypeScriptDocumentSyncGenerationRef.current !== requestedSyncGeneration ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
            !isCurrent() ||
            !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId)
          ) {
            clearPendingOpenSyncState();
            return;
          }

          clearPendingOpenSyncAttempt();
        }, [syncedDocument.text]);
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
      javaScriptTypeScriptDocumentChangeMailbox,
      javaScriptTypeScriptDocumentOpenSyncAttemptIdRef,
      javaScriptTypeScriptDocumentSyncGenerationRef,
      javaScriptTypeScriptIncrementalSyncRef,
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
      retireJavaScriptTypeScriptDocument,
    ],
  );

  const scheduleDocumentChange = useCallback(
    (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;

      if (
        !rootPath ||
        !isRunningLanguageServerForWorkspace(
          languageServerRuntimeStatus,
          languageServerRuntimeStatusRoot,
          rootPath,
        )
      ) {
        return;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, document.path);

      if (!syncedDocumentPathsRef.current.has(syncKey)) {
        return;
      }

      if (isLargeSmartDocument(document, largeSmartDocumentPolicy)) {
        clearDocumentChangeTimer(syncKey);
        delete pendingDocumentChangesRef.current[syncKey];
        syncedDocumentContentRef.current[syncKey] = document.content;
        return;
      }

      const currentPendingDocument = pendingDocumentChangesRef.current[syncKey];

      if (
        currentPendingDocument?.text === document.content ||
        (!currentPendingDocument && syncedDocumentContentRef.current[syncKey] === document.content)
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
        }, [pendingDocument.text]).catch((error) => {
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

      const syncKey = languageServerDocumentSyncKey(rootPath, document.path);

      if (!isJavaScriptTypeScriptDocumentSyncableForRoot(rootPath, document)) {
        return;
      }

      if (javaScriptTypeScriptIncrementalSyncRef?.current?.ownsLifecycle(document.path)) {
        return;
      }

      if (isJavaScriptTypeScriptDocumentSyncBlockedBySize(document)) {
        javaScriptTypeScriptDocumentChangeMailbox.drop(syncKey);
        void retireJavaScriptTypeScriptDocument(rootPath, document.path);
        return;
      }

      if (!javaScriptTypeScriptSyncedDocumentPathsRef.current.has(syncKey)) {
        void syncOpenJavaScriptTypeScriptDocument(document);
        return;
      }

      const currentPendingDocument = javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];

      if (
        currentPendingDocument?.text === document.content ||
        (!currentPendingDocument &&
          javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] === document.content)
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

        const drainOffer = javaScriptTypeScriptDocumentChangeMailbox.offer(
          syncKey,
          pendingDocument,
          enqueueJavaScriptTypeScriptDocumentSync,
          async (documentToSend, drainLease) => {
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
              !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
                rootPath,
                requestedSessionId,
              )
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
                documentToSend,
                requestedSessionId,
              );
            } catch (error) {
              if (!drainLease.isCurrent()) {
                return;
              }

              if (
                javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey] !==
                requestedLifecycleIdentity
              ) {
                return;
              }

              if (
                retireMalformedJavaScriptTypeScriptDocument(
                  rootPath,
                  documentToSend.path,
                  syncKey,
                  documentToSend.text,
                  error,
                  () =>
                    drainLease.isCurrent() &&
                    javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey] ===
                      requestedLifecycleIdentity &&
                    (javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey]?.text ??
                      javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey]) ===
                      documentToSend.text,
                ) !== "not-malformed"
              ) {
                return;
              }

              if (
                javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey] === documentToSend &&
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
                  ...documentToSend,
                  version: issueJavaScriptTypeScriptDocumentVersion(rootPath, documentToSend.path),
                };
              }

              throw error;
            }

            if (
              !drainLease.isCurrent() ||
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

            javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey] = documentToSend.text;

            if (javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey] === documentToSend) {
              delete javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey];
            }
          },
          [pendingDocument.text],
        );
        if (!drainOffer.started) {
          if (drainOffer.failedToStart) {
            void drainOffer.settlement.catch((error) => {
              if (
                javaScriptTypeScriptDocumentSyncGenerationRef.current !== requestedSyncGeneration ||
                !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
                !isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot(
                  rootPath,
                  requestedSessionId,
                )
              ) {
                return;
              }
              reportErrorForActiveWorkspaceRoot(rootPath, "JavaScript/TypeScript", error);
            });
          }
          return;
        }

        void drainOffer.settlement.catch((error) => {
          if (
            javaScriptTypeScriptDocumentSyncGenerationRef.current !== requestedSyncGeneration ||
            !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
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
      javaScriptTypeScriptDocumentChangeMailbox,
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
      }, [pendingDocument.text]);
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

  const {
    isDocumentSynced: isLanguageServerDocumentSynced,
    isRequestLeaseCurrent: isLanguageServerDocumentRequestLeaseCurrent,
    requestLease: requestLanguageServerDocumentLease,
  } = usePhpDocumentRequestLeases({
    currentWorkspaceRootRef,
    documentLifecycleIdentitiesRef,
    documentSyncGenerationRef,
    flushPendingDocumentChangeForRoot,
    isLanguageServerSessionCurrentForRoot,
    isRunningLanguageServerForWorkspace,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    pendingDocumentLifecycleIdentitiesRef,
    pendingDocumentOpenSyncAttemptsRef,
    syncedDocumentPathsRef,
  });

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
        isJavaScriptTypeScriptDocumentSyncBlockedBySize(currentDocument)
      ) {
        javaScriptTypeScriptDocumentChangeMailbox.drop(syncKey);
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
              requestedSessionId,
            );
          } catch (error) {
            if (
              javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey] !==
              requestedLifecycleIdentity
            ) {
              return;
            }

            if (
              isRequestedSessionCurrent() &&
              retireMalformedJavaScriptTypeScriptDocument(
                rootPath,
                pendingDocumentToSend.path,
                syncKey,
                pendingDocumentToSend.text,
                error,
                () =>
                  isRequestedSessionCurrent() &&
                  javaScriptTypeScriptDocumentLifecycleIdentitiesRef.current[syncKey] ===
                    requestedLifecycleIdentity &&
                  (javaScriptTypeScriptPendingDocumentChangesRef.current[syncKey]?.text ??
                    javaScriptTypeScriptSyncedDocumentContentRef.current[syncKey]) ===
                    pendingDocumentToSend.text,
              ) !== "not-malformed"
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
        }, [pendingDocument.text]);
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
      javaScriptTypeScriptDocumentChangeMailbox,
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

      if (!syncedDocumentPathsRef.current.has(syncKey) || !isLanguageServerDocument(document)) {
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
      await syncLegacyFullTextDocumentSave({
        document,
        enqueue: (operation, retainedPayloads) =>
          enqueueDocumentSync(syncKey, operation, retainedPayloads),
        flush: () => flushPendingDocumentChangeForRoot(rootPath, document.path),
        gateway: languageServerDocumentSyncGateway,
        isCurrent: isRequestedSyncCurrent,
        issueVersion: () => nextDocumentVersion(rootPath, document.path),
        pendingChangesRef: pendingDocumentChangesRef,
        report: (error) => reportLanguageServerErrorForActiveWorkspaceRoot(rootPath, error),
        rootPath,
        sessionId: requestedSessionId,
        syncKey,
        syncedContentRef: syncedDocumentContentRef,
        versionsRef: documentVersionsRef,
      });
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

  const syncSavedJavaScriptTypeScriptDocument = useJavaScriptTypeScriptDocumentSaveSync({
    dependencies,
    flushPendingChange: flushPendingJavaScriptTypeScriptDocumentChangeForRoot,
    issueVersion: issueJavaScriptTypeScriptDocumentVersion,
    lifecycleIdentitiesRef: javaScriptTypeScriptDocumentLifecycleIdentitiesRef,
    retire: retireJavaScriptTypeScriptDocument,
    retireMalformed: retireMalformedJavaScriptTypeScriptDocument,
  });

  const syncClosedDocument = useCallback(
    (document: EditorDocument) => {
      const rootPath = currentWorkspaceRootRef.current;
      const documentPath = document.path;
      const syncKey = rootPath ? languageServerDocumentSyncKey(rootPath, documentPath) : null;

      if (!rootPath || !syncKey || !syncedDocumentPathsRef.current.has(syncKey)) {
        return Promise.resolve();
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
        documentPath,
        syncKey,
      );

      return enqueueDocumentSync(syncKey, () => {
        if (requestedSessionId === null) {
          return Promise.resolve();
        }

        return languageServerDocumentSyncGateway.didClose(
          rootPath,
          documentPath,
          requestedSessionId,
        );
      }, []).catch((error) => {
        if (
          requestedSessionId !== null &&
          !isLanguageServerSessionCurrentForRoot(rootPath, requestedSessionId)
        ) {
          return;
        }

        reportLanguageServerErrorForActiveWorkspaceRoot(rootPath, error);
      });
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

  const syncClosedJavaScriptTypeScriptDocument = useJavaScriptTypeScriptDocumentCloseSync({
    currentWorkspaceRootRef,
    incrementalSyncRef: javaScriptTypeScriptIncrementalSyncRef,
    largePolicyMemoRef: javaScriptTypeScriptLargePolicyMemoRef,
    mailbox: javaScriptTypeScriptDocumentChangeMailbox,
    retire: retireJavaScriptTypeScriptDocument,
  });

  const {
    isSafe: isJavaScriptTypeScriptLegacyHandoffSafe,
    retireForHandoff: retireLegacyJavaScriptTypeScriptDocumentForIncrementalHandoff,
  } = useJavaScriptTypeScriptLegacyHandoff({
    canOpen: canOpenJavaScriptTypeScriptDocument,
    currentWorkspaceRootRef,
    retire: retireJavaScriptTypeScriptDocument,
    syncedPathsRef: javaScriptTypeScriptSyncedDocumentPathsRef,
  });

  const {
    closePhpDocumentsForRoot: closeSyncedLanguageServerDocumentsForRoot,
    closeJavaScriptTypeScriptDocumentsForRoot: closeSyncedJavaScriptTypeScriptDocumentsForRoot,
  } = useDocumentSyncRootCleanup({
    clearDocumentChangeTimer,
    clearJavaScriptTypeScriptDocumentChangeTimer,
    documentLifecycleIdentitiesRef,
    documentSyncGenerationRef,
    documentVersionsByUriRef,
    documentVersionsRef,
    enqueueDocumentSync,
    enqueueJavaScriptTypeScriptDocumentSync,
    isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
    isLanguageServerSessionCurrentForRoot,
    isRunningLanguageServerForWorkspace,
    isSessionPathInWorkspace,
    javaScriptTypeScriptDocumentAuthorityVersionsRef,
    javaScriptTypeScriptDocumentChangeMailbox,
    javaScriptTypeScriptDocumentLifecycleIdentitiesRef,
    javaScriptTypeScriptDocumentSyncGenerationRef,
    javaScriptTypeScriptDocumentVersionsByUriRef,
    javaScriptTypeScriptDocumentVersionsRef,
    javaScriptTypeScriptIncrementalSyncRef,
    javaScriptTypeScriptLanguageServerDocumentSyncGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
    javaScriptTypeScriptPendingDocumentChangesRef,
    javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    javaScriptTypeScriptSyncedDocumentContentRef,
    javaScriptTypeScriptSyncedDocumentPathsRef,
    languageServerDocumentSyncGateway,
    languageServerRuntimeStatusByRootRef,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRootRef,
    lastAppliedDiagnosticVersionByUriRef,
    pendingDocumentChangesRef,
    pendingDocumentLifecycleIdentitiesRef,
    pendingDocumentOpenSyncAttemptsRef,
    reportErrorForActiveWorkspaceRoot,
    reportLanguageServerErrorForActiveWorkspaceRoot,
    resetLanguageServerDocuments,
    syncedDocumentContentRef,
    syncedDocumentPathsRef,
  });

  return {
    isJavaScriptTypeScriptLegacyHandoffSafe,
    retireLegacyJavaScriptTypeScriptDocumentForIncrementalHandoff,
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
