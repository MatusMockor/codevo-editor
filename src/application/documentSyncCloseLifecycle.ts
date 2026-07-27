import type { MutableRefObject } from "react";
import {
  languageServerDocumentSyncKey,
  languageServerPathFromDocumentSyncKey,
  type LanguageServerDocumentSyncGateway,
  type LanguageServerTextDocument,
  type SessionBoundLanguageServerDocumentSyncGateway,
} from "../domain/languageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { cachedLanguageServerRuntimeStatusForRoot } from "../domain/languageServerRuntimeStatusCache";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  clearDocumentSyncVersionState,
  type DocumentSyncVersionState,
} from "./documentSyncVersionBookkeeping";

interface SyncedDocument {
  readonly key: string;
  readonly path: string;
}

interface CloseLifecycleState {
  readonly syncedPathsRef: MutableRefObject<Set<string>>;
  readonly syncedContentRef: MutableRefObject<Record<string, string>>;
  readonly pendingChangesRef: MutableRefObject<Record<string, LanguageServerTextDocument>>;
  readonly pendingOpenAttemptsRef: MutableRefObject<Record<string, number>>;
  readonly lifecycleIdentitiesRef: MutableRefObject<Record<string, number>>;
  readonly versionState: DocumentSyncVersionState;
}

interface RetireJavaScriptTypeScriptDocumentOptions {
  readonly rootPath: string;
  readonly path: string;
  readonly expectedLifecycleIdentity: number;
  readonly state: CloseLifecycleState & {
    readonly authorityVersionsRef: MutableRefObject<Record<string, number>>;
    readonly closingLifecycleReceiptsRef: MutableRefObject<Set<string>>;
    readonly uncertainCloseSessionIdsRef: MutableRefObject<Record<string, number>>;
  };
  readonly sessionId: number | null;
  readonly clearChangeTimer: (key: string) => void;
  readonly enqueueSync: (key: string, operation: () => Promise<void>) => Promise<void>;
  readonly gateway: LanguageServerDocumentSyncGateway;
  readonly isOwnerCurrent: () => boolean;
  readonly reportError: (rootPath: string, error: unknown) => void;
}

export async function retireJavaScriptTypeScriptDocument({
  rootPath,
  path,
  expectedLifecycleIdentity,
  state,
  sessionId,
  clearChangeTimer,
  enqueueSync,
  gateway,
  isOwnerCurrent,
  reportError,
}: RetireJavaScriptTypeScriptDocumentOptions): Promise<void> {
  const key = languageServerDocumentSyncKey(rootPath, path);
  if (
    !state.syncedPathsRef.current.has(key) ||
    state.lifecycleIdentitiesRef.current[key] !== expectedLifecycleIdentity
  ) {
    return;
  }

  const closingReceipt = `${key}\u0000${expectedLifecycleIdentity}`;
  state.closingLifecycleReceiptsRef.current.add(closingReceipt);
  clearChangeTimer(key);
  clearDocumentLifecycle(state, rootPath, { key, path });
  delete state.authorityVersionsRef.current[key];

  const canSend = () =>
    state.closingLifecycleReceiptsRef.current.has(closingReceipt) && isOwnerCurrent();
  let didSend = false;

  try {
    await enqueueSync(key, async () => {
      if (!canSend()) {
        return;
      }
      didSend = true;
      await gateway.didClose(rootPath, path);
    });
  } catch (error) {
    if (didSend && sessionId !== null) {
      state.uncertainCloseSessionIdsRef.current[key] = sessionId;
    }
    if (canSend()) {
      reportError(rootPath, error);
    }
  } finally {
    state.closingLifecycleReceiptsRef.current.delete(closingReceipt);
  }
}

interface RuntimeAuthority {
  readonly statusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  readonly statusRootRef: MutableRefObject<string | null>;
  readonly statusByRootRef: MutableRefObject<Record<string, LanguageServerRuntimeStatus>>;
  readonly isRunningForWorkspace: (
    status: LanguageServerRuntimeStatus | null,
    statusRoot: string | null,
    workspaceRoot: string | null | undefined,
  ) => status is Extract<LanguageServerRuntimeStatus, { kind: "running" }>;
}

function collectSyncedDocumentsForRoot(
  rootPath: string,
  syncedPaths: ReadonlySet<string>,
  acceptsPath: (path: string) => boolean = () => true,
): readonly SyncedDocument[] {
  return Array.from(syncedPaths).flatMap((key) => {
    const path = languageServerPathFromDocumentSyncKey(rootPath, key);
    return path && acceptsPath(path) ? [{ key, path }] : [];
  });
}

function runningSessionForRoot(rootPath: string, authority: RuntimeAuthority): number | null {
  const currentStatus =
    cachedLanguageServerRuntimeStatusForRoot(authority.statusByRootRef.current, rootPath) ??
    (workspaceRootKeysEqual(authority.statusRootRef.current, rootPath)
      ? authority.statusRef.current
      : null);
  return authority.isRunningForWorkspace(
    currentStatus,
    currentStatus?.rootPath ?? authority.statusRootRef.current,
    rootPath,
  )
    ? currentStatus.sessionId
    : null;
}

