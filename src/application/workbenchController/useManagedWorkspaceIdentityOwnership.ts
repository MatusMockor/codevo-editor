import { useCallback, type MutableRefObject } from "react";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import type { WorkspaceIdentityGateway } from "../workspaceIdentityGatewayPort";
import { withWorkspaceIdentityLease } from "./workspaceIdentityPolicy";

type WorkspaceIdentityReleaseOutcome = "deferred" | "released";

interface WorkspaceIdentityAdmissionLease {
  readonly generation: number;
  readonly workspaceId: string;
}

interface ManagedWorkspaceIdentityOwnershipOptions {
  readonly deferredCleanupIdsRef: MutableRefObject<Set<string>>;
  readonly identityGateway: WorkspaceIdentityGateway;
  readonly identityRequestTokensRef: MutableRefObject<Set<number>>;
  readonly mountedRef: MutableRefObject<boolean>;
  readonly nextAdmissionGenerationRef: MutableRefObject<number>;
  readonly ownedGenerationByIdRef: MutableRefObject<Record<string, number>>;
  readonly ownedIdsRef: MutableRefObject<Set<string>>;
  readonly pendingAdmissionsRef: MutableRefObject<Record<string, Set<number>>>;
  readonly releasedIdsRef: MutableRefObject<Set<string>>;
  readonly releaseGenerationByIdRef: MutableRefObject<Record<string, number>>;
  readonly reportError: (source: string, error: unknown) => void;
  readonly retireRuntimeOwnerClaim: (ownerKey: string, expectedGeneration?: number | null) => void;
  readonly runtimeOwnerClaimsRef: MutableRefObject<{
    generationFor(workspaceId: string): number | null | undefined;
  }>;
  readonly unregisterByIdRef: MutableRefObject<Record<string, Promise<void>>>;
}

