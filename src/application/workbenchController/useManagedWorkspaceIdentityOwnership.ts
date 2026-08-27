import { useCallback, useRef, type MutableRefObject } from "react";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import type { WorkspaceIdentityGateway } from "../workspaceIdentityGatewayPort";
import { withWorkspaceIdentityLease } from "./workspaceIdentityPolicy";
import type { WorkspaceRequestTokenRegistry } from "./workspaceRequestTokenRegistry";

type WorkspaceIdentityReleaseOutcome = "deferred" | "released";

type WorkspaceIdentityAdmissionAuthority = {
  readonly admissionToken: number | null;
  readonly canonicalRoot: string;
  readonly caseSensitive: boolean | null;
  readonly descriptor: WorkspaceIdentityDescriptor;
  readonly generation: number;
  readonly kind: "workspaceIdentityAdmission";
  readonly policyCaseSensitive: boolean;
  readonly policyUnicodeNormalization: WorkspaceIdentityDescriptor["policy"]["unicodeNormalization"];
  readonly selectedPath: string;
  readonly unicodeNormalizationPolicy: WorkspaceIdentityDescriptor["unicodeNormalizationPolicy"];
  readonly workspaceId: string;
};

export interface BackendClosedWorkspaceIdentitySettlement {
  canSettleClosed: () => boolean;
  isCurrent: () => boolean;
  settle: (settleLocalIdentity: () => void) => boolean;
}

