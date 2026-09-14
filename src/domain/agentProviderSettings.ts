import { parseAgentCliVersion } from "./agentCliVersion";
import type { AgentCliKind } from "./agentTask";

export const DEFAULT_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS = 300;
export const MIN_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS = 0;
export const MAX_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS = 86_400;

export type CodexTransport = "appServer" | "exec";

export interface CodexTransportSettings {
  readonly codexTransport?: CodexTransport;
  readonly codexAppServerArgs?: readonly string[];
}

export function parseCodexTransportSettings(value: {
  readonly codexTransport?: unknown;
  readonly codexAppServerArgs?: unknown;
}): { readonly codexTransport: CodexTransport; readonly codexAppServerArgs: readonly string[] } {
  const transport = value.codexTransport === undefined ? "appServer" : value.codexTransport;
  if (transport !== "appServer" && transport !== "exec")
    throw new TypeError("Invalid Codex transport.");
  const args = value.codexAppServerArgs === undefined ? [] : value.codexAppServerArgs;
  if (
    !Array.isArray(args) ||
    args.length > 16 ||
    Array.from(args).some(
      (arg) =>
        typeof arg !== "string" ||
        arg.length === 0 ||
        arg.length > 256 ||
        !/^[\x20-\x7e]+$/.test(arg) ||
        /^(--listen|--code-mode-host|--strict-config)(=|$)/.test(arg),
    )
  ) {
    throw new TypeError("Invalid Codex app-server arguments.");
  }
  return { codexTransport: transport, codexAppServerArgs: [...args] };
}

export interface AgentProviderPreference extends CodexTransportSettings {
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
    codex: { ...defaultAgentProviderPreference(), ...parseCodexTransportSettings({}) },
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
  const codex = normalizePreference(value.codex, true);
  if (claudeCode === null || codex === null) return defaults;
  return { claudeCode, codex };
}

function defaultAgentProviderPreference(): AgentProviderPreference {
  return {
    enabled: true,
    healthCheckIntervalSeconds: DEFAULT_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS,
    checkForUpdates: true,
    dismissedUpdateVersion: null,
  };
}

function normalizePreference(value: unknown, codex = false): AgentProviderPreference | null {
  const extraKeys =
    codex && typeof value === "object" && value !== null
      ? ["codexTransport", "codexAppServerArgs"].filter((key) =>
          Object.prototype.hasOwnProperty.call(value, key),
        )
      : [];
  if (
    !exactRecord(value, [
      "enabled",
      "healthCheckIntervalSeconds",
      "checkForUpdates",
      "dismissedUpdateVersion",
      ...extraKeys,
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
  let transport: CodexTransportSettings = {};
  if (codex) {
    try {
      transport = parseCodexTransportSettings(value);
    } catch {
      return null;
    }
  }
  return {
    ...transport,
    enabled: value.enabled,
    healthCheckIntervalSeconds: normalizeAgentProviderHealthCheckIntervalSeconds(
      value.healthCheckIntervalSeconds,
    ),
    // Retain the legacy wire field, but update checks are automatic for enabled providers.
    checkForUpdates: true,
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
