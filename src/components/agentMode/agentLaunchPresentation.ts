import {
  CLAUDE_EFFORT_CHOICES,
  CLAUDE_MODEL_CHOICES,
  CLAUDE_PERMISSION_MODES,
  CODEX_EXECUTION_MODES,
  CODEX_MODEL_CHOICES,
  agentLaunchIsDangerous,
  type AgentLaunchOptions,
  type ClaudeEffortChoice,
  type ClaudeContextChoice,
  type ClaudeModelChoice,
  type ClaudePermissionMode,
  type CodexExecutionMode,
  type CodexModelChoice,
} from "../../domain/agentLaunch";
import type { AgentCliKind } from "../../domain/agentTask";
import modelManifest from "../../domain/agentModelManifest.json";

export type AgentModelChoice = ClaudeModelChoice | CodexModelChoice;

export interface AgentModelRow {
  readonly value: AgentModelChoice;
  readonly label: string;
  readonly hint: string;
  readonly provider: AgentCliKind;
  readonly providerName: string;
  readonly favoriteKey: string;
  readonly isLegacy?: boolean;
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
    label: "Auto (Claude Code)",
    meta: "automatic model",
    hint: "No model override. Claude CLI chooses the model from its settings.",
  },
  fable: {
    label: "Claude Fable 5.1",
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
  "claude-fable-5-1": {
    label: "Claude Fable 5.1",
    meta: "fable-5.1",
    hint: "Runs the session on Claude Fable 5.1.",
  },
  "claude-fable-5": {
    label: "Claude Fable 5",
    meta: "fable-5",
    hint: "Runs the session on the legacy Claude Fable 5 model.",
  },
  "claude-opus-5": {
    label: "Claude Opus 5",
    meta: "opus-5",
    hint: "Runs the session on Claude Opus 5.",
  },
  "claude-opus-4-8": {
    label: "Claude Opus 4.8",
    meta: "opus-4.8",
    hint: "Runs the session on the legacy Claude Opus 4.8 model.",
  },
  "claude-opus-4-7": {
    label: "Claude Opus 4.7",
    meta: "opus-4.7",
    hint: "Runs the session on the legacy Claude Opus 4.7 model.",
  },
  "claude-opus-4-6": {
    label: "Claude Opus 4.6",
    meta: "opus-4.6",
    hint: "Runs the session on the legacy Claude Opus 4.6 model.",
  },
  "claude-opus-4-5": {
    label: "Claude Opus 4.5",
    meta: "opus-4.5",
    hint: "Runs the session on the legacy Claude Opus 4.5 model.",
  },
  "claude-sonnet-5": {
    label: "Claude Sonnet 5",
    meta: "sonnet-5",
    hint: "Runs the session on Claude Sonnet 5.",
  },
  "claude-sonnet-4-6": {
    label: "Claude Sonnet 4.6",
    meta: "sonnet-4.6",
    hint: "Runs the session on the legacy Claude Sonnet 4.6 model.",
  },
  "claude-haiku-4-5": {
    label: "Claude Haiku 4.5",
    meta: "haiku-4.5",
    hint: "Runs the session on the legacy Claude Haiku 4.5 model.",
  },
};

