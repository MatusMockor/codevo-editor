import {
  CLAUDE_EFFORT_CHOICES,
  CLAUDE_MODEL_CHOICES,
  CLAUDE_PERMISSION_MODES,
  CODEX_EXECUTION_MODES,
  CODEX_MODEL_CHOICES,
  agentLaunchIsDangerous,
  type AgentLaunchOptions,
  type ClaudeEffortChoice,
  type ClaudeModelChoice,
  type ClaudePermissionMode,
  type CodexExecutionMode,
  type CodexModelChoice,
} from "../../domain/agentLaunch";
import type { AgentCliKind } from "../../domain/agentTask";

export type AgentModelChoice = ClaudeModelChoice | CodexModelChoice;

export interface AgentModelRow {
  readonly value: AgentModelChoice;
  readonly label: string;
  readonly hint: string;
  readonly provider: AgentCliKind;
  readonly providerName: string;
  readonly favoriteKey: string;
}

export type AgentModelFilter = "all" | "favorites";

export const MAX_AGENT_MODEL_QUERY_LENGTH = 64;

export interface AgentLaunchChoice {
  readonly value: string;
  readonly label: string;
  readonly hint: string;
  readonly tone: AgentLaunchTone;
}

export type AgentLaunchTone = "plan" | "danger" | null;

export type AgentLaunchAccess = "guarded" | "open";

interface LaunchText {
  readonly label: string;
  readonly meta: string;
  readonly hint: string;
}

const CLAUDE_MODEL_TEXT: Record<ClaudeModelChoice, LaunchText> = {
  default: {
    label: "Claude (default)",
    meta: "default model",
    hint: "Uses the model your Claude CLI is configured to run.",
  },
  fable: {
    label: "Claude Fable 5",
    meta: "fable",
    hint: "Runs the session on the latest Fable model.",
  },
  opus: {
    label: "Claude Opus 5",
    meta: "opus",
    hint: "Runs the session on the latest Opus model.",
  },
  sonnet: {
    label: "Claude Sonnet 5",
    meta: "sonnet",
    hint: "Runs the session on the latest Sonnet model.",
  },
};

const CLAUDE_MODE_TEXT: Record<ClaudePermissionMode, LaunchText> = {
  default: {
    label: "Default permissions",
    meta: "default permissions",
    hint: "Uses the permission mode your Claude CLI is configured to use.",
  },
  plan: {
    label: "Plan mode",
    meta: "plan only",
    hint: "The agent plans the work and does not change files.",
  },
  acceptEdits: {
    label: "Accept edits",
    meta: "accept edits",
    hint: "File edits apply without asking; tools that still ask are denied, because the run has no input.",
  },
  bypassPermissions: {
    label: "Full access",
    meta: "bypass permissions",
    hint: "Skips every permission check; the agent can run any command in this repository.",
  },
};

const CLAUDE_EFFORT_TEXT: Record<ClaudeEffortChoice, LaunchText> = {
  default: {
    label: "Default effort",
    meta: "default effort",
    hint: "Uses the effort level your Claude CLI is configured to run.",
  },
  low: {
    label: "Low",
    meta: "low",
    hint: "Answers fastest and reasons the least.",
  },
  medium: {
    label: "Medium",
    meta: "medium",
    hint: "Balances reasoning depth against turnaround time.",
  },
  high: {
    label: "High",
    meta: "high",
    hint: "Reasons longer before acting on harder changes.",
  },
  xhigh: {
    label: "Extra high",
    meta: "xhigh",
    hint: "Reasons noticeably longer than high and costs more.",
  },
  max: {
    label: "Max",
    meta: "max",
    hint: "Reasons the longest; slowest and most thorough.",
  },
};

const CODEX_MODEL_TEXT: Record<CodexModelChoice, LaunchText> = {
  default: {
    label: "Codex (default)",
    meta: "default model",
    hint: "Uses the model your Codex CLI is configured to run.",
  },
  "gpt-5.6-sol": {
    label: "GPT-5.6 Sol",
    meta: "gpt-5.6-sol",
    hint: "Runs the session on gpt-5.6-sol.",
  },
  "gpt-5.5": {
    label: "GPT-5.5",
    meta: "gpt-5.5",
    hint: "Runs the session on gpt-5.5.",
  },
  "gpt-5.4": {
    label: "GPT-5.4",
    meta: "gpt-5.4",
    hint: "Runs the session on gpt-5.4.",
  },
};

