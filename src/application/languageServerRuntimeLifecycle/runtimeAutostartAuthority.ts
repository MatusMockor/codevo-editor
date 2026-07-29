import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type {
  WorkspaceRuntimeOwner,
  WorkspaceRuntimeOwnerKey,
} from "../../domain/workspaceRuntimeOwner";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import type { LanguageServerRuntimeStatusFence } from "./runtimeOwnerAuthority";

export const PHP_AUTOSTART_ATTEMPT_RETENTION_LIMIT = 32;

export interface RuntimeAutostartLease {
  readonly sequence: number;
  readonly ownerKey: WorkspaceRuntimeOwnerKey;
  cancelled?: boolean;
  settlement?: RetainedAutostartSettlement;
}

export interface RetainedAutostartSettlement {
  readonly fence?: LanguageServerRuntimeStatusFence;
  readonly revision: number;
  readonly status: LanguageServerRuntimeStatus;
}

interface StopBarrierReconciliation {
  readonly getStatus: () => Promise<LanguageServerRuntimeStatus>;
  readonly isCurrent: () => boolean;
  readonly publishObservedStatus: (status: LanguageServerRuntimeStatus) => void;
  readonly releaseBarrier: () => void;
  readonly stop: () => Promise<LanguageServerRuntimeStatus | null>;
}

export async function reconcileStopBarrier({
  getStatus,
  isCurrent,
  publishObservedStatus,
  releaseBarrier,
  stop,
}: StopBarrierReconciliation): Promise<void> {
  const status = await stop();
  if (status?.kind === "stopped") {
    releaseBarrier();
    return;
  }

  if (!isCurrent()) {
    return;
  }

  const observedStatus = await getStatus().catch(() => null);
  if (!observedStatus || !isCurrent()) {
    return;
  }

  publishObservedStatus(observedStatus);
  if (observedStatus.kind === "stopped") {
    releaseBarrier();
    return;
  }

  if (!isCurrent()) {
    return;
  }

  const retryStatus = await stop();
  if (retryStatus?.kind === "stopped") {
    releaseBarrier();
  }
}

