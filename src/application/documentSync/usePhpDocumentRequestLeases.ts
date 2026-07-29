import { useCallback } from "react";
import { languageServerDocumentSyncKey } from "../../domain/languageServerDocumentSync";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type {
  DocumentSyncDependencies,
  LanguageServerDocumentRequestLease,
} from "../documentSyncContracts";

type PhpDocumentRequestLeaseDependencies = Pick<
  DocumentSyncDependencies,
  | "currentWorkspaceRootRef"
  | "documentLifecycleIdentitiesRef"
  | "documentSyncGenerationRef"
  | "isLanguageServerSessionCurrentForRoot"
  | "isRunningLanguageServerForWorkspace"
  | "languageServerRuntimeStatus"
  | "languageServerRuntimeStatusRoot"
  | "pendingDocumentLifecycleIdentitiesRef"
  | "pendingDocumentOpenSyncAttemptsRef"
  | "syncedDocumentPathsRef"
> & {
  readonly flushPendingDocumentChangeForRoot: (
    requestedRoot: string,
    path: string,
  ) => Promise<void>;
};

export interface PhpDocumentRequestLeases {
  readonly isDocumentSynced: (path: string) => boolean;
  readonly isRequestLeaseCurrent: (lease: LanguageServerDocumentRequestLease) => boolean;
  readonly requestLease: (
    rootPath: string,
    path: string,
  ) => Promise<LanguageServerDocumentRequestLease | null>;
}

/**
 * Owns the exact PHP document authority handed to language feature requests.
 * A lease is useful only while root, session, generation, lifecycle and didOpen
 * settlement still match the captured values.
 */
export function usePhpDocumentRequestLeases(
  dependencies: PhpDocumentRequestLeaseDependencies,
): PhpDocumentRequestLeases {
  const {
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
  } = dependencies;

  const isRequestLeaseCurrent = useCallback(
    (lease: LanguageServerDocumentRequestLease): boolean => {
      const syncKey = languageServerDocumentSyncKey(lease.rootPath, lease.path);

      return (
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, lease.rootPath) &&
        documentSyncGenerationRef.current === lease.syncGeneration &&
        isLanguageServerSessionCurrentForRoot(lease.rootPath, lease.sessionId) &&
        syncedDocumentPathsRef.current.has(syncKey) &&
        pendingDocumentOpenSyncAttemptsRef.current[syncKey] === undefined &&
        documentLifecycleIdentitiesRef.current[syncKey] === lease.lifecycleIdentity
      );
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

  const requestLease = useCallback(
    async (rootPath: string, path: string): Promise<LanguageServerDocumentRequestLease | null> => {
      if (
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
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

      return isRequestLeaseCurrent(lease) ? lease : null;
    },
    [
      currentWorkspaceRootRef,
      documentLifecycleIdentitiesRef,
      documentSyncGenerationRef,
      flushPendingDocumentChangeForRoot,
      isRequestLeaseCurrent,
      isRunningLanguageServerForWorkspace,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      pendingDocumentLifecycleIdentitiesRef,
    ],
  );

  const isDocumentSynced = useCallback(
    (path: string): boolean => {
      const rootPath = currentWorkspaceRootRef.current;
      if (!rootPath) return false;

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

  return { isDocumentSynced, isRequestLeaseCurrent, requestLease };
}
