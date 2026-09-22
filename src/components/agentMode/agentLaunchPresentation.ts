import { parseAgentCliVersion } from "../../domain/agentCliVersion";
import {
  CLAUDE_EFFORT_CHOICES,
  CLAUDE_PERMISSION_MODES,
  CODEX_EXECUTION_MODES,
  CODEX_MODEL_CHOICES,
  agentLaunchIsDangerous,
  type AgentExecutionTarget,
  type AgentLaunchOptions,
  type ClaudeEffortChoice,
  type ClaudeContextChoice,
  type ClaudeModelChoice,
  type ClaudePermissionMode,
  type CodexExecutionMode,
  type CodexModelChoice,
} from "../../domain/agentLaunch";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  BUNDLED_CLAUDE_MODEL_MANIFEST,
  type ClaudeManifestModel,
  type ClaudeModelManifest,
} from "../../domain/claudeModelCatalog";
import modelManifest from "../../domain/agentModelManifest.json";

export type AgentModelChoice = ClaudeModelChoice | CodexModelChoice;

export interface AgentModelRow {
  readonly value: AgentModelChoice;
  readonly label: string;
  readonly hint: string;
  readonly provider: AgentCliKind;
  readonly providerName: string;
  readonly favoriteKey: string;
  readonly legacyFavoriteKey?: string;
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

export function agentLaunchModelChoices(
  provider: AgentCliKind,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): ReadonlyArray<AgentLaunchChoice> {
  if (provider === "claudeCode") {
    return catalog.claudeCode.map((entry) => ({
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
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): ReadonlyArray<AgentModelRow> {
  const configured = configuredModelEntry(provider, configuredModel, catalog);
  if (provider === "claudeCode") {
    const providerName = agentModelProviderName(provider);
    return catalog.claudeCode
      .filter((entry) =>
        versionSupports(entry.minVersion, entry.maxVersionExclusive, providerVersion),
      )
      .map((entry) => ({
        value: entry.choice,
        label: entry.label,
        hint: entry.description,
        provider,
        providerName,
        favoriteKey: agentModelFavoriteKey(provider, entry.choice),
        isLegacy: entry.status === "legacy",
      }));
  }
  return modelRows(
    provider,
    CODEX_MODEL_CHOICES,
    CODEX_MODEL_TEXT,
    configured ??
      (modelManifest.codex as ReadonlyArray<ManifestModel>).find((entry) => entry.isDefault) ??
      null,
  );
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
    if (filter === "favorites" && !agentModelRowIsFavorite(row, favorites)) return false;
    return agentModelRowMatches(row, query);
  });
}

/** Preserve the old configured-default favorite until the user removes it. */
export function agentModelRowIsFavorite(row: AgentModelRow, keys: ReadonlySet<string>): boolean {
  return (
    keys.has(row.favoriteKey) ||
    (row.legacyFavoriteKey !== undefined && keys.has(row.legacyFavoriteKey))
  );
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
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): AgentLaunchOptions {
  if (launch.provider !== "claudeCode") return launch;
  const effort = pick(CLAUDE_EFFORT_CHOICES, value);
  if (effort === null) return launch;
  const model = explicitConfiguredClaudeModel(launch.model, configuredModel, catalog);
  return { ...launch, model, effort };
}

export function agentLaunchContextLabel(context: ClaudeContextChoice): string {
  return context === "1m" ? "1M" : "200k";
}

export function agentLaunchWithContext(
  launch: AgentLaunchOptions,
  context: ClaudeContextChoice,
  configuredModel: string | null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): AgentLaunchOptions {
  if (launch.provider !== "claudeCode") return launch;
  const model = explicitConfiguredClaudeModel(launch.model, configuredModel, catalog);
  return { ...launch, model: model as ClaudeModelChoice, context };
}

export function agentLaunchWithFastMode(
  launch: AgentLaunchOptions,
  fastMode: boolean,
  configuredModel: string | null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): AgentLaunchOptions {
  if (launch.provider !== "claudeCode") return launch;
  return {
    ...launch,
    model: explicitConfiguredClaudeModel(launch.model, configuredModel, catalog),
    fastMode,
  };
}

export function agentLaunchWithThinkingMode(
  launch: AgentLaunchOptions,
  thinkingMode: boolean,
  configuredModel: string | null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): AgentLaunchOptions {
  if (launch.provider !== "claudeCode") return launch;
  return {
    ...launch,
    model: explicitConfiguredClaudeModel(launch.model, configuredModel, catalog),
    thinkingMode,
  };
}

export function agentLaunchWithChrome(
  launch: AgentLaunchOptions,
  chrome: boolean,
  configuredModel: string | null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): AgentLaunchOptions {
  if (launch.provider !== "claudeCode") return launch;
  return {
    ...launch,
    model: explicitConfiguredClaudeModel(launch.model, configuredModel, catalog),
    chrome,
  };
}

export interface ClaudeLaunchTraits {
  readonly efforts: ReadonlyArray<Exclude<ClaudeEffortChoice, "default">>;
  readonly defaultEffort: ClaudeEffortChoice;
  readonly contextWindows: ReadonlyArray<ClaudeContextChoice>;
  readonly defaultContext: ClaudeContextChoice | null;
  readonly fastMode: boolean;
  readonly thinkingMode: boolean;
  readonly chrome: boolean;
}

export function agentClaudeLaunchTraits(
  launch: AgentLaunchOptions & { readonly provider: "claudeCode" },
  configuredModel: string | null,
  executionTarget: AgentExecutionTarget,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): ClaudeLaunchTraits {
  const entry =
    manifestClaudeModel(launch.model, configuredModel, catalog) ??
    catalog.claudeCode.find((candidate) => candidate.isDefault) ??
    catalog.claudeCode[0];
  return {
    efforts: entry.efforts,
    defaultEffort: entry.defaultEffort,
    contextWindows: entry.contextWindows,
    defaultContext: entry.defaultContext,
    fastMode: entry.fastMode,
    thinkingMode: entry.thinkingMode,
    chrome: executionTarget === "local",
  };
}

export function agentLaunchModelLabel(
  launch: AgentLaunchOptions,
  configuredModel: string | null = null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): string {
  if (launch.model === "default") {
    const configured = configuredModelEntry(launch.provider, configuredModel, catalog)?.label;
    if (configured !== undefined) return configured;
    if (launch.provider === "claudeCode") {
      return (
        catalog.claudeCode.find((entry) => entry.isDefault)?.label ?? catalog.claudeCode[0].label
      );
    }
    return (
      (modelManifest.codex as ReadonlyArray<ManifestModel>).find((entry) => entry.isDefault)
        ?.label ?? modelText(launch, catalog).label
    );
  }
  return modelText(launch, catalog).label;
}

export function agentLaunchEffectiveModel(
  launch: AgentLaunchOptions,
  configuredModel: string | null = null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): AgentModelChoice {
  if (launch.model !== "default") return launch.model;
  const configured = configuredModelEntry(launch.provider, configuredModel, catalog)?.choice;
  if (configured !== undefined) return configured;
  if (launch.provider === "claudeCode") {
    return (
      catalog.claudeCode.find((entry) => entry.isDefault)?.choice ?? catalog.claudeCode[0].choice
    );
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
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): AgentLaunchOptions {
  if (launch.provider === "claudeCode") {
    const model = explicitConfiguredClaudeModel(launch.model, configuredModel, catalog);
    const entry = manifestClaudeModel(model, configuredModel, catalog);
    // Preserve removed selections so the authoritative launch boundary can reject them.
    if (entry === null) return launch;
    return {
      ...launch,
      model,
      effort:
        launch.effort !== "default" && entry.efforts.includes(launch.effort)
          ? launch.effort
          : entry.defaultEffort,
      context:
        launch.context !== undefined && entry.contextWindows.includes(launch.context)
          ? launch.context
          : (entry.defaultContext ?? undefined),
      ...(launch.fastMode && !entry.fastMode ? { fastMode: false } : {}),
      ...(launch.thinkingMode && !entry.thinkingMode ? { thinkingMode: false } : {}),
    };
  }
  if (launch.model !== "default") return launch;
  const model = agentLaunchEffectiveModel(launch, configuredModel, catalog);
  return model === "default" ? launch : { ...launch, model: model as CodexModelChoice };
}

export function agentLaunchModelHint(
  launch: AgentLaunchOptions,
  configuredModel: string | null = null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): string {
  if (launch.model === "default") {
    const configured = configuredModelEntry(launch.provider, configuredModel, catalog);
    if (configured !== null) {
      return `${configured.description} Selected by your ${agentModelProviderName(launch.provider)} configuration.`;
    }
    if (launch.provider === "claudeCode") {
      const fallback = catalog.claudeCode.find((entry) => entry.isDefault) ?? catalog.claudeCode[0];
      return `${fallback.description} Selected by the Claude model catalog.`;
    }
    const fallback = (modelManifest.codex as ReadonlyArray<ManifestModel>).find(
      (entry) => entry.isDefault,
    );
    if (fallback !== undefined) {
      return `${fallback.description} Selected by the Codex model catalog.`;
    }
  }
  return modelText(launch, catalog).hint;
}

export function agentLaunchModeLabel(launch: AgentLaunchOptions): string {
  return modeText(launch).label;
}

export function agentLaunchModeHint(launch: AgentLaunchOptions): string {
  return modeText(launch).hint;
}

export function agentLaunchModelMeta(
  launch: AgentLaunchOptions,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): string {
  return modelText(launch, catalog).meta;
}

export function agentLaunchModeMeta(launch: AgentLaunchOptions): string {
  return modeText(launch).meta;
}

export function agentLaunchMetaLabel(
  launch: AgentLaunchOptions,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): string {
  const base = `${agentLaunchModelMeta(launch, catalog)} · ${agentLaunchModeMeta(launch)}`;
  if (agentLaunchEffortValue(launch) === "default") return base;
  return `${base} · ${agentLaunchEffortMeta(launch)}`;
}

export function agentLaunchSummaryLabel(
  launch: AgentLaunchOptions,
  configuredModel: string | null = null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): string {
  const base = `${agentLaunchModelLabel(launch, configuredModel, catalog)} · ${agentLaunchModeLabel(launch)}`;
  if (agentLaunchEffortValue(launch) === "default") return base;
  return `${base} · ${agentLaunchEffortLabel(launch)}`;
}

export function agentLaunchWithModel(
  launch: AgentLaunchOptions,
  value: string,
  configuredModel: string | null = null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): AgentLaunchOptions {
  if (launch.provider === "claudeCode") {
    const model =
      value === "default"
        ? "default"
        : (catalog.claudeCode.find(
            (entry) => entry.choice === value || entry.runtimeIds.includes(value),
          )?.choice ?? null);
    if (model === null) return launch;
    const traits = manifestClaudeModel(model, configuredModel, catalog);
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

function modelText(
  launch: AgentLaunchOptions,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): LaunchText {
  if (launch.provider === "claudeCode") {
    if (launch.model === "default")
      return {
        label: "Auto (Claude Code)",
        meta: "automatic model",
        hint: "No model override. Claude CLI chooses the model from its settings.",
      };
    const entry = manifestClaudeModel(launch.model, null, catalog);
    return {
      label: entry?.label ?? launch.model,
      meta: launch.model.replace(/^claude-/, ""),
      hint: entry?.description ?? `Runs the session on ${launch.model}.`,
    };
  }
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
    .filter((value) => value !== "default")
    .map((value) => ({
      value,
      label: text[value].label,
      hint:
        value === configured?.choice
          ? `${configured.description} Selected by your ${providerName} configuration.`
          : text[value].hint,
      provider,
      providerName,
      favoriteKey: agentModelFavoriteKey(provider, value),
      ...(value === configured?.choice
        ? { legacyFavoriteKey: agentModelFavoriteKey(provider, "default") }
        : {}),
    }));
}

interface ManifestModel {
  readonly choice: AgentModelChoice;
  readonly label: string;
  readonly runtimeIds: ReadonlyArray<string>;
  readonly description: string;
  readonly isDefault?: boolean;
}

function manifestClaudeModel(
  model: ClaudeModelChoice,
  configuredModel: string | null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): ClaudeManifestModel | null {
  if (model === "default") {
    return configuredModelEntry(
      "claudeCode",
      configuredModel,
      catalog,
    ) as ClaudeManifestModel | null;
  }
  return (
    catalog.claudeCode.find(
      (entry) => entry.choice === model || entry.runtimeIds.includes(model),
    ) ?? null
  );
}

function explicitConfiguredClaudeModel(
  model: ClaudeModelChoice,
  configuredModel: string | null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): ClaudeModelChoice {
  if (model !== "default") return model;
  return (
    manifestClaudeModel(model, configuredModel, catalog)?.choice ??
    catalog.claudeCode.find((entry) => entry.isDefault)?.choice ??
    catalog.claudeCode[0].choice
  );
}

function configuredModelEntry(
  provider: AgentCliKind,
  configuredModel: string | null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): ManifestModel | null {
  if (configuredModel === null) return null;
  const base = configuredModel.replace(/\[[^\]]+\]$/, "");
  const entries =
    provider === "claudeCode"
      ? catalog.claudeCode
      : (modelManifest.codex as ReadonlyArray<ManifestModel>);
  return entries.find((entry) => entry.choice === base || entry.runtimeIds.includes(base)) ?? null;
}

function versionSupports(
  minVersion: string | undefined,
  maxVersionExclusive: string | undefined,
  providerVersion: string | null,
): boolean {
  if (providerVersion === null) return true;
  const actual = parseAgentCliVersion(providerVersion);
  if (actual === null) return minVersion === undefined && maxVersionExclusive === undefined;
  const [numeric, prerelease] = actual.split("-");
  const compare = (bound: string): number => {
    const left = numeric.split(".").map(Number);
    const right = bound.split(".").map(Number);
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const difference = (left[index] ?? 0) - (right[index] ?? 0);
      if (difference !== 0) return difference;
    }
    // Manifest bounds are validated stable triplets; a prerelease sorts below its release.
    return prerelease === undefined ? 0 : -1;
  };
  return (
    (minVersion === undefined || compare(minVersion) >= 0) &&
    (maxVersionExclusive === undefined || compare(maxVersionExclusive) < 0)
  );
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