export function useRuntimeAutostartAuthority(
  currentOwner: WorkspaceRuntimeOwner | null,
  phpEligible: boolean,
  javaScriptTypeScriptEligible: boolean,
  phpOwnerRef: MutableRefObject<string | null>,
  javaScriptTypeScriptOwnerRef: MutableRefObject<string | null>,
) {
  const nextSequenceRef = useRef(0);
  const phpLeaseRef = useRef<RuntimeAutostartLease | null>(null);
  const javaScriptTypeScriptLeaseRef = useRef<RuntimeAutostartLease | null>(null);
  const previousOwnerRef = useRef(currentOwner);
  const phpEligibleRef = useRef(phpEligible);
  const javaScriptTypeScriptEligibleRef = useRef(javaScriptTypeScriptEligible);
  const [phpAuthorityVersion, setPhpAuthorityVersion] = useState(0);
  const [javaScriptTypeScriptAuthorityVersion, setJavaScriptTypeScriptAuthorityVersion] =
    useState(0);
  phpEligibleRef.current = phpEligible;
  javaScriptTypeScriptEligibleRef.current = javaScriptTypeScriptEligible;

  useEffect(() => {
    const previousOwner = previousOwnerRef.current;
    previousOwnerRef.current = currentOwner;

    if (
      previousOwner &&
      autostartLeaseCleanupAction(previousOwner, currentOwner) === "cancel-release"
    ) {
      phpLeaseRef.current = null;
      javaScriptTypeScriptLeaseRef.current = null;
      phpOwnerRef.current = null;
      javaScriptTypeScriptOwnerRef.current = null;
    }
  }, [currentOwner, javaScriptTypeScriptOwnerRef, phpOwnerRef]);

  useEffect(
    () => () => {
      phpLeaseRef.current = null;
      javaScriptTypeScriptLeaseRef.current = null;
      phpOwnerRef.current = null;
      javaScriptTypeScriptOwnerRef.current = null;
    },
    [javaScriptTypeScriptOwnerRef, phpOwnerRef],
  );

  const acquirePhpLease = useCallback(
    (ownerKey: WorkspaceRuntimeOwnerKey): RuntimeAutostartLease => {
      const lease = {
        cancelled: false,
        ownerKey,
        sequence: nextSequenceRef.current + 1,
      };
      nextSequenceRef.current = lease.sequence;
      phpLeaseRef.current = lease;
      phpOwnerRef.current = ownerKey;
      return lease;
    },
    [phpOwnerRef],
  );

  const acquireJavaScriptTypeScriptLease = useCallback(
    (ownerKey: WorkspaceRuntimeOwnerKey): RuntimeAutostartLease => {
      const lease = {
        cancelled: false,
        ownerKey,
        sequence: nextSequenceRef.current + 1,
      };
      nextSequenceRef.current = lease.sequence;
      javaScriptTypeScriptLeaseRef.current = lease;
      javaScriptTypeScriptOwnerRef.current = ownerKey;
      return lease;
    },
    [javaScriptTypeScriptOwnerRef],
  );

  const isPhpLeaseCurrent = useCallback(
    (lease: RuntimeAutostartLease) => phpLeaseRef.current === lease,
    [],
  );

  const isJavaScriptTypeScriptLeaseCurrent = useCallback(
    (lease: RuntimeAutostartLease) => javaScriptTypeScriptLeaseRef.current === lease,
    [],
  );

  const isPhpLeaseCancelled = useCallback(
    (lease: RuntimeAutostartLease) => lease.cancelled === true,
    [],
  );

  const isJavaScriptTypeScriptLeaseCancelled = useCallback(
    (lease: RuntimeAutostartLease) => lease.cancelled === true,
    [],
  );

  const releasePhpLease = useCallback(
    (lease: RuntimeAutostartLease) => {
      if (phpLeaseRef.current !== lease) {
        return;
      }

      const notify = lease.cancelled;
      phpLeaseRef.current = null;
      if (phpOwnerRef.current === lease.ownerKey) {
        phpOwnerRef.current = null;
      }
      if (notify) {
        setPhpAuthorityVersion((current) => current + 1);
      }
    },
    [phpOwnerRef],
  );

  const releaseJavaScriptTypeScriptLease = useCallback(
    (lease: RuntimeAutostartLease) => {
      if (javaScriptTypeScriptLeaseRef.current !== lease) {
        return;
      }

      const notify = lease.cancelled;
      javaScriptTypeScriptLeaseRef.current = null;
      if (javaScriptTypeScriptOwnerRef.current === lease.ownerKey) {
        javaScriptTypeScriptOwnerRef.current = null;
      }
      if (notify) {
        setJavaScriptTypeScriptAuthorityVersion((current) => current + 1);
      }
    },
    [javaScriptTypeScriptOwnerRef],
  );

  const invalidatePhpLeaseForOwner = useCallback(
    (ownerKey: WorkspaceRuntimeOwnerKey) => {
      const lease = phpLeaseRef.current;
      if (lease?.ownerKey === ownerKey) {
        releasePhpLease(lease);
      }
    },
    [releasePhpLease],
  );

  const invalidateJavaScriptTypeScriptLeaseForOwner = useCallback(
    (ownerKey: WorkspaceRuntimeOwnerKey) => {
      const lease = javaScriptTypeScriptLeaseRef.current;
      if (lease?.ownerKey === ownerKey) {
        releaseJavaScriptTypeScriptLease(lease);
      }
    },
    [releaseJavaScriptTypeScriptLease],
  );

  const retainPhpSettlement = useCallback(
    (lease: RuntimeAutostartLease, settlement: RetainedAutostartSettlement) => {
      if (phpLeaseRef.current === lease) {
        lease.settlement = settlement;
        setPhpAuthorityVersion((current) => current + 1);
      }
    },
    [],
  );

  const retainJavaScriptTypeScriptSettlement = useCallback(
    (lease: RuntimeAutostartLease, settlement: RetainedAutostartSettlement) => {
      if (javaScriptTypeScriptLeaseRef.current === lease) {
        lease.settlement = settlement;
        setJavaScriptTypeScriptAuthorityVersion((current) => current + 1);
      }
    },
    [],
  );

  const takePhpSettlementForOwner = useCallback((ownerKey: WorkspaceRuntimeOwnerKey) => {
    const lease = phpLeaseRef.current;
    if (lease?.ownerKey !== ownerKey) {
      return null;
    }

    const settlement = lease.settlement ?? null;
    delete lease.settlement;
    return settlement;
  }, []);

  const takeJavaScriptTypeScriptSettlementForOwner = useCallback(
    (ownerKey: WorkspaceRuntimeOwnerKey) => {
      const lease = javaScriptTypeScriptLeaseRef.current;
      if (lease?.ownerKey !== ownerKey) {
        return null;
      }

      const settlement = lease.settlement ?? null;
      delete lease.settlement;
      return settlement;
    },
    [],
  );

  const cancelPhpLease = useCallback((lease: RuntimeAutostartLease) => {
    if (phpLeaseRef.current === lease) {
      lease.cancelled = true;
    }
  }, []);

  const cancelJavaScriptTypeScriptLease = useCallback((lease: RuntimeAutostartLease) => {
    if (javaScriptTypeScriptLeaseRef.current === lease) {
      lease.cancelled = true;
    }
  }, []);

  const cancelPhpLeaseForOwner = useCallback((ownerKey: WorkspaceRuntimeOwnerKey) => {
    const lease = phpLeaseRef.current;
    if (lease?.ownerKey === ownerKey) {
      lease.cancelled = true;
    }
  }, []);

  const cancelJavaScriptTypeScriptLeaseForOwner = useCallback(
    (ownerKey: WorkspaceRuntimeOwnerKey) => {
      const lease = javaScriptTypeScriptLeaseRef.current;
      if (lease?.ownerKey === ownerKey) {
        lease.cancelled = true;
      }
    },
    [],
  );

  const isPhpEligible = useCallback(() => phpEligibleRef.current, []);
  const isJavaScriptTypeScriptEligible = useCallback(
    () => javaScriptTypeScriptEligibleRef.current,
    [],
  );

  return {
    acquireJavaScriptTypeScriptLease,
    acquirePhpLease,
    javaScriptTypeScriptAuthorityVersion,
    phpAuthorityVersion,
    cancelJavaScriptTypeScriptLease,
    cancelJavaScriptTypeScriptLeaseForOwner,
    cancelPhpLease,
    cancelPhpLeaseForOwner,
    isJavaScriptTypeScriptLeaseCurrent,
    isJavaScriptTypeScriptLeaseCancelled,
    isPhpLeaseCurrent,
    isPhpLeaseCancelled,
    isJavaScriptTypeScriptEligible,
    isPhpEligible,
    invalidateJavaScriptTypeScriptLeaseForOwner,
    invalidatePhpLeaseForOwner,
    retainJavaScriptTypeScriptSettlement,
    retainPhpSettlement,
    releaseJavaScriptTypeScriptLease,
    releasePhpLease,
    takeJavaScriptTypeScriptSettlementForOwner,
    takePhpSettlementForOwner,
  };
}

