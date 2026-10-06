import type { AgentAccountUsageWindow } from "./agentAccountUsage";
import { agentAccountUsageResetEpochMs } from "./agentAccountUsageFreshness";
import type { AgentCliKind } from "./agentTask";

const MINUTE_MS = 60_000;

export function composerUsageDismissalKey(
  provider: AgentCliKind,
  window: AgentAccountUsageWindow,
  observedAtEpochMs: number,
): string {
  const resetEpochMs = agentAccountUsageResetEpochMs(window, observedAtEpochMs);
  const reset =
    resetEpochMs === null
      ? `label:${window.resetsLabel ?? ""}`
      : `at:${resetIdentityEpochMs(provider, resetEpochMs)}`;
  return JSON.stringify([provider, window.id, reset]);
}

export function normalizeComposerUsageDismissalKey(key: string): string {
  // Retain dismissals saved before Claude reset identities used minute precision.
  try {
    const value: unknown = JSON.parse(key);
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value[0] !== "claudeCode" ||
      typeof value[1] !== "string" ||
      typeof value[2] !== "string" ||
      !/^at:\d+$/u.test(value[2])
    ) {
      return key;
    }
    const resetEpochMs = Number(value[2].slice(3));
    if (!Number.isSafeInteger(resetEpochMs)) return key;
    return JSON.stringify([
      value[0],
      value[1],
      `at:${resetIdentityEpochMs("claudeCode", resetEpochMs)}`,
    ]);
  } catch {
    return key;
  }
}

function resetIdentityEpochMs(provider: AgentCliKind, resetEpochMs: number): number {
  // Claude's /usage text drops seconds; live rate-limit events retain them.
  return provider === "claudeCode"
    ? Math.floor(resetEpochMs / MINUTE_MS) * MINUTE_MS
    : resetEpochMs;
}
