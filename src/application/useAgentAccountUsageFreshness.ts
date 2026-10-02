import { useEffect, useRef, useState } from "react";
import type { AgentAccountUsageLoadState } from "../domain/agentAccountUsage";
import { agentAccountUsageStaleness } from "../domain/agentAccountUsageFreshness";
import type { AgentAccountUsageRefreshOutcome } from "./agentAccountUsageRefresh";

type UsageProvider = "claudeCode" | "codex";

const PROVIDERS: ReadonlyArray<UsageProvider> = ["claudeCode", "codex"];
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_REFRESH_ATTEMPTS = 2;
const FAILED_REFRESH_RETRY_MS = 5 * 60_000;

interface RefreshAttempt {
  readonly count: number;
  readonly retryAtEpochMs: number | null;
}

export interface AgentAccountUsageFreshnessOptions {
  readonly accountUsage: Readonly<Record<UsageProvider, AgentAccountUsageLoadState>>;
  readonly readiness: Readonly<Record<UsageProvider, boolean>>;
  readonly refresh: (provider: UsageProvider) => Promise<AgentAccountUsageRefreshOutcome>;
  readonly now?: () => number;
}

export function useAgentAccountUsageFreshness({
  accountUsage,
  readiness,
  refresh,
  now = Date.now,
}: AgentAccountUsageFreshnessOptions): void {
  const [restoredFetchedAt] = useState(() => readyFetchedAt(accountUsage));
  const attemptsRef = useRef(new Map<string, RefreshAttempt>());
  const [recheck, setRecheck] = useState(0);
  const claudeReady = readiness.claudeCode;
  const codexReady = readiness.codex;

  useEffect(() => {
    const nowEpochMs = now();
    const ready: Readonly<Record<UsageProvider, boolean>> = {
      claudeCode: claudeReady,
      codex: codexReady,
    };
    let recheckAtEpochMs: number | null = null;
    for (const provider of PROVIDERS) {
      const state = accountUsage[provider];
      if (state.kind !== "ready") continue;
      const restored = state.snapshot.fetchedAtEpochMs === restoredFetchedAt[provider];
      const staleness = agentAccountUsageStaleness(state.snapshot, nowEpochMs, restored);
      if (staleness.kind === "fresh") {
        recheckAtEpochMs = earliest(recheckAtEpochMs, staleness.recheckAtEpochMs);
        continue;
      }
      const key = `${provider}:${staleness.key}`;
      const attempts = attemptsRef.current;
      const previous = attempts.get(key);
      if (previous?.retryAtEpochMs === null) continue;
      if (previous !== undefined && previous.retryAtEpochMs > nowEpochMs) {
        recheckAtEpochMs = earliest(recheckAtEpochMs, previous.retryAtEpochMs);
        continue;
      }
      if (!ready[provider]) continue;
      const count = (previous?.count ?? 0) + 1;
      attempts.set(key, { count, retryAtEpochMs: null });
      const settle = (outcome: AgentAccountUsageRefreshOutcome): void => {
        switch (outcome.kind) {
          case "refreshed":
            return;
          case "unavailable":
          case "superseded":
            attempts.delete(key);
            return;
          case "failed":
            if (count >= MAX_REFRESH_ATTEMPTS) return;
            attempts.set(key, { count, retryAtEpochMs: now() + FAILED_REFRESH_RETRY_MS });
            setRecheck((value) => value + 1);
            return;
          default:
            outcome satisfies never;
        }
      };
      void refresh(provider).then(settle, () => settle({ kind: "failed" }));
    }
    if (recheckAtEpochMs === null) return;
    const delayMs = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, recheckAtEpochMs - nowEpochMs));
    const timer = setTimeout(() => setRecheck((value) => value + 1), delayMs);
    return () => clearTimeout(timer);
  }, [accountUsage, claudeReady, codexReady, now, recheck, refresh, restoredFetchedAt]);
}

function readyFetchedAt(
  accountUsage: Readonly<Record<UsageProvider, AgentAccountUsageLoadState>>,
): Readonly<Record<UsageProvider, number | null>> {
  const fetchedAt = (provider: UsageProvider): number | null => {
    const state = accountUsage[provider];
    return state.kind === "ready" ? state.snapshot.fetchedAtEpochMs : null;
  };
  return { claudeCode: fetchedAt("claudeCode"), codex: fetchedAt("codex") };
}

function earliest(current: number | null, candidate: number | null): number | null {
  if (candidate === null) return current;
  if (current === null) return candidate;
  return Math.min(current, candidate);
}
