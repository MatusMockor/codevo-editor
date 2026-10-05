import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  mergeAgentAccountUsageObservation,
  type AgentAccountUsageLoadState,
  type AgentAccountUsageObservation,
  type AgentAccountUsageSnapshot,
  type AgentAccountUsageStoreGateway,
  type AgentAccountUsageStoreChange,
} from "../domain/agentAccountUsage";
import {
  mergeAgentAccountUsageRefresh,
  resolveAgentAccountUsageResets,
} from "../domain/agentAccountUsageFreshness";

type Provider = "claudeCode" | "codex";
type UsageStates = Readonly<Record<Provider, AgentAccountUsageLoadState>>;
type UsageStore = Partial<AgentAccountUsageStoreGateway>;

export function useAgentAccountUsage(gateway: UsageStore) {
  const [accountUsage, setAccountUsage] = useState<UsageStates>(() => initialUsage(gateway));
  const stateRef = useRef(accountUsage);
  const gatewayRef = useRef(gateway);
  const lease = useMemo(() => ({ gateway, active: false }), [gateway]);
  const publish = useCallback((snapshot: AgentAccountUsageSnapshot): boolean => {
    const current = stateRef.current[snapshot.provider];
    if (current.kind === "ready") {
      if (snapshot.fetchedAtEpochMs < current.snapshot.fetchedAtEpochMs) return false;
      if (JSON.stringify(snapshot) === JSON.stringify(current.snapshot)) return false;
    }
    const next = {
      ...stateRef.current,
      [snapshot.provider]: { kind: "ready" as const, snapshot },
    };
    stateRef.current = next;
    setAccountUsage(next);
    return true;
  }, []);
  const clear = useCallback((provider: Provider): void => {
    const next = { ...stateRef.current, [provider]: { kind: "idle" as const } };
    stateRef.current = next;
    setAccountUsage(next);
  }, []);

  useLayoutEffect(() => {
    lease.active = true;
    if (gatewayRef.current !== gateway) {
      gatewayRef.current = gateway;
      stateRef.current = initialUsage(gateway);
      setAccountUsage(stateRef.current);
    }
    const accept = (change: AgentAccountUsageStoreChange): void => {
      if (!lease.active) return;
      if (change.kind === "snapshot") publish(resolveAgentAccountUsageResets(change.snapshot));
      else clear(change.provider);
    };
    const unsubscribe = gateway.subscribeAgentAccountUsage?.(accept);
    try {
      // Closes the initial-render/subscription gap for another workspace's update.
      for (const snapshot of gateway.loadAgentAccountUsage?.() ?? []) {
        accept({ kind: "snapshot", snapshot });
      }
    } catch {
      // Live subscriptions remain usable when persisted storage cannot be read.
    }
    return () => {
      lease.active = false;
      unsubscribe?.();
    };
  }, [clear, gateway, lease, publish]);

  const save = useCallback(
    (snapshot: AgentAccountUsageSnapshot): void => {
      if (!lease.active || !publish(snapshot)) return;
      try {
        gateway.saveAgentAccountUsage?.(snapshot);
      } catch {
        // Persistence must not affect a completed turn or its live observation.
      }
    },
    [gateway, lease, publish],
  );
  const recordAccountUsage = useCallback(
    (observation: AgentAccountUsageObservation): void => {
      if (!lease.active) return;
      const current = stateRef.current[observation.provider];
      save(
        resolveAgentAccountUsageResets(
          mergeAgentAccountUsageObservation(
            current.kind === "ready" ? current.snapshot : null,
            observation,
            Date.now(),
          ),
        ),
      );
    },
    [lease, save],
  );
  const captureUsage = useCallback((provider: Provider) => stateRef.current[provider], []);
  const publishRefresh = useCallback(
    (snapshot: AgentAccountUsageSnapshot, expected: AgentAccountUsageLoadState): boolean => {
      const current = stateRef.current[snapshot.provider];
      // A live/shared observation received during the poll has newer authority.
      if (!lease.active || current !== expected) return false;
      if (
        current.kind === "ready" &&
        snapshot.fetchedAtEpochMs < current.snapshot.fetchedAtEpochMs
      ) {
        return false;
      }
      save(
        mergeAgentAccountUsageRefresh(current.kind === "ready" ? current.snapshot : null, snapshot),
      );
      return true;
    },
    [lease, save],
  );
  const invalidateAccountUsage = useCallback(
    (provider: Provider): void => {
      if (!lease.active) return;
      clear(provider);
      try {
        gateway.invalidateAgentAccountUsage?.(provider);
      } catch {
        // The local account authority still changes when persistence is unavailable.
      }
    },
    [clear, gateway, lease],
  );
  return { accountUsage, recordAccountUsage, captureUsage, publishRefresh, invalidateAccountUsage };
}

function initialUsage(gateway: UsageStore): UsageStates {
  const state: Record<Provider, AgentAccountUsageLoadState> = {
    claudeCode: { kind: "idle" },
    codex: { kind: "idle" },
  };
  try {
    for (const snapshot of gateway.loadAgentAccountUsage?.() ?? []) {
      state[snapshot.provider] = {
        kind: "ready",
        snapshot: resolveAgentAccountUsageResets(snapshot),
      };
    }
  } catch {
    // Live observations still populate usage when storage is unavailable.
  }
  return state;
}
