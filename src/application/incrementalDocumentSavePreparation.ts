import { useCallback, type MutableRefObject } from "react";
import {
  createLanguageServerTextDocument,
  languageServerDocumentSyncKey,
  type LanguageServerDocumentSyncGateway,
} from "../domain/languageServerDocumentSync";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { DocumentSyncDependencies } from "./documentSyncContracts";
import { isJavaScriptTypeScriptDocumentSyncBlockedBySize } from "./javaScriptTypeScriptDocumentSyncAdmission";
import type { JavaScriptTypeScriptIncrementalSyncDocumentLifecyclePort } from "./javaScriptTypeScriptIncrementalSyncProduction";
import { syncLegacyFullTextDocumentSave } from "./legacyFullTextDocumentSave";

export interface IncrementalDocumentSavePreparation {
  readonly document: EditorDocument;
  readonly gateway: LanguageServerDocumentSyncGateway;
  readonly incrementalSync: JavaScriptTypeScriptIncrementalSyncDocumentLifecyclePort;
  readonly isCurrent: () => boolean;
  readonly rootPath: string;
  readonly sessionId: number;
  readonly version: number;
}

export type IncrementalDocumentSaveOutcome = "committed" | "stale-noop";

/**
 * Prepares and confirms one exact live-editor save without consulting the
 * potentially stale React document projection.
 */
export async function syncPreparedIncrementalDocumentSave({
  document,
  gateway,
  incrementalSync,
  isCurrent,
  rootPath,
  sessionId,
  version,
}: IncrementalDocumentSavePreparation): Promise<IncrementalDocumentSaveOutcome> {
  const prepared = await incrementalSync.prepareLatestSave(document.path, document.content);
  if (
    !prepared ||
    prepared.content !== document.content ||
    !isCurrent() ||
    !incrementalSync.confirmSave(prepared.permit)
  ) {
    return "stale-noop";
  }
  await gateway.didSave(
    rootPath,
    createLanguageServerTextDocument({ ...document, content: prepared.content }, version),
    sessionId,
  );
  return "committed";
}

interface JavaScriptTypeScriptDocumentSaveSyncOptions {
  readonly dependencies: DocumentSyncDependencies;
  readonly flushPendingChange: (rootPath: string, path: string) => Promise<void>;
  readonly issueVersion: (rootPath: string, path: string) => number;
  readonly lifecycleIdentitiesRef: MutableRefObject<Record<string, number>>;
  readonly retire: (rootPath: string, path: string) => Promise<void>;
  readonly retireMalformed: (
    rootPath: string,
    path: string,
    syncKey: string,
    content: string,
    error: unknown,
    isCurrent: () => boolean,
  ) => "not-malformed" | "retired-malformed" | "stale-malformed";
}

