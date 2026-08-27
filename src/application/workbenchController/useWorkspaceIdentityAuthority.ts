import { useCallback, useRef } from "react";
import { LatestWorkspaceRequestTokenRegistry } from "./workspaceRequestTokenRegistry";
import { ownedAndPendingWorkspaceIdentityIds } from "./workspaceRetainedStateCleanup";

export function useWorkspaceIdentityAuthority() {
  const pendingWorkspaceIdentityRequestTokensRef = useRef(
    new LatestWorkspaceRequestTokenRegistry(),
  );
  const deferredWorkspaceIdentityCleanupIdsRef = useRef<Set<string>>(new Set());
  const workspaceIdentityAdmissionGenerationRef = useRef(0);
  const latestWorkspaceIdentityAdmissionGenerationByIdRef = useRef<Record<string, number>>({});
  const pendingWorkspaceIdentityAdmissionsRef = useRef<Record<string, Set<number>>>({});
  const ownedWorkspaceIdentityIdsRef = useRef<Set<string>>(new Set());
  const ownedWorkspaceIdentityGenerationByIdRef = useRef<Record<string, number>>({});
  const workspaceIdentityReleaseGenerationByIdRef = useRef<Record<string, number>>({});
  const releasedWorkspaceIdentityIdsRef = useRef<Set<string>>(new Set());
  const workspaceIdentityUnregisterByIdRef = useRef<Record<string, Promise<void>>>({});
  const retire = useCallback((): readonly string[] => {
    pendingWorkspaceIdentityRequestTokensRef.current.retire();
    const workspaceIds = ownedAndPendingWorkspaceIdentityIds(
      ownedWorkspaceIdentityIdsRef.current,
      pendingWorkspaceIdentityAdmissionsRef.current,
    );
    pendingWorkspaceIdentityAdmissionsRef.current = {};
    latestWorkspaceIdentityAdmissionGenerationByIdRef.current = {};
    return workspaceIds;
  }, []);

  return {
    deferredWorkspaceIdentityCleanupIdsRef,
    latestWorkspaceIdentityAdmissionGenerationByIdRef,
    ownedWorkspaceIdentityGenerationByIdRef,
    ownedWorkspaceIdentityIdsRef,
    pendingWorkspaceIdentityAdmissionsRef,
    pendingWorkspaceIdentityRequestTokensRef,
    releasedWorkspaceIdentityIdsRef,
    retire,
    workspaceIdentityAdmissionGenerationRef,
    workspaceIdentityReleaseGenerationByIdRef,
    workspaceIdentityUnregisterByIdRef,
  } as const;
}
