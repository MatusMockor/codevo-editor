import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type {
  WorkspaceAdmissionAdoptionResult,
  WorkspaceIdentityDescriptor,
  WorkspaceIdentityGateway,
  WorkspaceIdentityReleaseOwner,
  WorkspaceOwnerReleaseResult,
} from "../workspaceIdentityGatewayPort";
import type {
  WorkspaceIdentityReleaseDeferral,
  WorkspaceIdentityReleaseOutcome,
} from "../useWorkbenchCloseLifecycle";
import {
  createCancellableWorkspaceRetryScheduler,
  retryWhileWorkspaceReleasing,
  WORKSPACE_RELEASE_RETRY_DELAYS_MS,
  WORKSPACE_RELEASE_STILL_IN_PROGRESS,
  type CancellableWorkspaceRetryScheduler,
  type WorkspaceReleaseRetryDelay,
} from "../workspaceReleaseRetry";
import { withWorkspaceIdentityLease } from "./workspaceIdentityPolicy";
import type { WorkspaceRequestTokenRegistry } from "./workspaceRequestTokenRegistry";

type BackendReleaseDisposition = "released" | "retained" | "stale";

type AdmissionAdoptionOutcome = "adopted" | "rejected" | "unresolved";

export const MAX_PENDING_ADMISSION_ROLLBACKS = 16;

