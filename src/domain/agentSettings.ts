import {
  CLAUDE_MODEL_CHOICES,
  CODEX_MODEL_CHOICES,
  type ClaudeModelChoice,
  type CodexModelChoice,
} from "./agentLaunch";
import type { AgentCliKind, AgentIsolationPolicy } from "./agentTask";
import {
  defaultAgentProviderPreferences,
  type AgentProviderPreferences,
} from "./agentProviderSettings";

export type { AgentCliKind, AgentIsolationPolicy };

export const DEFAULT_AGENT_CLI_KIND: AgentCliKind = "claudeCode";
export const DEFAULT_AGENT_ISOLATION_POLICY: AgentIsolationPolicy = "auto";
export const DEFAULT_MAX_CONCURRENT_AGENT_TASKS = 4;
export const MIN_CONCURRENT_AGENT_TASKS_LIMIT = 1;
export const MAX_CONCURRENT_AGENT_TASKS_LIMIT = 8;
export const MAX_AGENT_CLI_PATH_BYTES = 4_096;
export const AGENT_APPEARANCE_VARIANTS = ["current", "graphite", "paper", "studio"] as const;
export type AgentAppearanceVariant = (typeof AGENT_APPEARANCE_VARIANTS)[number];
export const DEFAULT_AGENT_APPEARANCE_VARIANT: AgentAppearanceVariant = "current";
export const MAX_AGENT_MODEL_FAVORITES = 32;

export interface AgentCliPaths {
  readonly claudeCode: string | null;
  readonly codex: string | null;
}

export type AgentCliDiscoveryState =
  | {
      readonly kind: "detected";
      readonly path: string;
      readonly version: string | null;
    }
  | { readonly kind: "notFound" };

export interface AgentCliDiscoveryResult {
  readonly claudeCode: AgentCliDiscoveryState;
  readonly codex: AgentCliDiscoveryState;
}

export interface AgentCliDiscoveryRequest {
  readonly refresh: boolean;
}

export interface AgentCliDiscoveryGateway {
  discoverAgentClis(request: AgentCliDiscoveryRequest): Promise<AgentCliDiscoveryResult>;
}

export type AgentCliExecutablePresentation =
  | { readonly kind: "manual"; readonly path: string }
  | {
      readonly kind: "detected";
      readonly path: string;
      readonly version: string | null;
    }
  | { readonly kind: "notFound"; readonly installCommand: string };

export type AgentModelFavoriteKey = `claudeCode/${ClaudeModelChoice}` | `codex/${CodexModelChoice}`;

export type AgentCliPathValidation = "notConfigured" | "invalid" | "valid";

export interface AgentAppSettings {
  readonly agentCliPaths: AgentCliPaths;
  readonly agentCliKind: AgentCliKind;
  readonly agentAppearanceVariant: AgentAppearanceVariant;
  readonly agentModelFavoriteKeys: ReadonlyArray<AgentModelFavoriteKey>;
  readonly agentModelFavoritesRevision: number;
  readonly agentProviderPreferences: AgentProviderPreferences;
  readonly maxConcurrentAgentTasks: number;
}

export interface AgentModelFavoritesSnapshot {
  readonly keys: ReadonlyArray<AgentModelFavoriteKey>;
  readonly revision: number;
}

const UTF8_ENCODER = new TextEncoder();

export function defaultAgentAppSettings(): AgentAppSettings {
  return {
    agentCliPaths: { claudeCode: null, codex: null },
    agentCliKind: DEFAULT_AGENT_CLI_KIND,
    agentAppearanceVariant: DEFAULT_AGENT_APPEARANCE_VARIANT,
    agentModelFavoriteKeys: [],
    agentModelFavoritesRevision: 0,
    agentProviderPreferences: defaultAgentProviderPreferences(),
    maxConcurrentAgentTasks: DEFAULT_MAX_CONCURRENT_AGENT_TASKS,
  };
}

export function defaultAgentCliDiscoveryResult(): AgentCliDiscoveryResult {
  return { claudeCode: { kind: "notFound" }, codex: { kind: "notFound" } };
}

export function agentCliExecutablePresentation(
  provider: AgentCliKind,
  manualPath: string | null,
  discovery: AgentCliDiscoveryState,
): AgentCliExecutablePresentation {
  if (manualPath !== null) return { kind: "manual", path: manualPath };
  switch (discovery.kind) {
    case "detected":
      return discovery;
    case "notFound":
      return { kind: "notFound", installCommand: agentCliInstallCommand(provider) };
    default:
      return unsupportedAgentCliDiscoveryState(discovery);
  }
}

export function agentCliInstallCommand(provider: AgentCliKind): string {
  switch (provider) {
    case "claudeCode":
      return "npm i -g @anthropic-ai/claude-code";
    case "codex":
      return "npm i -g @openai/codex";
    default:
      return unsupportedAgentCliKind(provider);
  }
}

export function normalizeAgentCliPath(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  if (trimmed === "") return null;
  if (trimmed.includes("\0")) return null;
  if (UTF8_ENCODER.encode(trimmed).byteLength > MAX_AGENT_CLI_PATH_BYTES) return null;
  if (!trimmed.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(trimmed)) return null;

  return trimmed;
}