const CODEX_MODE_TEXT: Record<CodexExecutionMode, LaunchText> = {
  default: {
    label: "Default sandbox",
    meta: "default sandbox",
    hint: "Uses the sandbox your Codex CLI is configured to use.",
  },
  readOnly: {
    label: "Read-only",
    meta: "read-only",
    hint: "Commands run without permission to change any file.",
  },
  workspaceWrite: {
    label: "Workspace write",
    meta: "workspace write",
    hint: "Commands may write inside the workspace and nowhere else.",
  },
  dangerFullAccess: {
    label: "Full access",
    meta: "full access",
    hint: "Skips the sandbox and every approval; commands run with your full access.",
  },
};

export function agentLaunchModelChoices(provider: AgentCliKind): ReadonlyArray<AgentLaunchChoice> {
  if (provider === "claudeCode")
    return choices(CLAUDE_MODEL_CHOICES, CLAUDE_MODEL_TEXT, () => null);
  return choices(CODEX_MODEL_CHOICES, CODEX_MODEL_TEXT, () => null);
}

export function agentModelRows(provider: AgentCliKind): ReadonlyArray<AgentModelRow> {
  if (provider === "claudeCode")
    return modelRows(provider, CLAUDE_MODEL_CHOICES, CLAUDE_MODEL_TEXT);
  return modelRows(provider, CODEX_MODEL_CHOICES, CODEX_MODEL_TEXT);
}

export function agentModelFavoriteKey(provider: AgentCliKind, model: AgentModelChoice): string {
  return `${provider}/${model}`;
}

export function agentModelProviderName(provider: AgentCliKind): string {
  if (provider === "claudeCode") return "Claude Code";
  return "Codex";
}

export function boundAgentModelQuery(query: string): string {
  return query.slice(0, MAX_AGENT_MODEL_QUERY_LENGTH);
}

export function agentModelRowMatches(row: AgentModelRow, query: string): boolean {
  const needle = boundAgentModelQuery(query).trim().toLocaleLowerCase();
  if (needle === "") return true;
  return (
    row.label.toLocaleLowerCase().includes(needle) ||
    row.providerName.toLocaleLowerCase().includes(needle)
  );
}

export function filterAgentModelRows(
  rows: ReadonlyArray<AgentModelRow>,
  filter: AgentModelFilter,
  favorites: ReadonlySet<string>,
  query: string,
): ReadonlyArray<AgentModelRow> {
  return rows.filter((row) => {
    if (filter === "favorites" && !favorites.has(row.favoriteKey)) return false;
    return agentModelRowMatches(row, query);
  });
}

export function agentLaunchModeChoices(provider: AgentCliKind): ReadonlyArray<AgentLaunchChoice> {
  if (provider === "claudeCode") {
    return choices(CLAUDE_PERMISSION_MODES, CLAUDE_MODE_TEXT, (mode) =>
      agentLaunchTone({ provider, model: "default", mode, effort: "default" }),
    );
  }
  return choices(CODEX_EXECUTION_MODES, CODEX_MODE_TEXT, (mode) =>
    agentLaunchTone({ provider, model: "default", mode }),
  );
}

export function agentLaunchEffortChoices(): ReadonlyArray<AgentLaunchChoice> {
  return choices(CLAUDE_EFFORT_CHOICES, CLAUDE_EFFORT_TEXT, () => null);
}

export function agentLaunchSupportsEffort(launch: AgentLaunchOptions): boolean {
  return launch.provider === "claudeCode";
}

export function agentLaunchEffortValue(launch: AgentLaunchOptions): ClaudeEffortChoice {
  if (launch.provider === "claudeCode") return launch.effort;
  return "default";
}

export function agentLaunchEffortLabel(launch: AgentLaunchOptions): string {
  return effortText(launch).label;
}

export function agentLaunchEffortHint(launch: AgentLaunchOptions): string {
  return effortText(launch).hint;
}

export function agentLaunchEffortMeta(launch: AgentLaunchOptions): string {
  return effortText(launch).meta;
}

export function agentLaunchWithEffort(
  launch: AgentLaunchOptions,
  value: string,
): AgentLaunchOptions {
  if (launch.provider !== "claudeCode") return launch;
  const effort = pick(CLAUDE_EFFORT_CHOICES, value);
  if (effort === null) return launch;
  return { ...launch, effort };
}

export function agentLaunchModelLabel(launch: AgentLaunchOptions): string {
  return modelText(launch).label;
}

