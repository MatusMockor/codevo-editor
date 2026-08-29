import type {
  AgentProviderHealthProbeResult,
  AgentProviderHealthState,
} from "../domain/agentProviderHealth";
import type { AgentProviderPreference } from "../domain/agentProviderSettings";
import type { AgentCliDiscoveryResult, AgentCliDiscoveryState } from "../domain/agentSettings";
import type { AgentCliKind } from "../domain/agentTask";

export type AgentCliDiscoveryPhase = "discovering" | "ready" | "failed";

export interface AgentCliDiscoverySnapshot {
  readonly generation: number;
  readonly result: AgentCliDiscoveryResult;
}

export function effectiveAgentProviderCliPath(
  provider: AgentCliKind,
  manualPath: string | null,
  discovery: AgentCliDiscoverySnapshot | null,
): string | null {
  if (manualPath !== null) return manualPath;
  const detected = discovery?.result[provider];
  if (detected?.kind !== "detected") return null;
  return detected.path;
}

export function agentProviderHealthBeforeRegistration(
  preference: AgentProviderPreference,
  manualPath: string | null,
  discovery: AgentCliDiscoveryState | undefined,
): AgentProviderHealthState {
  if (!preference.enabled) return { kind: "disabled" };
  if (manualPath === null && discovery?.kind !== "detected") {
    return { kind: "notConfigured" };
  }
  return { kind: "checking", generation: 0 };
}

export function agentProviderHealthForAutomaticDiscovery(
  preference: AgentProviderPreference,
  phase: AgentCliDiscoveryPhase,
  generation: number,
  discovery: AgentCliDiscoveryResult[AgentCliKind] | undefined,
): AgentProviderHealthState {
  if (!preference.enabled) return { kind: "disabled" };
  switch (phase) {
    case "discovering":
      return { kind: "checking", generation };
    case "ready":
      if (discovery?.kind !== "detected") return { kind: "notConfigured" };
      return { kind: "checking", generation };
    case "failed":
      return { kind: "notConfigured" };
    default:
      return unsupportedAgentCliDiscoveryPhase(phase);
  }
}

export function agentProviderHealthWithPersistedUpdateAuthority(
  result: AgentProviderHealthProbeResult,
  preference: AgentProviderPreference | undefined,
): AgentProviderHealthProbeResult {
  if (preference?.checkForUpdates !== false) return result;
  return { ...result, update: { kind: "checksDisabled" } };
}

function unsupportedAgentCliDiscoveryPhase(phase: never): never {
  throw new TypeError(`Unsupported agent CLI discovery phase: ${String(phase)}.`);
}
