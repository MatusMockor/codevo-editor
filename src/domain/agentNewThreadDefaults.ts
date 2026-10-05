import {
  CLAUDE_EFFORT_CHOICES,
  CODEX_EFFORT_CHOICES,
  isClaudeModelChoice,
  isCodexModelChoice,
  type ClaudeEffortChoice,
  type ClaudeModelChoice,
  type CodexEffortChoice,
  type CodexModelChoice,
} from "./agentLaunch";

export type AgentNewThreadLaunchSource = "defaults" | "lastUsed";

export interface ClaudeNewThreadDefault {
  readonly model: ClaudeModelChoice;
  readonly effort: ClaudeEffortChoice;
}

export interface CodexNewThreadDefault {
  readonly model: CodexModelChoice;
  readonly effort: CodexEffortChoice;
}

export interface AgentNewThreadDefaults {
  readonly source: AgentNewThreadLaunchSource;
  readonly claudeCode: ClaudeNewThreadDefault;
  readonly codex: CodexNewThreadDefault;
}

export const DEFAULT_AGENT_NEW_THREAD_LAUNCH_SOURCE: AgentNewThreadLaunchSource = "defaults";

const AGENT_NEW_THREAD_DEFAULTS_KEYS = ["source", "claudeCode", "codex"] as const;
const PROVIDER_NEW_THREAD_DEFAULT_KEYS = ["model", "effort"] as const;

export function defaultAgentNewThreadDefaults(): AgentNewThreadDefaults {
  return {
    source: DEFAULT_AGENT_NEW_THREAD_LAUNCH_SOURCE,
    claudeCode: defaultClaudeNewThreadDefault(),
    codex: defaultCodexNewThreadDefault(),
  };
}

export function normalizeAgentNewThreadDefaults(value: unknown): AgentNewThreadDefaults {
  try {
    return storedAgentNewThreadDefaults(value);
  } catch {
    return defaultAgentNewThreadDefaults();
  }
}

function storedAgentNewThreadDefaults(value: unknown): AgentNewThreadDefaults {
  if (!exactRecord(value, AGENT_NEW_THREAD_DEFAULTS_KEYS)) return defaultAgentNewThreadDefaults();
  return {
    source: normalizeLaunchSource(value.source),
    claudeCode: normalizeClaudeNewThreadDefault(value.claudeCode),
    codex: normalizeCodexNewThreadDefault(value.codex),
  };
}

function defaultClaudeNewThreadDefault(): ClaudeNewThreadDefault {
  return { model: "default", effort: "high" };
}

function defaultCodexNewThreadDefault(): CodexNewThreadDefault {
  return { model: "default", effort: "default" };
}

function normalizeLaunchSource(value: unknown): AgentNewThreadLaunchSource {
  if (value === "defaults") return "defaults";
  if (value === "lastUsed") return "lastUsed";
  return DEFAULT_AGENT_NEW_THREAD_LAUNCH_SOURCE;
}

function normalizeClaudeNewThreadDefault(value: unknown): ClaudeNewThreadDefault {
  if (!exactRecord(value, PROVIDER_NEW_THREAD_DEFAULT_KEYS)) return defaultClaudeNewThreadDefault();
  const { model, effort } = value;
  if (!isClaudeModelChoice(model)) return defaultClaudeNewThreadDefault();
  if (!isChoice(effort, CLAUDE_EFFORT_CHOICES)) return defaultClaudeNewThreadDefault();
  return { model, effort };
}

function normalizeCodexNewThreadDefault(value: unknown): CodexNewThreadDefault {
  if (!exactRecord(value, PROVIDER_NEW_THREAD_DEFAULT_KEYS)) return defaultCodexNewThreadDefault();
  const { model, effort } = value;
  if (!isCodexModelChoice(model)) return defaultCodexNewThreadDefault();
  if (!isChoice(effort, CODEX_EFFORT_CHOICES)) return defaultCodexNewThreadDefault();
  return { model, effort };
}

function isChoice<Choice extends string>(
  value: unknown,
  choices: ReadonlyArray<Choice>,
): value is Choice {
  return typeof value === "string" && (choices as ReadonlyArray<string>).includes(value);
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