const CLAUDE_MODE_TEXT: Record<ClaudePermissionMode, LaunchText> = {
  default: {
    label: "Auto",
    meta: "automatic access",
    hint: "Uses the access mode configured in Claude CLI.",
  },
  plan: {
    label: "Plan mode",
    meta: "plan only",
    hint: "The agent plans the work and does not change files.",
  },
  supervised: {
    label: "Supervised",
    meta: "supervised",
    hint: "Asks before commands and file changes.",
  },
  acceptEdits: {
    label: "Auto-accept edits",
    meta: "auto-accept edits",
    hint: "Auto-approve edits, ask before other actions.",
  },
  auto: {
    label: "Auto",
    meta: "automatic approvals",
    hint: "Supported providers approve routine actions; others still ask.",
  },
  bypassPermissions: {
    label: "Full access",
    meta: "bypass permissions",
    hint: "Allow commands and edits without prompts.",
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
  ultracode: {
    label: "Ultracode",
    meta: "ultracode",
    hint: "Uses xhigh effort plus Claude Code multi-agent workflow orchestration.",
  },
  ultrathink: {
    label: "Ultrathink",
    meta: "ultrathink",
    hint: "Prefixes ordinary prompts with Ultrathink while preserving slash commands.",
  },
};

const CODEX_MODEL_TEXT: Record<CodexModelChoice, LaunchText> = {
  default: {
    label: "Auto (Codex)",
    meta: "automatic model",
    hint: "No model override. Codex CLI chooses the model from its settings.",
  },
  "gpt-6-astra": {
    label: "GPT-6 Astra",
    meta: "gpt-6-astra",
    hint: "Runs the session on gpt-6-astra.",
  },
  "gpt-5.6-sol": {
    label: "GPT-5.6 Sol",
    meta: "gpt-5.6-sol",
    hint: "Runs the session on gpt-5.6-sol.",
  },
  "gpt-5.6-terra": {
    label: "GPT-5.6 Terra",
    meta: "gpt-5.6-terra",
    hint: "Runs the session on gpt-5.6-terra.",
  },
  "gpt-5.6-luna": {
    label: "GPT-5.6 Luna",
    meta: "gpt-5.6-luna",
    hint: "Runs the session on gpt-5.6-luna.",
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
    label: "Auto",
    meta: "automatic access",
    hint: "Uses the sandbox and approval policy configured in Codex CLI.",
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
  auto: {
    label: "Auto",
    meta: "automatic approvals",
    hint: "Approves routine actions automatically inside the workspace.",
  },
  dangerFullAccess: {
    label: "Full access",
    meta: "full access",
    hint: "Skips the sandbox and every approval; commands run with your full access.",
  },
};

export function agentLaunchModelChoices(provider: AgentCliKind): ReadonlyArray<AgentLaunchChoice> {
  if (provider === "claudeCode") {
    return CLAUDE_MANIFEST.map((entry) => ({
      value: entry.choice,
      label: entry.label,
      hint: entry.description,
      tone: null,
    }));
  }
  return choices(
    CODEX_MODEL_CHOICES.filter((model) => model !== "default"),
    CODEX_MODEL_TEXT,
    () => null,
  );
}

export function agentModelRows(
  provider: AgentCliKind,
  configuredModel: string | null = null,
  providerVersion: string | null = null,
): ReadonlyArray<AgentModelRow> {
  const configured = configuredModelEntry(provider, configuredModel);
  if (provider === "claudeCode") {
    const providerName = agentModelProviderName(provider);
    return CLAUDE_MANIFEST.filter((entry) =>
      versionSupports(entry.minVersion, providerVersion),
    ).map((entry) => ({
      value: entry.choice,
      label: entry.label,
      hint: entry.description,
      provider,
      providerName,
      favoriteKey: agentModelFavoriteKey(provider, entry.choice),
      isLegacy: entry.status === "legacy",
    }));
  }
  const resolvedConfigured =
    configured ??
    (modelManifest.codex as ReadonlyArray<ManifestModel>).find((entry) => entry.isDefault) ??
    null;
  return modelRows(provider, CODEX_MODEL_CHOICES, CODEX_MODEL_TEXT, resolvedConfigured);
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
    return choices(
      ["supervised", "acceptEdits", "auto", "bypassPermissions"] as const,
      CLAUDE_MODE_TEXT,
      (mode) => agentLaunchTone({ provider, model: "default", mode, effort: "default" }),
    );
  }
  return choices(
    ["readOnly", "workspaceWrite", "auto", "dangerFullAccess"] as const,
    CODEX_MODE_TEXT,
    (mode) => agentLaunchTone({ provider, model: "default", mode }),
  );
}

export function agentLaunchEffortChoices(): ReadonlyArray<AgentLaunchChoice> {
  return choices(
    CLAUDE_EFFORT_CHOICES.filter((effort) => effort !== "default"),
    CLAUDE_EFFORT_TEXT,
    () => null,
  );
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
  configuredModel: string | null = null,
): AgentLaunchOptions {
  if (launch.provider !== "claudeCode") return launch;
  const effort = pick(CLAUDE_EFFORT_CHOICES, value);
  if (effort === null) return launch;
  const model = explicitConfiguredClaudeModel(launch.model, configuredModel);
  return { ...launch, model, effort };
}

export function agentLaunchContextLabel(context: ClaudeContextChoice): string {
  return context === "1m" ? "1M" : "200k";
}

export function agentLaunchWithContext(
  launch: AgentLaunchOptions,
  context: ClaudeContextChoice,
  configuredModel: string | null,
): AgentLaunchOptions {
  if (launch.provider !== "claudeCode") return launch;
  const model = explicitConfiguredClaudeModel(launch.model, configuredModel);
  if (!CLAUDE_MODEL_CHOICES.includes(model as ClaudeModelChoice)) return launch;
  return { ...launch, model: model as ClaudeModelChoice, context };
}

export function agentLaunchWithFastMode(
  launch: AgentLaunchOptions,
  fastMode: boolean,
  configuredModel: string | null,
): AgentLaunchOptions {
  if (launch.provider !== "claudeCode") return launch;
  return {
    ...launch,
    model: explicitConfiguredClaudeModel(launch.model, configuredModel),
    fastMode,
  };
}

export function agentLaunchWithThinkingMode(
  launch: AgentLaunchOptions,
  thinkingMode: boolean,
  configuredModel: string | null,
): AgentLaunchOptions {
  if (launch.provider !== "claudeCode") return launch;
  return {
    ...launch,
    model: explicitConfiguredClaudeModel(launch.model, configuredModel),
    thinkingMode,
  };
}

export interface ClaudeLaunchTraits {
  readonly efforts: ReadonlyArray<Exclude<ClaudeEffortChoice, "default">>;
  readonly defaultEffort: ClaudeEffortChoice;
  readonly contextWindows: ReadonlyArray<ClaudeContextChoice>;
  readonly defaultContext: ClaudeContextChoice | null;
  readonly fastMode: boolean;
  readonly thinkingMode: boolean;
}

export function agentClaudeLaunchTraits(
  launch: AgentLaunchOptions & { readonly provider: "claudeCode" },
  configuredModel: string | null,
): ClaudeLaunchTraits {
  const entry =
    manifestClaudeModel(launch.model, configuredModel) ??
    CLAUDE_MANIFEST.find((candidate) => candidate.isDefault) ??
    CLAUDE_MANIFEST[0];
  return {
    efforts: entry.efforts,
    defaultEffort: entry.defaultEffort,
    contextWindows: entry.contextWindows,
    defaultContext: entry.defaultContext,
    fastMode: entry.fastMode,
    thinkingMode: entry.thinkingMode,
  };
}

export function agentLaunchModelLabel(
  launch: AgentLaunchOptions,
  configuredModel: string | null = null,
): string {
  if (launch.model === "default") {
    const configured = configuredModelEntry(launch.provider, configuredModel)?.label;
    if (configured !== undefined) return configured;
    if (launch.provider === "claudeCode") {
      return CLAUDE_MANIFEST.find((entry) => entry.isDefault)?.label ?? CLAUDE_MANIFEST[0].label;
    }
    return (
      (modelManifest.codex as ReadonlyArray<ManifestModel>).find((entry) => entry.isDefault)
        ?.label ?? modelText(launch).label
    );
  }
  return modelText(launch).label;
}

export function agentLaunchEffectiveModel(
  launch: AgentLaunchOptions,
  configuredModel: string | null = null,
): AgentModelChoice {
  if (launch.model !== "default") return launch.model;
  const configured = configuredModelEntry(launch.provider, configuredModel)?.choice;
  if (configured !== undefined) return configured;
  if (launch.provider === "claudeCode") {
    return CLAUDE_MANIFEST.find((entry) => entry.isDefault)?.choice ?? CLAUDE_MANIFEST[0].choice;
  }
  return (
    (modelManifest.codex as ReadonlyArray<ManifestModel>).find((entry) => entry.isDefault)
      ?.choice ?? launch.model
  );
}

/** Resolves the display/default sentinel before a launch crosses into the CLI. */
export function agentLaunchForDispatch(
  launch: AgentLaunchOptions,
  configuredModel: string | null = null,
): AgentLaunchOptions {
  if (launch.model !== "default") return launch;
  if (launch.provider === "claudeCode") {
    return { ...launch, model: explicitConfiguredClaudeModel(launch.model, configuredModel) };
  }
  const model = agentLaunchEffectiveModel(launch, configuredModel);
  return model === "default" ? launch : { ...launch, model: model as CodexModelChoice };
}

export function agentLaunchModelHint(
  launch: AgentLaunchOptions,
  configuredModel: string | null = null,
): string {
  if (launch.model === "default") {
    const configured = configuredModelEntry(launch.provider, configuredModel);
    if (configured !== null) {
      return `${configured.description} Selected by your ${agentModelProviderName(launch.provider)} configuration.`;
    }
    if (launch.provider === "claudeCode") {
      const fallback = CLAUDE_MANIFEST.find((entry) => entry.isDefault) ?? CLAUDE_MANIFEST[0];
      return `${fallback.description} Selected by the Claude model catalog.`;
    }
    const fallback = (modelManifest.codex as ReadonlyArray<ManifestModel>).find(
      (entry) => entry.isDefault,
    );
    if (fallback !== undefined) {
      return `${fallback.description} Selected by the Codex model catalog.`;
    }
  }
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
  configuredModel: string | null = null,
): AgentLaunchOptions {
  if (launch.provider === "claudeCode") {
    const model = pick(CLAUDE_MODEL_CHOICES, value);
    if (model === null) return launch;
    const traits = manifestClaudeModel(model, configuredModel);
    if (traits === null) return { ...launch, model };
    return {
      ...launch,
      model,
      effort: traits.defaultEffort,
      ...(traits.defaultContext === null
        ? { context: undefined }
        : { context: traits.defaultContext }),
      fastMode: false,
      thinkingMode: false,
    };
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
  configured: ManifestModel | null,
): ReadonlyArray<AgentModelRow> {
  const providerName = agentModelProviderName(provider);
  return values
    .filter((value) => value === "default" || value !== configured?.choice)
    .map((value) => ({
      value,
      label: value === "default" && configured !== null ? configured.label : text[value].label,
      hint:
        value === "default" && configured !== null
          ? `${configured.description} Selected by your ${providerName} configuration.`
          : text[value].hint,
      provider,
      providerName,
      favoriteKey: agentModelFavoriteKey(provider, value),
    }));
}

interface ManifestModel {
  readonly choice: AgentModelChoice;
  readonly label: string;
  readonly runtimeIds: ReadonlyArray<string>;
  readonly description: string;
  readonly isDefault?: boolean;
}

interface ClaudeManifestModel extends ManifestModel {
  readonly choice: ClaudeModelChoice;
  readonly efforts: ReadonlyArray<Exclude<ClaudeEffortChoice, "default">>;
  readonly defaultEffort: ClaudeEffortChoice;
  readonly contextWindows: ReadonlyArray<ClaudeContextChoice>;
  readonly defaultContext: ClaudeContextChoice | null;
  readonly fastMode: boolean;
  readonly thinkingMode: boolean;
  readonly status: "current" | "legacy";
  readonly minVersion?: string;
}

const CLAUDE_MANIFEST = modelManifest.claudeCode as ReadonlyArray<ClaudeManifestModel>;

function manifestClaudeModel(
  model: ClaudeModelChoice,
  configuredModel: string | null,
): ClaudeManifestModel | null {
  if (model === "default") {
    return configuredModelEntry("claudeCode", configuredModel) as ClaudeManifestModel | null;
  }
  return (
    CLAUDE_MANIFEST.find((entry) => entry.choice === model || entry.runtimeIds.includes(model)) ??
    null
  );
}

function explicitConfiguredClaudeModel(
  model: ClaudeModelChoice,
  configuredModel: string | null,
): ClaudeModelChoice {
  if (model !== "default") return model;
  return (
    manifestClaudeModel(model, configuredModel)?.choice ??
    CLAUDE_MANIFEST.find((entry) => entry.isDefault)?.choice ??
    CLAUDE_MANIFEST[0].choice
  );
}

function configuredModelEntry(
  provider: AgentCliKind,
  configuredModel: string | null,
): ManifestModel | null {
  if (configuredModel === null) return null;
  const base = configuredModel.replace(/\[[^\]]+\]$/, "");
  const entries = modelManifest[provider] as ReadonlyArray<ManifestModel>;
  return entries.find((entry) => entry.runtimeIds.includes(base)) ?? null;
}

function versionSupports(minVersion: string | undefined, providerVersion: string | null): boolean {
  if (minVersion === undefined || providerVersion === null) return true;
  const actual = providerVersion.match(/\d+(?:\.\d+){1,2}/)?.[0];
  if (actual === undefined) return true;
  const left = actual.split(".").map(Number);
  const right = minVersion.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
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
