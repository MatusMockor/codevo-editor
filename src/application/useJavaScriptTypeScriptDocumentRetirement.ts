import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import {
  languageServerDocumentSyncKey,
  type LanguageServerDocumentSyncGateway,
  type LanguageServerTextDocument,
} from "../domain/languageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { retireJavaScriptTypeScriptDocument } from "./documentSyncCloseLifecycle";

interface JavaScriptTypeScriptDocumentRetirementOptions {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly syncedPathsRef: MutableRefObject<Set<string>>;
  readonly syncedContentRef: MutableRefObject<Record<string, string>>;
  readonly pendingChangesRef: MutableRefObject<Record<string, LanguageServerTextDocument>>;
  readonly pendingOpenAttemptsRef: MutableRefObject<Record<string, number>>;
  readonly lifecycleIdentitiesRef: MutableRefObject<Record<string, number>>;
  readonly authorityVersionsRef: MutableRefObject<Record<string, number>>;
  readonly diagnosticVersionsByUriRef: MutableRefObject<Record<string, number>>;
  readonly documentVersionsByUriRef: MutableRefObject<Record<string, number>>;
  readonly documentVersionsRef: MutableRefObject<Record<string, number>>;
  readonly syncGenerationRef: MutableRefObject<number>;
  readonly runtimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  readonly runtimeStatusRootRef: MutableRefObject<string | null>;
  readonly clearChangeTimer: (key: string) => void;
  readonly enqueueSync: (key: string, operation: () => Promise<void>) => Promise<void>;
  readonly gateway: LanguageServerDocumentSyncGateway;
  readonly isRunningForWorkspace: (
    status: LanguageServerRuntimeStatus | null,
    statusRoot: string | null,
    workspaceRoot: string | null | undefined,
  ) => status is Extract<LanguageServerRuntimeStatus, { kind: "running" }>;
  readonly isSessionCurrent: (rootPath: string, sessionId: number) => boolean;
  readonly reportError: (rootPath: string, error: unknown) => void;
}

interface JavaScriptTypeScriptDocumentRetirement {
  readonly canOpen: (rootPath: string, path: string) => boolean;
  readonly retire: (rootPath: string, path: string, isCurrent?: () => boolean) => Promise<void>;
}

export function useJavaScriptTypeScriptDocumentRetirement({
  currentWorkspaceRootRef,
  syncedPathsRef,
  syncedContentRef,
  pendingChangesRef,
  pendingOpenAttemptsRef,
  lifecycleIdentitiesRef,
  authorityVersionsRef,
  diagnosticVersionsByUriRef,
  documentVersionsByUriRef,
  documentVersionsRef,
  syncGenerationRef,
  runtimeStatusRef,
  runtimeStatusRootRef,
  clearChangeTimer,
  enqueueSync,
  gateway,
  isRunningForWorkspace,
  isSessionCurrent,
  reportError,
}: JavaScriptTypeScriptDocumentRetirementOptions): JavaScriptTypeScriptDocumentRetirement {
  const closingLifecycleReceiptsRef = useRef(new Set<string>());
  const uncertainCloseSessionIdsRef = useRef<Record<string, number>>({});
  const ownerEpochRef = useRef(0);
  const gatewayRef = useRef(gateway);
  const authorityProviderRef = useRef({
    isRunningForWorkspace,
    isSessionCurrent,
    runtimeStatusRef,
    runtimeStatusRootRef,
  });
  if (
    gatewayRef.current !== gateway ||
    authorityProviderRef.current.isRunningForWorkspace !== isRunningForWorkspace ||
    authorityProviderRef.current.isSessionCurrent !== isSessionCurrent ||
    authorityProviderRef.current.runtimeStatusRef !== runtimeStatusRef ||
    authorityProviderRef.current.runtimeStatusRootRef !== runtimeStatusRootRef
  ) {
    gatewayRef.current = gateway;
    authorityProviderRef.current = {
      isRunningForWorkspace,
      isSessionCurrent,
      runtimeStatusRef,
      runtimeStatusRootRef,
    };
    ownerEpochRef.current += 1;
  }

  useEffect(
    () => () => {
      ownerEpochRef.current += 1;
      closingLifecycleReceiptsRef.current.clear();
      uncertainCloseSessionIdsRef.current = {};
    },
    [],
  );

  const canOpen = useCallback(
    (rootPath: string, path: string): boolean => {
      const runtimeStatus = runtimeStatusRef.current;
      if (!isRunningForWorkspace(runtimeStatus, runtimeStatusRootRef.current, rootPath)) {
        return false;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, path);
      const uncertainSessionId = uncertainCloseSessionIdsRef.current[syncKey];
      if (uncertainSessionId === undefined) {
        return true;
      }
      if (uncertainSessionId === runtimeStatus.sessionId) {
        return false;
      }

      delete uncertainCloseSessionIdsRef.current[syncKey];
      return true;
    },
    [isRunningForWorkspace, runtimeStatusRef, runtimeStatusRootRef],
  );

  const retire = useCallback(
    async (rootPath: string, path: string, isCurrent: () => boolean = () => true) => {
      const syncKey = languageServerDocumentSyncKey(rootPath, path);
      const expectedLifecycleIdentity = lifecycleIdentitiesRef.current[syncKey];
      if (
        !isCurrent() ||
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) ||
        !syncedPathsRef.current.has(syncKey) ||
        expectedLifecycleIdentity === undefined
      ) {
        return;
      }

      const runtimeStatus = runtimeStatusRef.current;
      const sessionId = isRunningForWorkspace(runtimeStatus, runtimeStatusRootRef.current, rootPath)
        ? runtimeStatus.sessionId
        : null;
      const syncGeneration = syncGenerationRef.current;
      const ownerEpoch = ownerEpochRef.current;

      await retireJavaScriptTypeScriptDocument({
        rootPath,
        path,
        expectedLifecycleIdentity,
        state: {
          syncedPathsRef,
          syncedContentRef,
          pendingChangesRef,
          pendingOpenAttemptsRef,
          lifecycleIdentitiesRef,
          authorityVersionsRef,
          closingLifecycleReceiptsRef,
          uncertainCloseSessionIdsRef,
          versionState: {
            diagnosticVersionsByUriRef,
            documentVersionsByUriRef,
            documentVersionsRef,
          },
        },
        clearChangeTimer,
        enqueueSync,
        gateway,
        sessionId,
        isOwnerCurrent: () =>
          ownerEpochRef.current === ownerEpoch &&
          isCurrent() &&
          gatewayRef.current === gateway &&
          syncGenerationRef.current === syncGeneration &&
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
          sessionId !== null &&
          isSessionCurrent(rootPath, sessionId),
        reportError,
      });
    },
    [
      authorityVersionsRef,
      clearChangeTimer,
      currentWorkspaceRootRef,
      diagnosticVersionsByUriRef,
      documentVersionsByUriRef,
      documentVersionsRef,
      enqueueSync,
      gateway,
      isRunningForWorkspace,
      isSessionCurrent,
      lifecycleIdentitiesRef,
      pendingChangesRef,
      pendingOpenAttemptsRef,
      reportError,
      runtimeStatusRef,
      runtimeStatusRootRef,
      syncedContentRef,
      syncedPathsRef,
      syncGenerationRef,
    ],
  );

  return { canOpen, retire };
}