export type AutostartLeaseCleanupAction = "retain" | "cancel-retain" | "cancel-release";

export function autostartLeaseCleanupAction(
  requestedOwner: WorkspaceRuntimeOwner,
  latestOwner: WorkspaceRuntimeOwner | null,
): AutostartLeaseCleanupAction {
  if (!latestOwner) {
    return "cancel-release";
  }

  if (latestOwner === requestedOwner) {
    return "cancel-retain";
  }

  const isAliasTransfer =
    latestOwner.ownerKey === requestedOwner.ownerKey &&
    !workspaceRootKeysEqual(latestOwner.executionRoot, requestedOwner.executionRoot);

  return isAliasTransfer ? "retain" : "cancel-release";
}

export function cleanUpAutostartLease(
  requestedOwner: WorkspaceRuntimeOwner,
  latestOwner: WorkspaceRuntimeOwner | null,
  retainAllowed: boolean,
  cancel: () => void,
  release: () => void,
): void {
  const action = autostartLeaseCleanupAction(requestedOwner, latestOwner);

  if (action === "retain" && retainAllowed) {
    return;
  }

  cancel();
  if (action === "cancel-release") {
    release();
  }
}

export function shouldIgnoreAutostartSettlement(
  cancelled: boolean,
  leaseIsCurrent: boolean,
  releaseWhenCancelled: boolean,
  release: () => void,
  retain: () => void,
): boolean {
  if (cancelled) {
    if (leaseIsCurrent && releaseWhenCancelled) {
      release();
    }
    if (leaseIsCurrent && !releaseWhenCancelled) {
      retain();
    }
    return true;
  }

  return !leaseIsCurrent;
}

export function recordPhpAutostartAttempt(
  attemptsByOwner: Record<string, number>,
  ownerKey: WorkspaceRuntimeOwnerKey,
  attempts: number,
): void {
  delete attemptsByOwner[ownerKey];
  attemptsByOwner[ownerKey] = attempts;

  const retainedOwnerKeys = Object.keys(attemptsByOwner);
  const overflow = retainedOwnerKeys.length - PHP_AUTOSTART_ATTEMPT_RETENTION_LIMIT;

  for (let index = 0; index < overflow; index += 1) {
    delete attemptsByOwner[retainedOwnerKeys[index]];
  }
}