export function useManagedWorkspaceIdentityOwnership({
  deferredCleanupIdsRef,
  identityGateway,
  identityRequestTokensRef,
  mountedRef,
  nextAdmissionGenerationRef,
  ownedGenerationByIdRef,
  ownedIdsRef,
  pendingAdmissionsRef,
  releasedIdsRef,
  releaseGenerationByIdRef,
  reportError,
  retireRuntimeOwnerClaim,
  runtimeOwnerClaimsRef,
  unregisterByIdRef,
}: ManagedWorkspaceIdentityOwnershipOptions) {
  const unregisterIfUnused = useCallback(
    async (
      workspaceId: string,
      requestedReleaseGeneration?: number,
    ): Promise<WorkspaceIdentityReleaseOutcome> => {
      const releaseGeneration =
        requestedReleaseGeneration ?? releaseGenerationByIdRef.current[workspaceId];
      const ownedGeneration = ownedGenerationByIdRef.current[workspaceId];
      if (ownedIdsRef.current.has(workspaceId) && releaseGeneration === undefined) {
        return "deferred";
      }

      if (releaseGeneration !== undefined && ownedGeneration !== releaseGeneration) {
        if (releaseGenerationByIdRef.current[workspaceId] === releaseGeneration) {
          delete releaseGenerationByIdRef.current[workspaceId];
        }
        return "deferred";
      }

      if (pendingAdmissionsRef.current[workspaceId]?.size) {
        return "deferred";
      }

      if (identityRequestTokensRef.current.size > 0) {
        deferredCleanupIdsRef.current.add(workspaceId);
        return "deferred";
      }

      const pendingUnregister = unregisterByIdRef.current[workspaceId];
      if (pendingUnregister) {
        await pendingUnregister;
        return releasedIdsRef.current.has(workspaceId) ? "released" : "deferred";
      }

      const request = identityGateway.unregister(workspaceId);
      deferredCleanupIdsRef.current.delete(workspaceId);
      unregisterByIdRef.current[workspaceId] = request;
      let requestStillCurrent = true;
      try {
        await request;
      } finally {
        if (unregisterByIdRef.current[workspaceId] !== request) {
          requestStillCurrent = false;
        }
        if (requestStillCurrent) {
          delete unregisterByIdRef.current[workspaceId];
        }
      }
      if (!requestStillCurrent) {
        return "deferred";
      }

      if (releaseGeneration === undefined) {
        return "released";
      }

      if (releaseGenerationByIdRef.current[workspaceId] === releaseGeneration) {
        delete releaseGenerationByIdRef.current[workspaceId];
      }
      if (ownedGenerationByIdRef.current[workspaceId] !== releaseGeneration) {
        return "deferred";
      }

      ownedIdsRef.current.delete(workspaceId);
      delete ownedGenerationByIdRef.current[workspaceId];
      releasedIdsRef.current.add(workspaceId);
      return "released";
    },
    [
      deferredCleanupIdsRef,
      identityGateway,
      identityRequestTokensRef,
      ownedGenerationByIdRef,
      ownedIdsRef,
      pendingAdmissionsRef,
      releasedIdsRef,
      releaseGenerationByIdRef,
      unregisterByIdRef,
    ],
  );

  const flushDeferredCleanup = useCallback(() => {
    if (identityRequestTokensRef.current.size > 0) {
      return;
    }

    for (const workspaceId of [...deferredCleanupIdsRef.current]) {
      void unregisterIfUnused(workspaceId).catch((error) => {
        if (mountedRef.current) {
          reportError("Workspace", error);
        }
      });
    }
  }, [
    deferredCleanupIdsRef,
    identityRequestTokensRef,
    mountedRef,
    reportError,
    unregisterIfUnused,
  ]);

  const beginAdmission = useCallback(
    (workspaceId: string): WorkspaceIdentityAdmissionLease => {
      const generation = nextAdmissionGenerationRef.current + 1;
      nextAdmissionGenerationRef.current = generation;
      const pending = pendingAdmissionsRef.current[workspaceId] ?? new Set();
      pending.add(generation);
      pendingAdmissionsRef.current[workspaceId] = pending;
      return { generation, workspaceId };
    },
    [nextAdmissionGenerationRef, pendingAdmissionsRef],
  );

  const adoptAdmission = useCallback(
    (lease: WorkspaceIdentityAdmissionLease) => {
      const pending = pendingAdmissionsRef.current[lease.workspaceId];
      pending?.delete(lease.generation);
      if (pending?.size === 0) {
        delete pendingAdmissionsRef.current[lease.workspaceId];
      }
      ownedIdsRef.current.add(lease.workspaceId);
      releasedIdsRef.current.delete(lease.workspaceId);
      ownedGenerationByIdRef.current[lease.workspaceId] = lease.generation;
    },
    [ownedGenerationByIdRef, ownedIdsRef, pendingAdmissionsRef, releasedIdsRef],
  );

  const releaseAdmission = useCallback(
    async (lease: WorkspaceIdentityAdmissionLease) => {
      const pending = pendingAdmissionsRef.current[lease.workspaceId];
      pending?.delete(lease.generation);
      if (pending?.size === 0) {
        delete pendingAdmissionsRef.current[lease.workspaceId];
      }
      await unregisterIfUnused(lease.workspaceId);
    },
    [pendingAdmissionsRef, unregisterIfUnused],
  );

  const releaseOwned = useCallback(
    async (workspaceId: string): Promise<WorkspaceIdentityReleaseOutcome> => {
      const claimedGeneration = runtimeOwnerClaimsRef.current.generationFor(workspaceId);
      if (releasedIdsRef.current.has(workspaceId)) {
        if (claimedGeneration !== undefined) {
          retireRuntimeOwnerClaim(workspaceId, claimedGeneration);
        }
        return "released";
      }

      const ownershipGeneration = ownedGenerationByIdRef.current[workspaceId];
      if (ownershipGeneration === undefined) {
        const outcome = await unregisterIfUnused(workspaceId);
        if (outcome === "released" && claimedGeneration !== undefined) {
          retireRuntimeOwnerClaim(workspaceId, claimedGeneration);
        }
        return outcome;
      }

      releaseGenerationByIdRef.current[workspaceId] = ownershipGeneration;
      const outcome = await unregisterIfUnused(workspaceId, ownershipGeneration);
      if (outcome === "released") {
        retireRuntimeOwnerClaim(workspaceId, ownershipGeneration);
      }
      return outcome;
    },
    [
      ownedGenerationByIdRef,
      releasedIdsRef,
      releaseGenerationByIdRef,
      retireRuntimeOwnerClaim,
      runtimeOwnerClaimsRef,
      unregisterIfUnused,
    ],
  );

  const withManagedLease = useCallback(
    async (
      descriptor: WorkspaceIdentityDescriptor,
      useLease: (adopt: () => void) => Promise<void>,
    ): Promise<void> => {
      const lease = beginAdmission(descriptor.workspaceId);
      await withWorkspaceIdentityLease(
        descriptor,
        () => releaseAdmission(lease),
        (adoptLease) =>
          useLease(() => {
            adoptAdmission(lease);
            adoptLease();
          }),
      );
    },
    [adoptAdmission, beginAdmission, releaseAdmission],
  );

  return {
    flushDeferredCleanup,
    releaseOwned,
    withManagedLease,
  };
}
