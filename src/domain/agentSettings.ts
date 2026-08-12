import type { AgentCliKind, AgentIsolationPolicy } from "./agentTask";

export type { AgentCliKind, AgentIsolationPolicy };

export const DEFAULT_AGENT_CLI_KIND: AgentCliKind = "claudeCode";
export const DEFAULT_AGENT_ISOLATION_POLICY: AgentIsolationPolicy = "auto";
export const DEFAULT_MAX_CONCURRENT_AGENT_TASKS = 4;
export const MIN_CONCURRENT_AGENT_TASKS_LIMIT = 1;
export const MAX_CONCURRENT_AGENT_TASKS_LIMIT = 8;
export const MAX_AGENT_CLI_PATH_BYTES = 4_096;

export interface AgentAppSettings {
  readonly agentCliPath: string | null;
  readonly agentCliKind: AgentCliKind;
  readonly maxConcurrentAgentTasks: number;
}

const UTF8_ENCODER = new TextEncoder();

export function defaultAgentAppSettings(): AgentAppSettings {
  return {
    agentCliPath: null,
    agentCliKind: DEFAULT_AGENT_CLI_KIND,
    maxConcurrentAgentTasks: DEFAULT_MAX_CONCURRENT_AGENT_TASKS,
  };
}

export function normalizeAgentCliPath(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  if (trimmed === "") return null;
  if (trimmed.includes("\0")) return null;
  if (UTF8_ENCODER.encode(trimmed).byteLength > MAX_AGENT_CLI_PATH_BYTES) return null;

  return trimmed;
}

export function normalizeAgentCliKind(value: unknown): AgentCliKind {
  if (value === "claudeCode") return "claudeCode";
  if (value === "codex") return "codex";

  return DEFAULT_AGENT_CLI_KIND;
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
