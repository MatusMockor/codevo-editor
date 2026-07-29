import { useEffect, type MutableRefObject } from "react";
import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import {
  cachedLanguageServerRuntimeStatusForOwner,
  type LanguageServerRuntimeStatusByOwner,
} from "../../domain/languageServerRuntimeStatusCache";
import type {
  WorkspaceRuntimeOwner,
  WorkspaceRuntimeOwnerKey,
} from "../../domain/workspaceRuntimeOwner";
import {
  isCrashedLanguageServerForWorkspace,
  isLanguageServerActiveForWorkspace,
} from "./runtimeStatusPolicy";
import {
  reconcileStopBarrier,
  type RetainedAutostartSettlement,
  type RuntimeAutostartLease,
} from "./runtimeAutostartAuthority";

interface RuntimeServiceOffLifecycleOptions {
  readonly acquireLease: (ownerKey: WorkspaceRuntimeOwnerKey) => RuntimeAutostartLease;
  readonly authorityVersion: number;
  readonly cancelLease: (lease: RuntimeAutostartLease) => void;
  readonly clearDiagnostics: (rootPath: string, owner: WorkspaceRuntimeOwner) => void;
  readonly currentOwner: WorkspaceRuntimeOwner | null;
  readonly currentOwnerRef: MutableRefObject<WorkspaceRuntimeOwner | null>;
  readonly gatewayGetStatus: (rootPath: string) => Promise<LanguageServerRuntimeStatus>;
  readonly handleStatus: (
    status: LanguageServerRuntimeStatus,
    rootPath: string,
    owner: WorkspaceRuntimeOwner,
    revision: number,
    preserveLease: boolean,
  ) => void;
  readonly invalidateLease: (ownerKey: WorkspaceRuntimeOwnerKey) => void;
  readonly isLeaseCurrent: (lease: RuntimeAutostartLease) => boolean;
  readonly isRevisionCurrent: (owner: WorkspaceRuntimeOwner, revision: number) => boolean;
  readonly leaseOwnerRef: MutableRefObject<string | null>;
  readonly ownerRevision: (owner: WorkspaceRuntimeOwner) => number;
  readonly releaseLease: (lease: RuntimeAutostartLease) => void;
  readonly resetDocuments: () => void;
  readonly service: string;
  readonly statusByOwnerRef: MutableRefObject<LanguageServerRuntimeStatusByOwner>;
  readonly stop: (
    rootPath: string,
    owner: WorkspaceRuntimeOwner,
  ) => Promise<LanguageServerRuntimeStatus | null>;
  readonly takeSettlement: (
    ownerKey: WorkspaceRuntimeOwnerKey,
  ) => RetainedAutostartSettlement | null;
}

export function useRuntimeServiceOffLifecycle(options: RuntimeServiceOffLifecycleOptions) {
  const {
    acquireLease,
    authorityVersion,
    cancelLease,
    clearDiagnostics,
    currentOwner,
    currentOwnerRef,
    gatewayGetStatus,
    handleStatus,
    invalidateLease,
    isLeaseCurrent,
    isRevisionCurrent,
    leaseOwnerRef,
    ownerRevision,
    releaseLease,
    resetDocuments,
    service,
    statusByOwnerRef,
    stop,
    takeSettlement,
  } = options;
  useEffect(() => {
    const owner = currentOwner;
    if (!owner || service !== "off") {
      return;
    }

    const rootPath = owner.executionRoot;
    const revision = ownerRevision(owner);
    const cachedStatus = cachedLanguageServerRuntimeStatusForOwner(statusByOwnerRef.current, owner);
    const settlement = takeSettlement(owner.ownerKey);
    const retainedStatus =
      settlement && isRevisionCurrent(owner, settlement.revision) ? settlement.status : null;
    const status = retainedStatus ?? cachedStatus;

    if (
      isLanguageServerActiveForWorkspace(status, status?.rootPath ?? null, rootPath) ||
      isCrashedLanguageServerForWorkspace(status, status?.rootPath ?? null, rootPath)
    ) {
      if (!settlement && leaseOwnerRef.current === owner.ownerKey) {
        return;
      }
      const barrier = acquireLease(owner.ownerKey);
      const authorityOwner = () => {
        const current = currentOwnerRef.current;
        if (!current || current.ownerKey !== owner.ownerKey || !isLeaseCurrent(barrier)) {
          return null;
        }
        return isRevisionCurrent(owner, revision) ? current : null;
      };
      const releaseBarrier = () => {
        cancelLease(barrier);
        releaseLease(barrier);
      };
      void reconcileStopBarrier({
        getStatus: () => gatewayGetStatus(authorityOwner()?.executionRoot ?? rootPath),
        isCurrent: () => authorityOwner() !== null,
        publishObservedStatus: (observed) => {
          const current = authorityOwner();
          if (current) {
            handleStatus(observed, current.executionRoot, current, ownerRevision(current), true);
          }
        },
        releaseBarrier,
        stop: () => {
          const current = authorityOwner();
          return current ? stop(current.executionRoot, current) : Promise.resolve(null);
        },
      });
      return;
    }

    if (settlement) {
      invalidateLease(owner.ownerKey);
    }
    clearDiagnostics(rootPath, owner);
    resetDocuments();
  }, [
    acquireLease,
    authorityVersion,
    cancelLease,
    clearDiagnostics,
    currentOwner,
    currentOwnerRef,
    gatewayGetStatus,
    handleStatus,
    invalidateLease,
    isLeaseCurrent,
    isRevisionCurrent,
    leaseOwnerRef,
    ownerRevision,
    releaseLease,
    resetDocuments,
    service,
    statusByOwnerRef,
    stop,
    takeSettlement,
  ]);
}