export function agentLaunchModelHint(launch: AgentLaunchOptions): string {
  return modelText(launch).hint;
}

export function agentLaunchModeLabel(launch: AgentLaunchOptions): string {
  return modeText(launch).label;
}

export function agentLaunchModeHint(launch: AgentLaunchOptions): string {
  return modeText(launch).hint;
}

export function agentLaunchModelMeta(launch: AgentLaunchOptions): string {
  return modelText(launch).meta;
}

export function agentLaunchModeMeta(launch: AgentLaunchOptions): string {
  return modeText(launch).meta;
}

export function agentLaunchMetaLabel(launch: AgentLaunchOptions): string {
  const base = `${agentLaunchModelMeta(launch)} · ${agentLaunchModeMeta(launch)}`;
  if (agentLaunchEffortValue(launch) === "default") return base;
  return `${base} · ${agentLaunchEffortMeta(launch)}`;
}

export function agentLaunchWithModel(
  launch: AgentLaunchOptions,
  value: string,
): AgentLaunchOptions {
  if (launch.provider === "claudeCode") {
    const model = pick(CLAUDE_MODEL_CHOICES, value);
    if (model === null) return launch;
    return { ...launch, model };
  }
  const model = pick(CODEX_MODEL_CHOICES, value);
  if (model === null) return launch;
  return { ...launch, model };
}

export function agentLaunchWithMode(launch: AgentLaunchOptions, value: string): AgentLaunchOptions {
  if (launch.provider === "claudeCode") {
    const mode = pick(CLAUDE_PERMISSION_MODES, value);
    if (mode === null) return launch;
    return { ...launch, mode };
  }
  const mode = pick(CODEX_EXECUTION_MODES, value);
  if (mode === null) return launch;
  return { ...launch, mode };
}

export function agentLaunchTone(launch: AgentLaunchOptions): AgentLaunchTone {
  if (agentLaunchIsDangerous(launch)) return "danger";
  if (launch.provider === "claudeCode" && launch.mode === "plan") return "plan";
  return null;
}

export function agentLaunchAccess(launch: AgentLaunchOptions): AgentLaunchAccess {
  if (agentLaunchIsDangerous(launch)) return "open";
  return "guarded";
}

export function agentLaunchDangerNotice(launch: AgentLaunchOptions): string | null {
  if (!agentLaunchIsDangerous(launch)) return null;
  if (launch.provider === "claudeCode") {
    return "Bypasses permission checks. The agent can run any command in this repository without asking.";
  }
  return "Bypasses permission checks and the sandbox. Commands run with your full user access.";
}

export function agentLaunchDangerConfirmLabel(launch: AgentLaunchOptions): string {
  if (launch.provider === "claudeCode") {
    return "Run this turn without permission checks and accept the risk";
  }
  return "Run this turn without the sandbox and accept the risk";
}

function modelText(launch: AgentLaunchOptions): LaunchText {
  if (launch.provider === "claudeCode") return CLAUDE_MODEL_TEXT[launch.model];
  return CODEX_MODEL_TEXT[launch.model];
}

function modeText(launch: AgentLaunchOptions): LaunchText {
  if (launch.provider === "claudeCode") return CLAUDE_MODE_TEXT[launch.mode];
  return CODEX_MODE_TEXT[launch.mode];
}

function effortText(launch: AgentLaunchOptions): LaunchText {
  return CLAUDE_EFFORT_TEXT[agentLaunchEffortValue(launch)];
}

function modelRows<Value extends AgentModelChoice>(
  provider: AgentCliKind,
  values: ReadonlyArray<Value>,
  text: Record<Value, LaunchText>,
): ReadonlyArray<AgentModelRow> {
  const providerName = agentModelProviderName(provider);
  return values.map((value) => ({
    value,
    label: text[value].label,
    hint: text[value].hint,
    provider,
    providerName,
    favoriteKey: agentModelFavoriteKey(provider, value),
  }));
}

function choices<Value extends string>(
  values: ReadonlyArray<Value>,
  text: Record<Value, LaunchText>,
  tone: (value: Value) => AgentLaunchTone,
): ReadonlyArray<AgentLaunchChoice> {
  return values.map((value) => ({
    value,
    label: text[value].label,
    hint: text[value].hint,
    tone: tone(value),
  }));
}

function pick<Value extends string>(values: ReadonlyArray<Value>, value: string): Value | null {
  const match = values.find((candidate) => candidate === value);
  return match ?? null;
}
