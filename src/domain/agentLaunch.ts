import type { AgentCliKind } from "./agentTask";

export const CLAUDE_MODEL_CHOICES = [
  "default",
  "fable",
  "opus",
  "sonnet",
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;
export type ClaudeModelChoice = (typeof CLAUDE_MODEL_CHOICES)[number];

export const CLAUDE_PERMISSION_MODES = [
  "default",
  "plan",
  "supervised",
  "acceptEdits",
  "auto",
  "bypassPermissions",
] as const;
export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number];

export const CODEX_MODEL_CHOICES = [
  "default",
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
] as const;
export type CodexModelChoice = (typeof CODEX_MODEL_CHOICES)[number];

export const CODEX_EXECUTION_MODES = [
  "default",
  "readOnly",
  "workspaceWrite",
  "auto",
  "dangerFullAccess",
] as const;
export type CodexExecutionMode = (typeof CODEX_EXECUTION_MODES)[number];

export const CLAUDE_EFFORT_CHOICES = [
  "default",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
  "ultrathink",
] as const;
export type ClaudeEffortChoice = (typeof CLAUDE_EFFORT_CHOICES)[number];
export const CLAUDE_CONTEXT_CHOICES = ["200k", "1m"] as const;
export type ClaudeContextChoice = (typeof CLAUDE_CONTEXT_CHOICES)[number];

export interface ClaudeLaunchOptions {
  readonly provider: "claudeCode";
  readonly model: ClaudeModelChoice;
  readonly mode: ClaudePermissionMode;
  readonly effort: ClaudeEffortChoice;
  readonly context?: ClaudeContextChoice;
  readonly fastMode?: boolean;
  readonly thinkingMode?: boolean;
}

export interface CodexLaunchOptions {
  readonly provider: "codex";
  readonly model: CodexModelChoice;
  readonly mode: CodexExecutionMode;
}

export type AgentLaunchOptions = ClaudeLaunchOptions | CodexLaunchOptions;

export interface AgentLaunchOptionsByProvider {
  readonly claudeCode: ClaudeLaunchOptions;
  readonly codex: CodexLaunchOptions;
}

export const DEFAULT_AGENT_LAUNCH_OPTIONS: AgentLaunchOptionsByProvider = {
  claudeCode: {
    provider: "claudeCode",
    model: "default",
    mode: "default",
    effort: "default",
    context: "1m",
    fastMode: false,
    thinkingMode: false,
  },
  codex: { provider: "codex", model: "default", mode: "default" },
};

export function defaultAgentLaunchOptions(provider: AgentCliKind): AgentLaunchOptions {
  return DEFAULT_AGENT_LAUNCH_OPTIONS[provider];
}

export function parseAgentLaunchOptions(value: unknown, path: string): AgentLaunchOptions {
  return parseLaunchOptions(value, path, false);
}

export function parseStoredAgentLaunchOptions(value: unknown, path: string): AgentLaunchOptions {
  return parseLaunchOptions(value, path, true);
}

export function serializeAgentLaunchOptions(options: AgentLaunchOptions): Record<string, unknown> {
  if (options.provider === "claudeCode") {
    return {
      provider: options.provider,
      model: options.model,
      mode: options.mode,
      effort: options.effort,
      ...(options.context === undefined ? {} : { context: options.context }),
      ...(options.fastMode === undefined ? {} : { fastMode: options.fastMode }),
      ...(options.thinkingMode === undefined ? {} : { thinkingMode: options.thinkingMode }),
    };
  }
  return { provider: options.provider, model: options.model, mode: options.mode };
}

export function agentLaunchMatchesProvider(
  options: AgentLaunchOptions,
  provider: AgentCliKind,
): boolean {
  return options.provider === provider;
}

export function agentLaunchIsDangerous(options: AgentLaunchOptions): boolean {
  switch (options.provider) {
    case "claudeCode":
      return options.mode === "bypassPermissions";
    case "codex":
      return options.mode === "dangerFullAccess";
    default:
      return unsupportedLaunchOptions(options);
  }
}

export function agentLaunchOptionsEqual(a: AgentLaunchOptions, b: AgentLaunchOptions): boolean {
  if (a.provider !== b.provider) return false;
  if (a.model !== b.model) return false;
  if (a.mode !== b.mode) return false;
  if (a.provider === "claudeCode" && b.provider === "claudeCode") {
    return (
      a.effort === b.effort &&
      (a.context ?? "1m") === (b.context ?? "1m") &&
      (a.fastMode ?? false) === (b.fastMode ?? false) &&
      (a.thinkingMode ?? false) === (b.thinkingMode ?? false)
    );
  }
  return true;
}

function parseLaunchOptions(value: unknown, path: string, stored: boolean): AgentLaunchOptions {
  const options = record(value, path);
  const provider = launchProvider(options.provider, `${path}.provider`);
  if (provider === "claudeCode") {
    exactKeys(options, claudeLaunchKeys(options, stored), path);
    return {
      provider,
      model: member(options.model, CLAUDE_MODEL_CHOICES, `${path}.model`),
      mode: member(options.mode, CLAUDE_PERMISSION_MODES, `${path}.mode`),
      effort: parseEffort(options.effort, `${path}.effort`, stored),
      ...(options.context === undefined
        ? {}
        : { context: member(options.context, CLAUDE_CONTEXT_CHOICES, `${path}.context`) }),
      ...(options.fastMode === undefined
        ? {}
        : { fastMode: boolean(options.fastMode, `${path}.fastMode`) }),
      ...(options.thinkingMode === undefined
        ? {}
        : { thinkingMode: boolean(options.thinkingMode, `${path}.thinkingMode`) }),
    };
  }
  exactKeys(options, ["provider", "model", "mode"], path);
  return {
    provider,
    model: member(options.model, CODEX_MODEL_CHOICES, `${path}.model`),
    mode: member(options.mode, CODEX_EXECUTION_MODES, `${path}.mode`),
  };
}

function claudeLaunchKeys(
  options: Record<string, unknown>,
  stored: boolean,
): ReadonlyArray<string> {
  const keys = ["provider", "model", "mode"];
  if (!stored || "effort" in options) keys.push("effort");
  if ("context" in options) keys.push("context");
  if ("fastMode" in options) keys.push("fastMode");
  if ("thinkingMode" in options) keys.push("thinkingMode");
  return keys;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "a boolean");
  return value;
}

function parseEffort(value: unknown, path: string, stored: boolean): ClaudeEffortChoice {
  if (stored && value === undefined) return "default";
  return member(value, CLAUDE_EFFORT_CHOICES, path);
}

function launchProvider(value: unknown, path: string): AgentCliKind {
  if (value !== "claudeCode" && value !== "codex") invalid(path, "claudeCode or codex");
  return value;
}

function member<Choice extends string>(
  value: unknown,
  allowed: ReadonlyArray<Choice>,
  path: string,
): Choice {
  if (typeof value !== "string" || !(allowed as ReadonlyArray<string>).includes(value)) {
    invalid(path, `one of ${allowed.join(", ")}`);
  }
  return value as Choice;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: ReadonlyArray<string>,
  path: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    invalid(path, `exactly the fields ${expected.join(", ")}`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function unsupportedLaunchOptions(options: never): never {
  throw new TypeError(`Unsupported agent launch options: ${JSON.stringify(options)}.`);
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid agent launch value at ${path}: expected ${expectation}.`);
}