export const ADMISSION_ADOPTION_UNRESOLVED =
  "Workspace admission adoption did not settle; the reopened admission was left for the backend.";

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
  flushCompensations: () => Promise<void>;
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
  readonly releaseRetryDelay?: WorkspaceReleaseRetryDelay;
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
  releaseRetryDelay,
}: ManagedWorkspaceIdentityOwnershipOptions) {
  const retrySchedulerRef = useRef<CancellableWorkspaceRetryScheduler | null>(null);
  if (retrySchedulerRef.current === null) {
    retrySchedulerRef.current = createCancellableWorkspaceRetryScheduler();
  }
  const retryScheduler = retrySchedulerRef.current;
  useEffect(() => {
    retryScheduler.activate();
    return () => retryScheduler.cancelAll();
  }, [retryScheduler]);
  const retryDelay = releaseRetryDelay ?? retryScheduler.delay;
  const isRetryCurrent = useCallback(
    () => mountedRef.current && retryScheduler.isActive(),
    [mountedRef, retryScheduler],
  );
  const pendingRollbacksRef = useRef(new Map<string, WorkspaceIdentityDescriptor>());
  const compensationFlushScheduledRef = useRef(false);
  const ownedAuthorityByIdRef = useRef<Record<string, WorkspaceIdentityAdmissionAuthority>>({});
  const deferredReleaseOwnerByIdRef = useRef<Record<string, WorkspaceIdentityReleaseOwner>>({});
  const releaseUntilSettled = useCallback(
    async (owner: WorkspaceIdentityReleaseOwner): Promise<WorkspaceOwnerReleaseResult | null> => {
      const outcome = await retryWhileWorkspaceReleasing({
        attempt: () => identityGateway.unregister(owner),
        delay: retryDelay,
        isCurrent: isRetryCurrent,
        isReleasing: (result) => result.status === "releasing",
      });
      switch (outcome.kind) {
        case "settled":
          return outcome.result;
        case "abandoned":
          return null;
        case "exhausted":
          throw new Error(WORKSPACE_RELEASE_STILL_IN_PROGRESS);
        default: {
          const unsupported: never = outcome;
          return unsupported;
        }
      }
    },
    [identityGateway, isRetryCurrent, retryDelay],
  );

  const rollbackOnce = useCallback(
    async (descriptor: WorkspaceIdentityDescriptor): Promise<boolean> => {
      const result = await identityGateway.rollbackAdmission(descriptor);
      return result.status !== "releasing";
    },
    [identityGateway],
  );

  const flushCompensationsFor = useCallback(
    async (workspaceId: string | null): Promise<readonly unknown[]> => {
      const failures: unknown[] = [];
      for (const [key, descriptor] of [...pendingRollbacksRef.current]) {
        if (workspaceId !== null && descriptor.workspaceId !== workspaceId) continue;
        try {
          if (await rollbackOnce(descriptor)) pendingRollbacksRef.current.delete(key);
        } catch (error) {
          failures.push(error);
        }
      }
      return failures;
    },
    [rollbackOnce],
  );

  const scheduleCompensationFlush = useCallback(() => {
    if (compensationFlushScheduledRef.current) return;
    compensationFlushScheduledRef.current = true;
    void (async () => {
      for (const delayMs of WORKSPACE_RELEASE_RETRY_DELAYS_MS) {
        await retryDelay(delayMs);
        if (!isRetryCurrent()) break;
        await flushCompensationsFor(null);
        if (pendingRollbacksRef.current.size === 0) break;
      }
      compensationFlushScheduledRef.current = false;
    })();
  }, [flushCompensationsFor, isRetryCurrent, retryDelay]);

  const compensateRollback = useCallback(
    (descriptor: WorkspaceIdentityDescriptor): void => {
      const key = `${descriptor.workspaceId}:${descriptor.admissionToken ?? "legacy"}`;
      if (
        !pendingRollbacksRef.current.has(key) &&
        pendingRollbacksRef.current.size >= MAX_PENDING_ADMISSION_ROLLBACKS
      ) {
        reportError(
          "Workspace",
          new Error(
            `Workspace admission rollback queue is full; ${descriptor.workspaceId} was not queued.`,
          ),
        );
        return;
      }
      pendingRollbacksRef.current.set(key, descriptor);
      scheduleCompensationFlush();
    },
    [reportError, scheduleCompensationFlush],
  );

  const rollbackOrCompensate = useCallback(
    async (descriptor: WorkspaceIdentityDescriptor): Promise<void> => {
      try {
        const outcome = await retryWhileWorkspaceReleasing({
          attempt: () => identityGateway.rollbackAdmission(descriptor),
          delay: retryDelay,
          isCurrent: isRetryCurrent,
          isReleasing: (result) => result.status === "releasing",
        });
        if (outcome.kind === "settled") return;
      } catch {
        compensateRollback(descriptor);
        return;
      }
      compensateRollback(descriptor);
    },
    [compensateRollback, identityGateway, isRetryCurrent, retryDelay],
  );

  const flushCompensationsBeforeRelease = useCallback(
    async (workspaceId: string): Promise<void> => {
      const failures = await flushCompensationsFor(workspaceId);
      for (const failure of failures) {
        if (mountedRef.current) reportError("Workspace", failure);
      }
    },
    [flushCompensationsFor, mountedRef, reportError],
  );
  const unregisterIfUnused = useCallback(
    async (
      workspaceId: string,
      requestedOwner: WorkspaceIdentityReleaseOwner | null,
      requestedReleaseGeneration?: number,
    ): Promise<WorkspaceIdentityReleaseOutcome> => {
      if (releasedIdsRef.current.has(workspaceId)) {
        return "released";
      }
      const releaseOwner =
        requestedOwner ?? deferredReleaseOwnerByIdRef.current[workspaceId] ?? null;
      const deferCleanup = () => {
        deferredCleanupIdsRef.current.add(workspaceId);
        if (releaseOwner === null) return;
        deferredReleaseOwnerByIdRef.current[workspaceId] = releaseOwner;
      };
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

      if (identityRequestTokensRef.current.hasPending() || releaseOwner === null) {
        deferCleanup();
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

      const request = releaseUntilSettled(releaseOwner);
      const settled = request.then(() => undefined);
      settled.catch(() => undefined);
      deferredCleanupIdsRef.current.delete(workspaceId);
      delete deferredReleaseOwnerByIdRef.current[workspaceId];
      unregisterByIdRef.current[workspaceId] = settled;
      let requestStillCurrent = true;
      let result: WorkspaceOwnerReleaseResult | null;
      try {
        result = await request;
      } finally {
        if (unregisterByIdRef.current[workspaceId] !== settled) {
          requestStillCurrent = false;
        }
        if (requestStillCurrent) {
          delete unregisterByIdRef.current[workspaceId];
        }
      }
      if (!requestStillCurrent) {
        return "deferred";
      }
      if (result === null) {
        deferCleanup();
        return "deferred";
      }
      const disposition = backendReleaseDisposition(result);
      if (disposition === "stale") {
        if (releaseGenerationByIdRef.current[workspaceId] === releaseGeneration) {
          delete releaseGenerationByIdRef.current[workspaceId];
        }
        return "stale";
      }
      if (identityRequestTokensRef.current.hasPending()) {
        deferCleanup();
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
        return disposition;
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
      return disposition;
    },
    [
      deferredCleanupIdsRef,
      identityRequestTokensRef,
      ownedGenerationByIdRef,
      ownedIdsRef,
      pendingAdmissionsRef,
      releaseUntilSettled,
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
      void unregisterIfUnused(workspaceId, null).catch((error) => {
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

  const canAdoptAdmission = useCallback(
    (authority: WorkspaceIdentityAdmissionAuthority): boolean =>
      pendingAdmissionsRef.current[authority.workspaceId]?.has(authority.generation) === true &&
      latestAdmissionGenerationByIdRef.current[authority.workspaceId] === authority.generation &&
      descriptorMatchesAuthority(authority),
    [latestAdmissionGenerationByIdRef, pendingAdmissionsRef],
  );

  const commitAdmission = useCallback(
    (authority: WorkspaceIdentityAdmissionAuthority): void => {
      const pending = pendingAdmissionsRef.current[authority.workspaceId];
      pending?.delete(authority.generation);
      if (pending?.size === 0) {
        delete pendingAdmissionsRef.current[authority.workspaceId];
      }
      ownedIdsRef.current.add(authority.workspaceId);
      releasedIdsRef.current.delete(authority.workspaceId);
      ownedGenerationByIdRef.current[authority.workspaceId] = authority.generation;
      ownedAuthorityByIdRef.current[authority.workspaceId] = authority;
    },
    [ownedGenerationByIdRef, ownedIdsRef, pendingAdmissionsRef, releasedIdsRef],
  );

  const adoptAdmission = useCallback(
    async (authority: WorkspaceIdentityAdmissionAuthority): Promise<AdmissionAdoptionOutcome> => {
      if (!canAdoptAdmission(authority)) return "rejected";
      const owned = ownedAuthorityByIdRef.current[authority.workspaceId];
      const replacedToken = owned?.admissionToken ?? null;
      const newToken = authority.admissionToken;
      if (replacedToken === null || newToken === null || replacedToken === newToken) {
        commitAdmission(authority);
        return "adopted";
      }
      const outcome = await retryWhileWorkspaceReleasing({
        attempt: () =>
          identityGateway.adoptAdmission({
            workspaceId: authority.workspaceId,
            newToken,
            replacedToken,
          }),
        delay: retryDelay,
        isCurrent: isRetryCurrent,
        isReleasing: (result) => result.status === "releasing",
        onFailure: "retryUnknownOutcome",
      });
      if (outcome.kind !== "settled") return "unresolved";
      if (!admissionAdopted(outcome.result.status)) return "rejected";
      if (!isRetryCurrent() || !canAdoptAdmission(authority)) return "rejected";
      if (ownedAuthorityByIdRef.current[authority.workspaceId] !== owned) return "rejected";
      commitAdmission(authority);
      return "adopted";
    },
    [canAdoptAdmission, commitAdmission, identityGateway, isRetryCurrent, retryDelay],
  );

  const settleUnresolvedAdmission = useCallback(
    (authority: WorkspaceIdentityAdmissionAuthority): void => {
      const pending = pendingAdmissionsRef.current[authority.workspaceId];
      pending?.delete(authority.generation);
      if (pending?.size === 0) {
        delete pendingAdmissionsRef.current[authority.workspaceId];
      }
      const owned = ownedAuthorityByIdRef.current[authority.workspaceId];
      if (
        latestAdmissionGenerationByIdRef.current[authority.workspaceId] !== authority.generation
      ) {
        return;
      }
      if (!owned) {
        delete latestAdmissionGenerationByIdRef.current[authority.workspaceId];
        return;
      }
      latestAdmissionGenerationByIdRef.current[authority.workspaceId] = owned.generation;
    },
    [latestAdmissionGenerationByIdRef, pendingAdmissionsRef],
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
      if (authority.admissionToken === null) {
        await unregisterIfUnused(authority.workspaceId, releaseOwnerFor(authority));
        return;
      }
      await rollbackOrCompensate(authority.descriptor);
      const owned = ownedAuthorityByIdRef.current[authority.workspaceId];
      if (owned && latestAdmissionGenerationByIdRef.current[authority.workspaceId] === undefined) {
        latestAdmissionGenerationByIdRef.current[authority.workspaceId] = owned.generation;
      }
    },
    [
      latestAdmissionGenerationByIdRef,
      pendingAdmissionsRef,
      rollbackOrCompensate,
      unregisterIfUnused,
    ],
  );

  const abandonDeferredReleaseIfRequested = useCallback(
    (
      workspaceId: string,
      outcome: WorkspaceIdentityReleaseOutcome,
      deferral: WorkspaceIdentityReleaseDeferral,
      ownershipGeneration: number | undefined,
    ): void => {
      if (outcome !== "deferred" || deferral !== "abandonWhenDeferred") return;
      deferredCleanupIdsRef.current.delete(workspaceId);
      delete deferredReleaseOwnerByIdRef.current[workspaceId];
      if (
        ownershipGeneration !== undefined &&
        releaseGenerationByIdRef.current[workspaceId] === ownershipGeneration
      ) {
        delete releaseGenerationByIdRef.current[workspaceId];
      }
    },
    [deferredCleanupIdsRef, releaseGenerationByIdRef],
  );

  const releaseOwned = useCallback(
    async (
      workspaceId: string,
      deferral: WorkspaceIdentityReleaseDeferral,
    ): Promise<WorkspaceIdentityReleaseOutcome> => {
      await flushCompensationsBeforeRelease(workspaceId);
      const claimedGeneration = runtimeOwnerClaimsRef.current.generationFor(workspaceId);
      if (releasedIdsRef.current.has(workspaceId)) {
        if (claimedGeneration !== undefined) {
          retireRuntimeOwnerClaim(workspaceId, claimedGeneration);
        }
        return "released";
      }

      const ownershipGeneration = ownedGenerationByIdRef.current[workspaceId];
      const owned = ownedAuthorityByIdRef.current[workspaceId];
      const releaseOwner = owned ? releaseOwnerFor(owned) : null;
      if (ownershipGeneration === undefined) {
        const outcome = await unregisterIfUnused(workspaceId, releaseOwner);
        if (releasesEditorOwnership(outcome) && claimedGeneration !== undefined) {
          retireRuntimeOwnerClaim(workspaceId, claimedGeneration);
        }
        abandonDeferredReleaseIfRequested(workspaceId, outcome, deferral, undefined);
        return outcome;
      }

      releaseGenerationByIdRef.current[workspaceId] = ownershipGeneration;
      const outcome = await unregisterIfUnused(workspaceId, releaseOwner, ownershipGeneration);
      abandonDeferredReleaseIfRequested(workspaceId, outcome, deferral, ownershipGeneration);
      if (releasesEditorOwnership(outcome)) {
        if (latestAdmissionGenerationByIdRef.current[workspaceId] === ownershipGeneration) {
          delete latestAdmissionGenerationByIdRef.current[workspaceId];
        }
        retireRuntimeOwnerClaim(workspaceId, ownershipGeneration);
      }
      return outcome;
    },
    [
      abandonDeferredReleaseIfRequested,
      flushCompensationsBeforeRelease,
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
        delete deferredReleaseOwnerByIdRef.current[authority.workspaceId];
        releasedIdsRef.current.add(authority.workspaceId);
        settled = true;
        return true;
      };
      return {
        canSettleClosed: isExactOwner,
        flushCompensations: () => flushCompensationsBeforeRelease(authority.workspaceId),
        isCurrent,
        settle,
      };
    },
    [
      deferredCleanupIdsRef,
      flushCompensationsBeforeRelease,
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
      useLease: (adopt: () => Promise<boolean>) => Promise<void>,
    ): Promise<void> => {
      const authority = beginAdmission(descriptor);
      await withWorkspaceIdentityLease(
        descriptor,
        () => releaseAdmission(authority),
        (adoptLease) =>
          useLease(async () => {
            const outcome = await adoptAdmission(authority);
            switch (outcome) {
              case "adopted":
                adoptLease();
                return true;
              case "rejected":
                return false;
              case "unresolved":
                adoptLease();
                settleUnresolvedAdmission(authority);
                throw new Error(ADMISSION_ADOPTION_UNRESOLVED);
              default: {
                const unsupported: never = outcome;
                return unsupported;
              }
            }
          }),
      );
    },
    [adoptAdmission, beginAdmission, releaseAdmission, settleUnresolvedAdmission],
  );

  return {
    flushDeferredCleanup,
    prepareBackendClosedSettlement,
    releaseOwned,
    withManagedLease,
  };
}

export function releasesEditorOwnership(outcome: WorkspaceIdentityReleaseOutcome): boolean {
  switch (outcome) {
    case "released":
    case "retained":
      return true;
    case "deferred":
    case "stale":
      return false;
    default: {
      const unsupported: never = outcome;
      return unsupported;
    }
  }
}

function backendReleaseDisposition(result: WorkspaceOwnerReleaseResult): BackendReleaseDisposition {
  switch (result.status) {
    case "released":
    case "unknownWorkspace":
      return "released";
    case "retainedByOtherOwners":
      return "retained";
    case "releasing":
    case "staleOwner":
      return "stale";
    default: {
      const unsupported: never = result;
      return unsupported;
    }
  }
}

function releaseOwnerFor(
  authority: WorkspaceIdentityAdmissionAuthority,
): WorkspaceIdentityReleaseOwner | null {
  if (!authority.canonicalRoot) return null;
  return {
    workspaceId: authority.workspaceId,
    admissionToken: authority.admissionToken,
    canonicalRootPath: authority.canonicalRoot,
  };
}

function admissionAdopted(status: WorkspaceAdmissionAdoptionResult["status"]): boolean {
  switch (status) {
    case "adopted":
      return true;
    case "staleAdmission":
    case "unknownWorkspace":
    case "releasing":
      return false;
    default: {
      const unsupported: never = status;
      return unsupported;
    }
  }
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
