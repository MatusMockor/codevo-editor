import { useCallback, useEffect, useMemo, useRef } from "react";
import type { WorkspaceFileChangeGateway } from "../../domain/workspaceFileChange";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type {
  WorkspaceIdentityDescriptor,
  WorkspaceIdentityGateway,
} from "../workspaceIdentityGatewayPort";
import type { WorkspaceReleaseRetryDelay } from "../workspaceReleaseRetry";
import { WorkspaceRuntimeOwnerClaimRegistry } from "../workspaceRuntimeOwnerClaimRegistry";
import { WorkspaceTrustIntentCoordinator } from "../workspaceTrustIntentCoordinator";
import { useManagedWorkspaceIdentityOwnership } from "../workbenchController/useManagedWorkspaceIdentityOwnership";
import { useWorkspaceIdentityAuthority } from "../workbenchController/useWorkspaceIdentityAuthority";

export interface AgentWorkspaceAuthorityOptions {
  readonly fileChangeGateway?: Pick<WorkspaceFileChangeGateway, "dispose">;
  readonly identityGateway: WorkspaceIdentityGateway;
  readonly releaseRetryDelay?: WorkspaceReleaseRetryDelay;
  readonly reportError: (source: string, error: unknown) => void;
}

export function useAgentWorkspaceAuthority({
  fileChangeGateway,
  identityGateway,
  releaseRetryDelay,
  reportError,
}: AgentWorkspaceAuthorityOptions) {
  const mountedRef = useRef(true);
  const currentWorkspaceRootRef = useRef<string | null>(null);
  const workspaceOwnerKeyRef = useRef<string | null>(null);
  const openWorkspaceRequestTokenRef = useRef(0);
  const openWorkspaceRequestPathRef = useRef<string | null>(null);
  const openWorkspaceRequestInFlightTokenRef = useRef<number | null>(null);
  const workspaceIdentityByRootRef = useRef<Record<string, WorkspaceIdentityDescriptor>>({});
  const workspaceIdentityDescriptorRef = useRef<WorkspaceIdentityDescriptor | null>(null);
  const workspaceRuntimeOwnerRef = useRef<WorkspaceRuntimeOwner | null>(null);
  const workspaceRuntimeOwnerByTabRef = useRef<Record<string, WorkspaceRuntimeOwner>>({});
  const workspaceRuntimeRootByTabRef = useRef<Record<string, string>>({});
  const workspaceRuntimeOwnerClaimsRef = useRef(new WorkspaceRuntimeOwnerClaimRegistry());
  const workspaceTrustRevisionByOwnerRef = useRef<Record<string, number>>({});
  const workspaceTrustIntentCoordinatorRef = useRef(new WorkspaceTrustIntentCoordinator());
  const workspaceCloseGenerationByRootRef = useRef<Record<string, number>>({});
  const workspaceCloseOwnershipByKeyRef = useRef<Record<string, number>>({});
  const workspaceCloseOwnershipGenerationRef = useRef(0);
  const identityAuthority = useWorkspaceIdentityAuthority();

  const releaseWorkspaceTrustOwner = useCallback((ownerKey: string) => {
    workspaceTrustIntentCoordinatorRef.current.release(ownerKey);
    delete workspaceTrustRevisionByOwnerRef.current[ownerKey];
  }, []);
  const retireWorkspaceRuntimeOwnerClaim = useCallback(
    (ownerKey: string, expectedGeneration?: number | null) => {
      const retiredOwner = workspaceRuntimeOwnerClaimsRef.current.retire(
        ownerKey,
        expectedGeneration,
      );
      if (!retiredOwner) return;
      releaseWorkspaceTrustOwner(ownerKey);
    },
    [releaseWorkspaceTrustOwner],
  );
  const ownership = useManagedWorkspaceIdentityOwnership({
    deferredCleanupIdsRef: identityAuthority.deferredWorkspaceIdentityCleanupIdsRef,
    identityGateway,
    identityRequestTokensRef: identityAuthority.pendingWorkspaceIdentityRequestTokensRef,
    latestAdmissionGenerationByIdRef:
      identityAuthority.latestWorkspaceIdentityAdmissionGenerationByIdRef,
    mountedRef,
    nextAdmissionGenerationRef: identityAuthority.workspaceIdentityAdmissionGenerationRef,
    ownedGenerationByIdRef: identityAuthority.ownedWorkspaceIdentityGenerationByIdRef,
    ownedIdsRef: identityAuthority.ownedWorkspaceIdentityIdsRef,
    pendingAdmissionsRef: identityAuthority.pendingWorkspaceIdentityAdmissionsRef,
    releasedIdsRef: identityAuthority.releasedWorkspaceIdentityIdsRef,
    releaseGenerationByIdRef: identityAuthority.workspaceIdentityReleaseGenerationByIdRef,
    releaseRetryDelay,
    reportError,
    retireRuntimeOwnerClaim: retireWorkspaceRuntimeOwnerClaim,
    runtimeOwnerClaimsRef: workspaceRuntimeOwnerClaimsRef,
    unregisterByIdRef: identityAuthority.workspaceIdentityUnregisterByIdRef,
  });
  const { flushDeferredCleanup, prepareBackendClosedSettlement, releaseOwned, withManagedLease } =
    ownership;
  const managedIdentity = useMemo(
    () => ({
      flushDeferredCleanup,
      prepareBackendClosedSettlement,
      releaseOwned,
      withManagedLease,
    }),
    [flushDeferredCleanup, prepareBackendClosedSettlement, releaseOwned, withManagedLease],
  );
  const retireIdentityAuthority = identityAuthority.retire;

  const resolveWorkspaceRuntimeOwner = useCallback(
    (rootPath: string): WorkspaceRuntimeOwner | null => {
      const exact = workspaceRuntimeOwnerByTabRef.current[rootPath];
      if (exact) return exact;
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) return null;
      return workspaceRuntimeOwnerRef.current;
    },
    [],
  );

  const isWorkspaceOwnerCurrent = useCallback(
    (rootPath: string, ownerKey: string) =>
      mountedRef.current &&
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
      workspaceOwnerKeyRef.current === ownerKey,
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    const ownerClaims = workspaceRuntimeOwnerClaimsRef.current;
    return () => {
      mountedRef.current = false;
      openWorkspaceRequestTokenRef.current += 1;
      openWorkspaceRequestPathRef.current = null;
      openWorkspaceRequestInFlightTokenRef.current = null;
      const workspaceIds = retireIdentityAuthority();
      workspaceIdentityByRootRef.current = {};
      workspaceRuntimeRootByTabRef.current = {};
      workspaceRuntimeOwnerByTabRef.current = {};
      ownerClaims.clear();
      disposeFileChanges(fileChangeGateway);
      for (const workspaceId of workspaceIds) {
        void releaseOwned(workspaceId, "retryLater").catch(() => undefined);
      }
    };
  }, [fileChangeGateway, releaseOwned, retireIdentityAuthority]);

  return useMemo(
    () => ({
      currentWorkspaceRootRef,
      isWorkspaceOwnerCurrent,
      managedIdentity,
      mountedRef,
      openWorkspaceRequestInFlightTokenRef,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      ownedWorkspaceIdentityGenerationByIdRef:
        identityAuthority.ownedWorkspaceIdentityGenerationByIdRef,
      pendingWorkspaceIdentityRequestTokensRef:
        identityAuthority.pendingWorkspaceIdentityRequestTokensRef,
      releaseWorkspaceTrustOwner,
      resolveWorkspaceRuntimeOwner,
      retireWorkspaceRuntimeOwnerClaim,
      workspaceCloseGenerationByRootRef,
      workspaceCloseOwnershipByKeyRef,
      workspaceCloseOwnershipGenerationRef,
      workspaceIdentityByRootRef,
      workspaceIdentityDescriptorRef,
      workspaceOwnerKeyRef,
      workspaceRuntimeOwnerByTabRef,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerRef,
      workspaceRuntimeRootByTabRef,
      workspaceTrustIntentCoordinatorRef,
      workspaceTrustRevisionByOwnerRef,
    }),
    [
      identityAuthority.ownedWorkspaceIdentityGenerationByIdRef,
      identityAuthority.pendingWorkspaceIdentityRequestTokensRef,
      isWorkspaceOwnerCurrent,
      managedIdentity,
      releaseWorkspaceTrustOwner,
      resolveWorkspaceRuntimeOwner,
      retireWorkspaceRuntimeOwnerClaim,
    ],
  );
}

export type AgentWorkspaceAuthority = ReturnType<typeof useAgentWorkspaceAuthority>;

function disposeFileChanges(
  gateway: Pick<WorkspaceFileChangeGateway, "dispose"> | undefined,
): void {
  if (!gateway?.dispose) return;
  try {
    void Promise.resolve(gateway.dispose()).catch(() => undefined);
  } catch {
    return;
  }
}
