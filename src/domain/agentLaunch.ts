import type { AgentCliKind } from "./agentTask";

export const CLAUDE_MODEL_CHOICES = ["default", "fable", "opus", "sonnet"] as const;
export type ClaudeModelChoice = (typeof CLAUDE_MODEL_CHOICES)[number];

export const CLAUDE_PERMISSION_MODES = [
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
] as const;
export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number];

export const CODEX_MODEL_CHOICES = ["default", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4"] as const;
export type CodexModelChoice = (typeof CODEX_MODEL_CHOICES)[number];

export const CODEX_EXECUTION_MODES = [
  "default",
  "readOnly",
  "workspaceWrite",
  "dangerFullAccess",
] as const;
export type CodexExecutionMode = (typeof CODEX_EXECUTION_MODES)[number];

export interface ClaudeLaunchOptions {
  readonly provider: "claudeCode";
  readonly model: ClaudeModelChoice;
  readonly mode: ClaudePermissionMode;
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
  claudeCode: { provider: "claudeCode", model: "default", mode: "default" },
  codex: { provider: "codex", model: "default", mode: "default" },
};

export function defaultAgentLaunchOptions(provider: AgentCliKind): AgentLaunchOptions {
  return DEFAULT_AGENT_LAUNCH_OPTIONS[provider];
}

export function parseAgentLaunchOptions(value: unknown, path: string): AgentLaunchOptions {
  const options = record(value, path);
  exactKeys(options, ["provider", "model", "mode"], path);
  const provider = launchProvider(options.provider, `${path}.provider`);
  if (provider === "claudeCode") {
    return {
      provider,
      model: member(options.model, CLAUDE_MODEL_CHOICES, `${path}.model`),
      mode: member(options.mode, CLAUDE_PERMISSION_MODES, `${path}.mode`),
    };
  }
  return {
    provider,
    model: member(options.model, CODEX_MODEL_CHOICES, `${path}.model`),
    mode: member(options.mode, CODEX_EXECUTION_MODES, `${path}.mode`),
  };
}

export function serializeAgentLaunchOptions(options: AgentLaunchOptions): Record<string, unknown> {
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
  return a.mode === b.mode;
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