export function normalizeAgentCliKind(value: unknown): AgentCliKind {
  if (value === "claudeCode") return "claudeCode";
  if (value === "codex") return "codex";

  return DEFAULT_AGENT_CLI_KIND;
}

export function normalizeAgentAppearanceVariant(value: unknown): AgentAppearanceVariant {
  if (AGENT_APPEARANCE_VARIANTS.some((variant) => variant === value)) {
    return value as AgentAppearanceVariant;
  }
  return DEFAULT_AGENT_APPEARANCE_VARIANT;
}

export function normalizeAgentCliPaths(
  value: unknown,
  legacyPath: unknown,
  legacyKind: AgentCliKind,
): AgentCliPaths {
  if (value === undefined) {
    const path = normalizeAgentCliPath(legacyPath);
    return legacyKind === "claudeCode"
      ? { claudeCode: path, codex: null }
      : { claudeCode: null, codex: path };
  }
  if (!isPlainRecord(value)) return { claudeCode: null, codex: null };
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    keys.some((key) => key !== "claudeCode" && key !== "codex") ||
    !("claudeCode" in value) ||
    !("codex" in value)
  ) {
    return { claudeCode: null, codex: null };
  }
  const claudeCode = storedAgentCliPath(value.claudeCode);
  const codex = storedAgentCliPath(value.codex);
  if (!claudeCode.valid || !codex.valid) return { claudeCode: null, codex: null };
  return {
    claudeCode: claudeCode.path,
    codex: codex.path,
  };
}

export function normalizeAgentModelFavoriteKeys(
  value: unknown,
): ReadonlyArray<AgentModelFavoriteKey> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_AGENT_MODEL_FAVORITES) return [];
  const keys = new Set<AgentModelFavoriteKey>();
  for (const candidate of value) {
    const key = agentModelFavoriteKey(candidate);
    if (key === null || keys.has(key)) return [];
    keys.add(key);
  }
  return [...keys];
}

export function normalizeAgentModelFavoritesRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0) return 0;
  return value;
}

export function normalizeAgentModelFavoritesSnapshot(
  keysValue: unknown,
  revisionValue: unknown,
): AgentModelFavoritesSnapshot {
  if (keysValue === undefined && revisionValue === undefined) return { keys: [], revision: 0 };
  if (!Array.isArray(keysValue)) return { keys: [], revision: 0 };
  const keys = normalizeAgentModelFavoriteKeys(keysValue);
  if (keys.length !== keysValue.length) return { keys: [], revision: 0 };
  const revision = normalizeAgentModelFavoritesRevision(revisionValue);
  if (revisionValue !== revision) return { keys: [], revision: 0 };
  if (revision === Number.MAX_SAFE_INTEGER) return { keys: [], revision: 0 };
  return { keys, revision };
}

export function nextAgentModelFavoritesRevision(current: number): number | null {
  if (!Number.isSafeInteger(current) || current < 0) return 1;
  if (current === Number.MAX_SAFE_INTEGER) return null;
  return current + 1;
}

export function agentCliPathValidation(value: string | null): AgentCliPathValidation {
  if (value === null) return "notConfigured";
  return normalizeAgentCliPath(value) === value ? "valid" : "invalid";
}

export function activeAgentCliPath(paths: AgentCliPaths, kind: AgentCliKind): string | null {
  switch (kind) {
    case "claudeCode":
      return paths.claudeCode;
    case "codex":
      return paths.codex;
    default:
      return unsupportedAgentCliKind(kind);
  }
}

export function normalizeMaxConcurrentAgentTasks(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_CONCURRENT_AGENT_TASKS;
  }

  const rounded = Math.floor(value);

  return Math.min(
    Math.max(rounded, MIN_CONCURRENT_AGENT_TASKS_LIMIT),
    MAX_CONCURRENT_AGENT_TASKS_LIMIT,
  );
}

export function normalizeAgentIsolationPolicy(value: unknown): AgentIsolationPolicy {
  if (value === "worktree") return "worktree";
  if (value === "in-place") return "in-place";

  return DEFAULT_AGENT_ISOLATION_POLICY;
}

function agentModelFavoriteKey(value: unknown): AgentModelFavoriteKey | null {
  if (typeof value !== "string") return null;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return null;
  const provider = value.slice(0, separator);
  const model = value.slice(separator + 1);
  if (provider === "claudeCode" && CLAUDE_MODEL_CHOICES.some((choice) => choice === model)) {
    return value as AgentModelFavoriteKey;
  }
  if (provider === "codex" && CODEX_MODEL_CHOICES.some((choice) => choice === model)) {
    return value as AgentModelFavoriteKey;
  }
  return null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function storedAgentCliPath(
  value: unknown,
): { readonly valid: true; readonly path: string | null } | { readonly valid: false } {
  if (value === null) return { valid: true, path: null };
  if (typeof value === "string" && value.trim() === "") return { valid: true, path: null };
  const path = normalizeAgentCliPath(value);
  if (path === null) return { valid: false };
  return { valid: true, path };
}

function unsupportedAgentCliKind(kind: never): never {
  throw new TypeError(`Unsupported agent CLI kind: ${String(kind)}`);
}

function unsupportedAgentCliDiscoveryState(state: never): never {
  throw new TypeError(`Unsupported agent CLI discovery state: ${String(state)}`);
}
