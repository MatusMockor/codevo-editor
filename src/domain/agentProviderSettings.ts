import { parseAgentCliVersion } from "./agentCliVersion";
import type { AgentCliKind } from "./agentTask";

export const DEFAULT_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS = 300;
export const MIN_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS = 0;
export const MAX_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS = 86_400;

export interface AgentProviderPreference {
  readonly enabled: boolean;
  readonly healthCheckIntervalSeconds: number;
  readonly checkForUpdates: boolean;
  readonly dismissedUpdateVersion: string | null;
}

export interface AgentProviderPreferences {
  readonly claudeCode: AgentProviderPreference;
  readonly codex: AgentProviderPreference;
}

export interface PersistedAgentProviderSettingsAuthority {
  readonly settingsRevision: number;
  readonly provider: AgentCliKind;
  readonly preference: AgentProviderPreference;
  readonly cliPath: string | null;
}

export function defaultAgentProviderPreferences(): AgentProviderPreferences {
  return {
    claudeCode: defaultAgentProviderPreference(),
    codex: defaultAgentProviderPreference(),
  };
}

export function normalizeAgentProviderHealthCheckIntervalSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return DEFAULT_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS;
  }
  return Math.min(
    Math.max(Math.floor(value), MIN_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS),
    MAX_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS,
  );
}

export function normalizeAgentProviderPreferences(value: unknown): AgentProviderPreferences {
  const defaults = defaultAgentProviderPreferences();
  if (!exactRecord(value, ["claudeCode", "codex"])) return defaults;
  const claudeCode = normalizePreference(value.claudeCode);
  const codex = normalizePreference(value.codex);
  if (claudeCode === null || codex === null) return defaults;
  return { claudeCode, codex };
}

function defaultAgentProviderPreference(): AgentProviderPreference {
  return {
    enabled: true,
    healthCheckIntervalSeconds: DEFAULT_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS,
    checkForUpdates: false,
    dismissedUpdateVersion: null,
  };
}

function normalizePreference(value: unknown): AgentProviderPreference | null {
  if (
    !exactRecord(value, [
      "enabled",
      "healthCheckIntervalSeconds",
      "checkForUpdates",
      "dismissedUpdateVersion",
    ])
  ) {
    return null;
  }
  if (typeof value.enabled !== "boolean") return null;
  if (typeof value.healthCheckIntervalSeconds !== "number") return null;
  if (!Number.isSafeInteger(value.healthCheckIntervalSeconds)) return null;
  if (typeof value.checkForUpdates !== "boolean") return null;
  const dismissed = dismissedVersion(value.dismissedUpdateVersion);
  if (!dismissed.valid) return null;
  return {
    enabled: value.enabled,
    healthCheckIntervalSeconds: normalizeAgentProviderHealthCheckIntervalSeconds(
      value.healthCheckIntervalSeconds,
    ),
    checkForUpdates: value.checkForUpdates,
    dismissedUpdateVersion: dismissed.value,
  };
}

function dismissedVersion(
  value: unknown,
): { readonly valid: true; readonly value: string | null } | { readonly valid: false } {
  if (value === null) return { valid: true, value: null };
  if (typeof value !== "string") return { valid: false };
  const parsed = parseAgentCliVersion(value);
  if (parsed === null || parsed !== value) return { valid: false };
  return { valid: true, value: parsed };
}

function exactRecord(
  value: unknown,
  expectedKeys: ReadonlyArray<string>,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length) return false;
  return expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