function clearDocumentLifecycle(
  state: CloseLifecycleState,
  rootPath: string,
  document: SyncedDocument,
): void {
  state.syncedPathsRef.current.delete(document.key);
  delete state.lifecycleIdentitiesRef.current[document.key];
  delete state.syncedContentRef.current[document.key];
  delete state.pendingChangesRef.current[document.key];
  delete state.pendingOpenAttemptsRef.current[document.key];
  clearDocumentSyncVersionState(state.versionState, rootPath, document.path, document.key);
}

interface ClosePhpDocumentsForRootOptions {
  readonly rootPath: string;
  readonly syncGenerationRef: MutableRefObject<number>;
  readonly state: CloseLifecycleState & {
    readonly pendingLifecycleIdentitiesRef: MutableRefObject<Record<string, number>>;
  };
  readonly runtimeAuthority: RuntimeAuthority;
  readonly clearChangeTimer: (key: string) => void;
  readonly enqueueSync: (key: string, operation: () => Promise<void>) => Promise<void>;
  readonly gateway: SessionBoundLanguageServerDocumentSyncGateway;
  readonly isSessionCurrent: (rootPath: string, sessionId: number) => boolean;
  readonly reportError: (rootPath: string, error: unknown) => void;
  readonly resetDocuments: () => void;
}

export async function closePhpDocumentsForRoot({
  rootPath,
  syncGenerationRef,
  state,
  runtimeAuthority,
  clearChangeTimer,
  enqueueSync,
  gateway,
  isSessionCurrent,
  reportError,
  resetDocuments,
}: ClosePhpDocumentsForRootOptions): Promise<void> {
  const syncedDocuments = collectSyncedDocumentsForRoot(rootPath, state.syncedPathsRef.current);
  if (syncedDocuments.length > 0) {
    syncGenerationRef.current += 1;
  }
  const requestedSessionId = runningSessionForRoot(rootPath, runtimeAuthority);
  const closeRequests = syncedDocuments.map(async (document) => {
    clearChangeTimer(document.key);
    clearDocumentLifecycle(state, rootPath, document);
    delete state.pendingLifecycleIdentitiesRef.current[document.key];

    try {
      await enqueueSync(document.key, () =>
        requestedSessionId === null
          ? Promise.resolve()
          : gateway.didClose(rootPath, document.path, requestedSessionId),
      );
    } catch (error) {
      if (requestedSessionId !== null && !isSessionCurrent(rootPath, requestedSessionId)) {
        return;
      }
      reportError(rootPath, error);
    }
  });

  if (state.syncedPathsRef.current.size === 0) {
    resetDocuments();
  }
  await Promise.all(closeRequests);
}

interface CloseJavaScriptTypeScriptDocumentsForRootOptions {
  readonly rootPath: string;
  readonly syncGenerationRef: MutableRefObject<number>;
  readonly state: CloseLifecycleState & {
    readonly authorityVersionsRef: MutableRefObject<Record<string, number>>;
  };
  readonly runtimeAuthority: RuntimeAuthority;
  readonly isPathInWorkspace: (rootPath: string, path: string) => boolean;
  readonly clearChangeTimer: (key: string) => void;
  readonly enqueueSync: (key: string, operation: () => Promise<void>) => Promise<void>;
  readonly gateway: LanguageServerDocumentSyncGateway;
  readonly isSessionCurrent: (rootPath: string, sessionId: number) => boolean;
  readonly reportError: (rootPath: string, error: unknown) => void;
}

export async function closeJavaScriptTypeScriptDocumentsForRoot({
  rootPath,
  syncGenerationRef,
  state,
  runtimeAuthority,
  isPathInWorkspace,
  clearChangeTimer,
  enqueueSync,
  gateway,
  isSessionCurrent,
  reportError,
}: CloseJavaScriptTypeScriptDocumentsForRootOptions): Promise<void> {
  const syncedDocuments = collectSyncedDocumentsForRoot(
    rootPath,
    state.syncedPathsRef.current,
    (path) => isPathInWorkspace(rootPath, path),
  );
  if (syncedDocuments.length > 0) {
    syncGenerationRef.current += 1;
  }
  const requestedSessionId = runningSessionForRoot(rootPath, runtimeAuthority);

  await Promise.all(
    syncedDocuments.map(async (document) => {
      clearChangeTimer(document.key);
      clearDocumentLifecycle(state, rootPath, document);
      delete state.authorityVersionsRef.current[document.key];

      try {
        await enqueueSync(document.key, () => {
          if (requestedSessionId === null || !isSessionCurrent(rootPath, requestedSessionId)) {
            return Promise.resolve();
          }
          return gateway.didClose(rootPath, document.path);
        });
      } catch (error) {
        if (requestedSessionId !== null && !isSessionCurrent(rootPath, requestedSessionId)) {
          return;
        }
        reportError(rootPath, error);
      }
    }),
  );
}
