import {
  CLAUDE_MODEL_CHOICES,
  CLAUDE_PERMISSION_MODES,
  CODEX_EXECUTION_MODES,
  CODEX_MODEL_CHOICES,
  agentLaunchIsDangerous,
  type AgentLaunchOptions,
  type ClaudeModelChoice,
  type ClaudePermissionMode,
  type CodexExecutionMode,
  type CodexModelChoice,
} from "../../domain/agentLaunch";
import type { AgentCliKind } from "../../domain/agentTask";

export interface AgentLaunchChoice {
  readonly value: string;
  readonly label: string;
  readonly hint: string;
}

export type AgentLaunchTone = "plan" | "danger" | null;

interface LaunchText {
  readonly label: string;
  readonly meta: string;
  readonly hint: string;
}

const CLAUDE_MODEL_TEXT: Record<ClaudeModelChoice, LaunchText> = {
  default: {
    label: "Default model",
    meta: "default model",
    hint: "Uses the model your Claude CLI is configured to run.",
  },
  fable: {
    label: "Fable",
    meta: "fable",
    hint: "Runs the session on the latest Fable model.",
  },
  opus: {
    label: "Opus",
    meta: "opus",
    hint: "Runs the session on the latest Opus model.",
  },
  sonnet: {
    label: "Sonnet",
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
    label: "Plan only",
    meta: "plan only",
    hint: "The agent plans the work and does not change files.",
  },
  acceptEdits: {
    label: "Accept edits",
    meta: "accept edits",
    hint: "File edits apply without asking; tools that still ask are denied, because the run has no input.",
  },
  bypassPermissions: {
    label: "Bypass permissions",
    meta: "bypass permissions",
    hint: "Skips every permission check; the agent can run any command in this repository.",
  },
};

const CODEX_MODEL_TEXT: Record<CodexModelChoice, LaunchText> = {
  default: {
    label: "Default model",
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
  if (provider === "claudeCode") return choices(CLAUDE_MODEL_CHOICES, CLAUDE_MODEL_TEXT);
  return choices(CODEX_MODEL_CHOICES, CODEX_MODEL_TEXT);
}

export function agentLaunchModeChoices(provider: AgentCliKind): ReadonlyArray<AgentLaunchChoice> {
  if (provider === "claudeCode") return choices(CLAUDE_PERMISSION_MODES, CLAUDE_MODE_TEXT);
  return choices(CODEX_EXECUTION_MODES, CODEX_MODE_TEXT);
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
  return `${agentLaunchModelMeta(launch)} · ${agentLaunchModeMeta(launch)}`;
}

export function agentLaunchTone(launch: AgentLaunchOptions): AgentLaunchTone {
  if (agentLaunchIsDangerous(launch)) return "danger";
  if (launch.provider === "claudeCode" && launch.mode === "plan") return "plan";
  return null;
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

function choices<Value extends string>(
  values: ReadonlyArray<Value>,
  text: Record<Value, LaunchText>,
): ReadonlyArray<AgentLaunchChoice> {
  return values.map((value) => ({
    value,
    label: text[value].label,
    hint: text[value].hint,
  }));
}