export function useJavaScriptTypeScriptDocumentSaveSync({
  dependencies,
  flushPendingChange,
  issueVersion,
  lifecycleIdentitiesRef,
  retire,
  retireMalformed,
}: JavaScriptTypeScriptDocumentSaveSyncOptions) {
  const {
    currentWorkspaceRootRef,
    enqueueJavaScriptTypeScriptDocumentSync: enqueueSync,
    isJavaScriptTypeScriptDocumentSyncableForRoot: isSyncable,
    isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot: isSessionCurrent,
    isRunningLanguageServerForWorkspace: isRunning,
    javaScriptTypeScriptDocumentChangeMailbox: mailbox,
    javaScriptTypeScriptDocumentSyncGenerationRef: generationRef,
    javaScriptTypeScriptDocumentVersionsRef: versionsRef,
    javaScriptTypeScriptIncrementalSyncRef: incrementalSyncRef,
    javaScriptTypeScriptLanguageServerDocumentSyncGateway: gateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus: runtimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot: runtimeStatusRoot,
    javaScriptTypeScriptPendingDocumentChangesRef: pendingChangesRef,
    javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef: pendingOpenAttemptsRef,
    javaScriptTypeScriptSyncedDocumentContentRef: syncedContentRef,
    javaScriptTypeScriptSyncedDocumentPathsRef: syncedPathsRef,
    reportErrorForActiveWorkspaceRoot: reportError,
  } = dependencies;

  return useCallback(
    async (
      requestedRoot: string,
      document: EditorDocument,
      shouldEmit: () => boolean = () => true,
    ) => {
      if (!workspaceRootKeysEqual(requestedRoot, currentWorkspaceRootRef.current)) return;
      const rootPath = requestedRoot;
      const syncKey = languageServerDocumentSyncKey(rootPath, document.path);
      const incrementalSync = incrementalSyncRef?.current ?? null;
      const incrementalLease = incrementalSync?.requestLifecycleLease(document.path) ?? null;
      const incrementalOwned = incrementalSync?.ownsLifecycle(document.path) ?? false;
      if (
        (!incrementalOwned && !syncedPathsRef.current.has(syncKey)) ||
        !isSyncable(rootPath, document)
      )
        return;
      if (!incrementalOwned && isJavaScriptTypeScriptDocumentSyncBlockedBySize(document)) {
        mailbox.drop(syncKey);
        if (incrementalLease) await incrementalSync?.closeDocument(incrementalLease);
        await retire(rootPath, document.path);
        return;
      }
      if (!rootPath || !isRunning(runtimeStatus, runtimeStatusRoot, rootPath)) return;
      const sessionId = runtimeStatus.sessionId;
      const generation = generationRef.current;
      if (incrementalOwned && incrementalSync) {
        try {
          await syncPreparedIncrementalDocumentSave({
            document,
            gateway,
            incrementalSync,
            isCurrent: () =>
              generationRef.current === generation &&
              isSessionCurrent(rootPath, sessionId) &&
              shouldEmit(),
            rootPath,
            sessionId,
            version: versionsRef.current[syncKey] || 1,
          });
          return;
        } catch (error) {
          if (generationRef.current === generation && isSessionCurrent(rootPath, sessionId)) {
            reportError(rootPath, "JavaScript/TypeScript", error);
          }
        }
        if (!incrementalLease) return;
        await incrementalSync.fallbackToLegacy(incrementalLease);
      }
      const lifecycleIdentity = lifecycleIdentitiesRef.current[syncKey];
      if (lifecycleIdentity === undefined) return;
      const isCurrent = () =>
        generationRef.current === generation &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        isSessionCurrent(rootPath, sessionId) &&
        syncedPathsRef.current.has(syncKey) &&
        pendingOpenAttemptsRef.current[syncKey] === undefined &&
        lifecycleIdentitiesRef.current[syncKey] === lifecycleIdentity &&
        shouldEmit();
      await syncLegacyFullTextDocumentSave({
        document,
        enqueue: (operation, retainedPayloads) => enqueueSync(syncKey, operation, retainedPayloads),
        flush: () => flushPendingChange(rootPath, document.path),
        gateway,
        isCurrent,
        issueVersion: () => issueVersion(rootPath, document.path),
        pendingChangesRef,
        report: (error) => {
          if (
            retireMalformed(
              rootPath,
              document.path,
              syncKey,
              document.content,
              error,
              () =>
                isCurrent() &&
                (pendingChangesRef.current[syncKey]?.text ?? syncedContentRef.current[syncKey]) ===
                  document.content,
            ) === "not-malformed"
          ) {
            reportError(rootPath, "JavaScript/TypeScript", error);
          }
        },
        rootPath,
        sessionId,
        syncKey,
        syncedContentRef,
        versionsRef,
      });
    },
    [
      currentWorkspaceRootRef,
      enqueueSync,
      flushPendingChange,
      gateway,
      generationRef,
      incrementalSyncRef,
      isRunning,
      isSessionCurrent,
      isSyncable,
      issueVersion,
      lifecycleIdentitiesRef,
      mailbox,
      pendingChangesRef,
      pendingOpenAttemptsRef,
      reportError,
      retire,
      retireMalformed,
      runtimeStatus,
      runtimeStatusRoot,
      syncedContentRef,
      syncedPathsRef,
      versionsRef,
    ],
  );
}