interface ManagedWorkspaceIdentityOwnershipOptions {
  readonly deferredCleanupIdsRef: MutableRefObject<Set<string>>;
  readonly identityGateway: WorkspaceIdentityGateway;
  readonly identityRequestTokensRef: MutableRefObject<WorkspaceRequestTokenRegistry>;
  readonly latestAdmissionGenerationByIdRef: MutableRefObject<Record<string, number>>;
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
  latestAdmissionGenerationByIdRef,
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
  const ownedAuthorityByIdRef = useRef<Record<string, WorkspaceIdentityAdmissionAuthority>>({});
  const unregisterIfUnused = useCallback(
    async (
      workspaceId: string,
      requestedReleaseGeneration?: number,
    ): Promise<WorkspaceIdentityReleaseOutcome> => {
      if (releasedIdsRef.current.has(workspaceId)) {
        return "released";
      }
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

      if (identityRequestTokensRef.current.hasPending()) {
        deferredCleanupIdsRef.current.add(workspaceId);
        return "deferred";
      }

      const pendingUnregister = unregisterByIdRef.current[workspaceId];
      if (pendingUnregister) {
        await pendingUnregister;
        if (pendingAdmissionsRef.current[workspaceId]?.size) {
          return "deferred";
        }
        if (releaseGeneration === undefined && ownedIdsRef.current.has(workspaceId)) {
          return "deferred";
        }
        if (
          releaseGeneration !== undefined &&
          ownedGenerationByIdRef.current[workspaceId] !== releaseGeneration
        ) {
          return "deferred";
        }
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
      if (identityRequestTokensRef.current.hasPending()) {
        deferredCleanupIdsRef.current.add(workspaceId);
        return "deferred";
      }

      if (releaseGeneration === undefined) {
        if (
          ownedIdsRef.current.has(workspaceId) ||
          pendingAdmissionsRef.current[workspaceId]?.size
        ) {
          return "deferred";
        }
        releasedIdsRef.current.add(workspaceId);
        return "released";
      }

      if (pendingAdmissionsRef.current[workspaceId]?.size) {
        return "deferred";
      }

      if (releaseGenerationByIdRef.current[workspaceId] === releaseGeneration) {
        delete releaseGenerationByIdRef.current[workspaceId];
      }
      if (ownedGenerationByIdRef.current[workspaceId] !== releaseGeneration) {
        return "deferred";
      }

      ownedIdsRef.current.delete(workspaceId);
      delete ownedGenerationByIdRef.current[workspaceId];
      delete ownedAuthorityByIdRef.current[workspaceId];
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
    if (identityRequestTokensRef.current.hasPending()) {
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
    (descriptor: WorkspaceIdentityDescriptor): WorkspaceIdentityAdmissionAuthority => {
      const generation = nextAdmissionGenerationRef.current + 1;
      nextAdmissionGenerationRef.current = generation;
      latestAdmissionGenerationByIdRef.current[descriptor.workspaceId] = generation;
      const pending = pendingAdmissionsRef.current[descriptor.workspaceId] ?? new Set();
      pending.add(generation);
      pendingAdmissionsRef.current[descriptor.workspaceId] = pending;
      return {
        admissionToken: descriptor.admissionToken ?? null,
        canonicalRoot: descriptor.canonicalRoot,
        caseSensitive: descriptor.caseSensitive,
        descriptor,
        generation,
        kind: "workspaceIdentityAdmission",
        policyCaseSensitive: descriptor.policy.caseSensitive,
        policyUnicodeNormalization: descriptor.policy.unicodeNormalization,
        selectedPath: descriptor.selectedPath,
        unicodeNormalizationPolicy: descriptor.unicodeNormalizationPolicy,
        workspaceId: descriptor.workspaceId,
      };
    },
    [latestAdmissionGenerationByIdRef, nextAdmissionGenerationRef, pendingAdmissionsRef],
  );

  const adoptAdmission = useCallback(
    (authority: WorkspaceIdentityAdmissionAuthority): boolean => {
      const pending = pendingAdmissionsRef.current[authority.workspaceId];
      if (
        !pending?.has(authority.generation) ||
        latestAdmissionGenerationByIdRef.current[authority.workspaceId] !== authority.generation ||
        !descriptorMatchesAuthority(authority)
      ) {
        return false;
      }
      pending.delete(authority.generation);
      if (pending?.size === 0) {
        delete pendingAdmissionsRef.current[authority.workspaceId];
      }
      ownedIdsRef.current.add(authority.workspaceId);
      releasedIdsRef.current.delete(authority.workspaceId);
      ownedGenerationByIdRef.current[authority.workspaceId] = authority.generation;
      ownedAuthorityByIdRef.current[authority.workspaceId] = authority;
      return true;
    },
    [
      latestAdmissionGenerationByIdRef,
      ownedGenerationByIdRef,
      ownedIdsRef,
      pendingAdmissionsRef,
      releasedIdsRef,
    ],
  );

  const releaseAdmission = useCallback(
    async (authority: WorkspaceIdentityAdmissionAuthority) => {
      const pending = pendingAdmissionsRef.current[authority.workspaceId];
      pending?.delete(authority.generation);
      if (pending?.size === 0) {
        delete pendingAdmissionsRef.current[authority.workspaceId];
      }
      if (
        latestAdmissionGenerationByIdRef.current[authority.workspaceId] === authority.generation
      ) {
        delete latestAdmissionGenerationByIdRef.current[authority.workspaceId];
      }
      await unregisterIfUnused(authority.workspaceId);
    },
    [latestAdmissionGenerationByIdRef, pendingAdmissionsRef, unregisterIfUnused],
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
        if (latestAdmissionGenerationByIdRef.current[workspaceId] === ownershipGeneration) {
          delete latestAdmissionGenerationByIdRef.current[workspaceId];
        }
        retireRuntimeOwnerClaim(workspaceId, ownershipGeneration);
      }
      return outcome;
    },
    [
      ownedGenerationByIdRef,
      latestAdmissionGenerationByIdRef,
      releasedIdsRef,
      releaseGenerationByIdRef,
      retireRuntimeOwnerClaim,
      runtimeOwnerClaimsRef,
      unregisterIfUnused,
    ],
  );

  const prepareBackendClosedSettlement = useCallback(
    (descriptor: WorkspaceIdentityDescriptor): BackendClosedWorkspaceIdentitySettlement | null => {
      const authority = ownedAuthorityByIdRef.current[descriptor.workspaceId];
      if (!authority || !descriptorMatchesAuthority(authority, descriptor)) {
        return null;
      }
      const generation = authority.generation;
      let settled = false;
      const isExactOwner = (): boolean =>
        !settled &&
        ownedIdsRef.current.has(authority.workspaceId) &&
        ownedGenerationByIdRef.current[authority.workspaceId] === generation &&
        latestAdmissionGenerationByIdRef.current[authority.workspaceId] === generation &&
        ownedAuthorityByIdRef.current[authority.workspaceId] === authority &&
        !pendingAdmissionsRef.current[authority.workspaceId]?.size &&
        unregisterByIdRef.current[authority.workspaceId] === undefined &&
        descriptorMatchesAuthority(authority, descriptor);
      const isCurrent = (): boolean =>
        mountedRef.current && !identityRequestTokensRef.current.hasPending() && isExactOwner();
      const settle = (settleLocalIdentity: () => void): boolean => {
        if (!isExactOwner()) {
          return false;
        }
        const claimedGeneration = runtimeOwnerClaimsRef.current.generationFor(
          authority.workspaceId,
        );
        if (claimedGeneration !== undefined) {
          retireRuntimeOwnerClaim(authority.workspaceId, claimedGeneration);
        }
        identityGateway.settleClosedDescriptor?.(descriptor);
        settleLocalIdentity();
        ownedIdsRef.current.delete(authority.workspaceId);
        delete ownedGenerationByIdRef.current[authority.workspaceId];
        delete latestAdmissionGenerationByIdRef.current[authority.workspaceId];
        delete releaseGenerationByIdRef.current[authority.workspaceId];
        delete ownedAuthorityByIdRef.current[authority.workspaceId];
        deferredCleanupIdsRef.current.delete(authority.workspaceId);
        releasedIdsRef.current.add(authority.workspaceId);
        settled = true;
        return true;
      };
      return { canSettleClosed: isExactOwner, isCurrent, settle };
    },
    [
      deferredCleanupIdsRef,
      identityGateway,
      identityRequestTokensRef,
      latestAdmissionGenerationByIdRef,
      mountedRef,
      ownedGenerationByIdRef,
      ownedIdsRef,
      pendingAdmissionsRef,
      releasedIdsRef,
      releaseGenerationByIdRef,
      retireRuntimeOwnerClaim,
      runtimeOwnerClaimsRef,
      unregisterByIdRef,
    ],
  );

  const withManagedLease = useCallback(
    async (
      descriptor: WorkspaceIdentityDescriptor,
      useLease: (adopt: () => void) => Promise<void>,
    ): Promise<void> => {
      const authority = beginAdmission(descriptor);
      await withWorkspaceIdentityLease(
        descriptor,
        () => releaseAdmission(authority),
        (adoptLease) =>
          useLease(() => {
            if (!adoptAdmission(authority)) {
              return;
            }
            adoptLease();
          }),
      );
    },
    [adoptAdmission, beginAdmission, releaseAdmission],
  );

  return {
    flushDeferredCleanup,
    prepareBackendClosedSettlement,
    releaseOwned,
    withManagedLease,
  };
}

function descriptorMatchesAuthority(
  authority: WorkspaceIdentityAdmissionAuthority,
  descriptor = authority.descriptor,
): boolean {
  return (
    descriptor.workspaceId === authority.workspaceId &&
    descriptor.selectedPath === authority.selectedPath &&
    descriptor.canonicalRoot === authority.canonicalRoot &&
    (descriptor.admissionToken ?? null) === authority.admissionToken &&
    descriptor.caseSensitive === authority.caseSensitive &&
    descriptor.unicodeNormalizationPolicy === authority.unicodeNormalizationPolicy &&
    descriptor.policy.caseSensitive === authority.policyCaseSensitive &&
    descriptor.policy.unicodeNormalization === authority.policyUnicodeNormalization
  );
}
