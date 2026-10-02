import type { AgentAccountUsageSnapshot, AgentAccountUsageWindow } from "./agentAccountUsage";
import { claudeUsageResetEpochMs, claudeUsageUpcomingResetEpochMs } from "./claudeUsageResetLabel";

export const USAGE_READING_STALE_AFTER_MS = 15 * 60_000;
export const RESET_REFRESH_GRACE_MS = 90_000;
const EARLIER_PERIOD_TOLERANCE_MS = 30 * 60_000;
const MAX_DATE_EPOCH_MS = 8.64e15;

export type AgentAccountUsageStaleness =
  | { readonly kind: "fresh"; readonly recheckAtEpochMs: number | null }
  | { readonly kind: "stale"; readonly key: string };

export function agentAccountUsageResetEpochMs(
  window: AgentAccountUsageWindow,
  referenceEpochMs: number,
): number | null {
  const epochMs = representableEpochMs(window.resetsAtEpochMs);
  if (epochMs !== null) return epochMs;
  if (window.resetsLabel === null) return null;
  return claudeUsageResetEpochMs(window.resetsLabel, referenceEpochMs);
}

function fetchedResetEpochMs(
  window: AgentAccountUsageWindow,
  fetchedAtEpochMs: number,
): number | null {
  const epochMs = representableEpochMs(window.resetsAtEpochMs);
  if (epochMs !== null) return epochMs;
  if (window.resetsLabel === null) return null;
  return claudeUsageUpcomingResetEpochMs(window.resetsLabel, fetchedAtEpochMs);
}

function representableEpochMs(epochMs: number | null): number | null {
  if (epochMs === null || !Number.isFinite(epochMs) || Math.abs(epochMs) > MAX_DATE_EPOCH_MS) {
    return null;
  }
  return epochMs;
}

export function isAgentAccountUsageWindowExpired(
  window: AgentAccountUsageWindow,
  nowEpochMs: number,
): boolean {
  const resetEpochMs = agentAccountUsageResetEpochMs(window, nowEpochMs);
  return resetEpochMs !== null && resetEpochMs <= nowEpochMs;
}

export function resolveAgentAccountUsageResets(
  snapshot: AgentAccountUsageSnapshot,
): AgentAccountUsageSnapshot {
  if (snapshot.windows.every((window) => window.resetsAtEpochMs !== null)) return snapshot;
  return {
    ...snapshot,
    windows: snapshot.windows.map((window) => {
      if (window.resetsAtEpochMs !== null) return window;
      const resetEpochMs = fetchedResetEpochMs(window, snapshot.fetchedAtEpochMs);
      if (resetEpochMs === null || !Number.isSafeInteger(resetEpochMs) || resetEpochMs < 0) {
        return window;
      }
      return { ...window, resetsAtEpochMs: resetEpochMs };
    }),
  };
}

export function isEarlierAgentAccountUsagePeriod(
  incoming: AgentAccountUsageWindow,
  current: AgentAccountUsageWindow,
  referenceEpochMs: number,
): boolean {
  const incomingReset = fetchedResetEpochMs(incoming, referenceEpochMs);
  const currentReset = agentAccountUsageResetEpochMs(current, referenceEpochMs);
  if (incomingReset === null || currentReset === null) return false;
  return (
    incomingReset <= referenceEpochMs + RESET_REFRESH_GRACE_MS &&
    incomingReset < currentReset - EARLIER_PERIOD_TOLERANCE_MS
  );
}

export function mergeAgentAccountUsageRefresh(
  current: AgentAccountUsageSnapshot | null,
  refreshed: AgentAccountUsageSnapshot,
): AgentAccountUsageSnapshot {
  const resolved = resolveAgentAccountUsageResets(refreshed);
  if (current === null || current.provider !== resolved.provider) return resolved;
  const currentById = new Map(current.windows.map((window) => [window.id, window]));
  return {
    ...resolved,
    windows: resolved.windows.map((window) => {
      const existing = currentById.get(window.id);
      if (existing === undefined) return window;
      return isEarlierAgentAccountUsagePeriod(window, existing, resolved.fetchedAtEpochMs)
        ? existing
        : window;
    }),
  };
}

export function agentAccountUsageStaleness(
  snapshot: AgentAccountUsageSnapshot,
  nowEpochMs: number,
  restored: boolean,
): AgentAccountUsageStaleness {
  const expired: string[] = [];
  let recheckAtEpochMs: number | null = null;
  const consider = (epochMs: number): void => {
    recheckAtEpochMs = recheckAtEpochMs === null ? epochMs : Math.min(recheckAtEpochMs, epochMs);
  };
  for (const window of snapshot.windows) {
    const resetEpochMs = fetchedResetEpochMs(window, snapshot.fetchedAtEpochMs);
    if (resetEpochMs === null) continue;
    const refreshAtEpochMs = resetEpochMs + RESET_REFRESH_GRACE_MS;
    if (refreshAtEpochMs <= nowEpochMs) {
      expired.push(`${window.id}@${resetEpochMs}`);
      continue;
    }
    consider(refreshAtEpochMs);
  }
  if (expired.length > 0) return { kind: "stale", key: `reset:${expired.sort().join(",")}` };
  if (restored) {
    const staleAtEpochMs = snapshot.fetchedAtEpochMs + USAGE_READING_STALE_AFTER_MS;
    if (staleAtEpochMs <= nowEpochMs) {
      return { kind: "stale", key: `restored:${snapshot.fetchedAtEpochMs}` };
    }
    consider(staleAtEpochMs);
  }
  return { kind: "fresh", recheckAtEpochMs };
}
