import { parseAgentCliVersion } from "../../domain/agentCliVersion";
import {
  CLAUDE_EFFORT_CHOICES,
  CLAUDE_PERMISSION_MODES,
  CODEX_EXECUTION_MODES,
  agentLaunchIsDangerous,
  type AgentExecutionTarget,
  type AgentLaunchOptions,
  type ClaudeEffortChoice,
  type ClaudeContextChoice,
  type ClaudeModelChoice,
  type ClaudePermissionMode,
  type CodexEffortChoice,
  type CodexExecutionMode,
  type CodexModelChoice,
} from "../../domain/agentLaunch";
import type { AgentCliKind } from "../../domain/agentTask";
import { NO_MODEL_NEWNESS, type ModelNewness } from "../../application/modelNewness";
import {
  BUNDLED_CLAUDE_MODEL_MANIFEST,
  claudeModelDescription,
  type ClaudeManifestModel,
  type ClaudeModelManifest,
} from "../../domain/claudeModelCatalog";
import {
  BUNDLED_CODEX_MODEL_CATALOG,
  type CodexModelCatalog,
} from "../../domain/codexModelCatalog";
import {
  CODEX_EFFORT_TEXT,
  codexDefaultModelHint,
  codexDefaultModelLabel,
  codexEffectiveModel,
  codexLaunchForDispatch,
  codexLaunchWithEffort,
  codexLaunchWithModel,
  codexModelRows,
  codexModelText,
} from "./codexLaunchPresentation";

export type AgentModelChoice = ClaudeModelChoice | CodexModelChoice;

export interface AgentModelRow {
  readonly value: AgentModelChoice;
  readonly label: string;
  readonly hint: string | null;
  readonly provider: AgentCliKind;
  readonly providerName: string;
  readonly favoriteKey: string;
  readonly legacyFavoriteKey?: string;
  readonly isLegacy?: boolean;
  readonly isNew: boolean;
  readonly isDefault: boolean;
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
    label: "Claude CLI settings",
    meta: "CLI settings",
    hint: "Uses the permission mode from your Claude CLI settings; anything it asks about waits for your approval here.",
  },
  plan: {
    label: "Plan mode",
    meta: "plan only",
    hint: "The agent plans without changing files, then waits for you to approve the plan or keep planning.",
  },
  supervised: {
    label: "Supervised",
    meta: "supervised",
    hint: "Asks before commands and file changes; you approve or deny each one here.",
  },
  acceptEdits: {
    label: "Auto-accept edits",
    meta: "auto-accept edits",
    hint: "Applies file edits without asking; asks for your approval before commands and other actions.",
  },
  auto: {
    label: "Auto",
    meta: "automatic approvals",
    hint: "Claude approves routine actions itself and asks for your approval when an action looks risky.",
  },
  bypassPermissions: {
    label: "Full access",
    meta: "bypass permissions",
    hint: "Allow commands and edits without prompts.",
  },
};

const REMOTE_APPROVAL_NOTE =
  "Approval prompts from remote runners cannot be answered in this editor yet.";

const REMOTE_CLAUDE_MODE_HINT: Partial<Record<ClaudePermissionMode, string>> = {
  default: `Uses the permission mode from the server's Claude CLI settings. ${REMOTE_APPROVAL_NOTE}`,
  plan: `The agent plans without changing files. ${REMOTE_APPROVAL_NOTE}`,
  supervised: `Asks before commands and file changes. ${REMOTE_APPROVAL_NOTE}`,
  acceptEdits: `Applies file edits without asking; other actions need approval. ${REMOTE_APPROVAL_NOTE}`,
  auto: `Claude approves routine actions itself; risky actions need approval. ${REMOTE_APPROVAL_NOTE}`,
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

const REMOTE_CODEX_MODE_HINT: Partial<Record<CodexExecutionMode, string>> = {
  default: `Uses the sandbox and approval policy from the server's Codex config.toml. ${REMOTE_APPROVAL_NOTE}`,
  workspaceWrite: `Writes only inside the workspace; other commands need approval. ${REMOTE_APPROVAL_NOTE}`,
  auto: `Works inside the workspace without asking; leaving the sandbox needs approval. ${REMOTE_APPROVAL_NOTE}`,
};

const CODEX_MODE_TEXT: Record<CodexExecutionMode, LaunchText> = {
  default: {
    label: "Codex config",
    meta: "Codex config",
    hint: "Uses the sandbox and approval policy configured in your Codex config.toml; any approval it requests waits for you here.",
  },
  readOnly: {
    label: "Read-only",
    meta: "read-only",
    hint: "Commands run without permission to change any file and never ask for more access.",
  },
  workspaceWrite: {
    label: "Workspace write",
    meta: "workspace write",
    hint: "Writes only inside the workspace and asks for your approval before commands that are not known to be safe.",
  },
  auto: {
    label: "Auto",
    meta: "automatic approvals",
    hint: "Works inside the workspace without asking and asks for your approval only when Codex needs to leave the sandbox.",
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
  codexCatalog: CodexModelCatalog = BUNDLED_CODEX_MODEL_CATALOG,
): ReadonlyArray<AgentLaunchChoice> {
  if (provider === "claudeCode") {
    return catalog.claudeCode.map((entry) => ({
      value: entry.choice,
      label: entry.label,
      hint: claudeModelDescription(entry) ?? "",
      tone: null,
    }));
  }
  return codexCatalog.models.map((entry) => ({
    value: entry.id,
    label: entry.label,
    hint: entry.description,
    tone: null,
  }));
}

export function agentModelRows(
  provider: AgentCliKind,
  configuredModel: string | null = null,
  providerVersion: string | null = null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
  codexCatalog: CodexModelCatalog = BUNDLED_CODEX_MODEL_CATALOG,
  newness: ModelNewness = NO_MODEL_NEWNESS,
): ReadonlyArray<AgentModelRow> {
  if (provider === "claudeCode") {
    const providerName = agentModelProviderName(provider);
    return catalog.claudeCode
      .filter((entry) =>
        versionSupports(entry.minVersion, entry.maxVersionExclusive, providerVersion),
      )
      .map((entry) => ({
        value: entry.choice,
        label: entry.label,
        hint: claudeModelDescription(entry),
        provider,
        providerName,
        favoriteKey: agentModelFavoriteKey(provider, entry.choice),
        isLegacy: entry.status === "legacy",
        isNew: newness.isNew(provider, entry.choice),
        isDefault: entry.isDefault === true,
      }));
  }
  const providerName = agentModelProviderName(provider);
  return codexModelRows(configuredModel, codexCatalog, newness).map(
    ({ ownsDefaultFavorite, ...row }) => ({
      ...row,
      provider,
      providerName,
      favoriteKey: agentModelFavoriteKey(provider, row.value),
      ...(ownsDefaultFavorite
        ? { legacyFavoriteKey: agentModelFavoriteKey(provider, "default") }
        : {}),
    }),
  );
}

export function agentClaudeModelChoiceForVersion(
  model: ClaudeModelChoice,
  providerVersion: string | null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): ClaudeModelChoice | null {
  const entry = manifestClaudeModel(model, null, catalog);
  if (entry === null) return null;
  if (!versionSupports(entry.minVersion, entry.maxVersionExclusive, providerVersion)) return null;
  return entry.choice;
}

export function agentLegacyModelsSummary(rows: ReadonlyArray<AgentModelRow>): string {
  const names = rows.map((row) => row.label.replace(/^Claude /u, ""));
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
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

export interface AgentLaunchModeGroups {
  readonly access: ReadonlyArray<AgentLaunchChoice>;
  readonly other: ReadonlyArray<AgentLaunchChoice>;
}

export function agentLaunchModeChoices(
  provider: AgentCliKind,
  target: AgentExecutionTarget = "local",
): ReadonlyArray<AgentLaunchChoice> {
  const groups = agentLaunchModeGroups(provider, target);
  return [...groups.access, ...groups.other];
}

export function agentLaunchModeGroups(
  provider: AgentCliKind,
  target: AgentExecutionTarget = "local",
): AgentLaunchModeGroups {
  if (provider === "claudeCode") {
    const text = cliSettingsRowText(
      targetModeText(CLAUDE_MODE_TEXT, REMOTE_CLAUDE_MODE_HINT, target),
      "Use Claude CLI settings",
    );
    const tone = (mode: ClaudePermissionMode) =>
      agentLaunchTone({ provider, model: "default", mode, effort: "default" });
    return {
      access: choices(
        ["supervised", "acceptEdits", "auto", "bypassPermissions"] as const,
        text,
        tone,
      ),
      other: choices(["plan", "default"] as const, text, tone),
    };
  }
  const text = cliSettingsRowText(
    targetModeText(CODEX_MODE_TEXT, REMOTE_CODEX_MODE_HINT, target),
    "Use Codex CLI settings",
  );
  const tone = (mode: CodexExecutionMode) => agentLaunchTone({ provider, model: "default", mode });
  return {
    access: choices(
      ["readOnly", "workspaceWrite", "auto", "dangerFullAccess"] as const,
      text,
      tone,
    ),
    other: choices(["default"] as const, text, tone),
  };
}

function cliSettingsRowText<Mode extends string>(
  text: Record<Mode | "default", LaunchText>,
  label: string,
): Record<Mode | "default", LaunchText> {
  return { ...text, default: { ...text.default, label } };
}

function targetModeText<Mode extends string>(
  text: Record<Mode, LaunchText>,
  remote: Partial<Record<Mode, string>>,
  target: AgentExecutionTarget,
): Record<Mode, LaunchText> {
  if (target === "local") return text;
  const entries = Object.entries(text) as [Mode, LaunchText][];
  return Object.fromEntries(
    entries.map(([mode, value]) => [mode, { ...value, hint: remote[mode] ?? value.hint }]),
  ) as Record<Mode, LaunchText>;
}

export function agentLaunchEffortChoices(): ReadonlyArray<AgentLaunchChoice> {
  return choices(
    CLAUDE_EFFORT_CHOICES.filter((effort) => effort !== "default"),
    CLAUDE_EFFORT_TEXT,
    () => null,
  );
}

export function agentLaunchSupportsEffort(launch: AgentLaunchOptions): boolean {
  return launch.provider === "claudeCode" || launch.provider === "codex";
}

export function agentLaunchEffortValue(
  launch: AgentLaunchOptions,
): ClaudeEffortChoice | CodexEffortChoice {
  if (launch.provider === "claudeCode") return launch.effort;
  return launch.effort ?? "default";
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
  codexCatalog: CodexModelCatalog = BUNDLED_CODEX_MODEL_CATALOG,
): AgentLaunchOptions {
  if (launch.provider === "codex") {
    return codexLaunchWithEffort(launch, value, configuredModel, codexCatalog);
  }
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
  codexCatalog: CodexModelCatalog = BUNDLED_CODEX_MODEL_CATALOG,
): string {
  if (launch.provider === "codex") {
    if (launch.model === "default") return codexDefaultModelLabel(configuredModel, codexCatalog);
    return codexModelText(launch.model, codexCatalog).label;
  }
  if (launch.model === "default") {
    const configured = configuredModelEntry(configuredModel, catalog)?.label;
    if (configured !== undefined) return configured;
    return (
      catalog.claudeCode.find((entry) => entry.isDefault)?.label ?? catalog.claudeCode[0].label
    );
  }
  return modelText(launch, catalog).label;
}

export function agentLaunchEffectiveModel(
  launch: AgentLaunchOptions,
  configuredModel: string | null = null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
  codexCatalog: CodexModelCatalog = BUNDLED_CODEX_MODEL_CATALOG,
): AgentModelChoice {
  if (launch.provider === "codex") {
    return codexEffectiveModel(launch.model, configuredModel, codexCatalog);
  }
  if (launch.model !== "default") return launch.model;
  const configured = configuredModelEntry(configuredModel, catalog)?.choice;
  if (configured !== undefined) return configured;
  return (
    catalog.claudeCode.find((entry) => entry.isDefault)?.choice ?? catalog.claudeCode[0].choice
  );
}

/** Resolves the display/default sentinel before a launch crosses into the CLI. */
export function agentLaunchForDispatch(
  launch: AgentLaunchOptions,
  configuredModel: string | null = null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
  codexCatalog: CodexModelCatalog = BUNDLED_CODEX_MODEL_CATALOG,
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
  return codexLaunchForDispatch(launch, configuredModel, codexCatalog);
}

export function agentLaunchModelHint(
  launch: AgentLaunchOptions,
  configuredModel: string | null = null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
  codexCatalog: CodexModelCatalog = BUNDLED_CODEX_MODEL_CATALOG,
): string | null {
  if (launch.provider === "codex") {
    if (launch.model === "default") return codexDefaultModelHint(configuredModel, codexCatalog);
    return codexModelText(launch.model, codexCatalog).hint;
  }
  if (launch.model === "default") {
    const configured = configuredModelEntry(configuredModel, catalog);
    if (configured !== null) {
      return withDescription(
        configured,
        `Selected by your ${agentModelProviderName(launch.provider)} configuration.`,
      );
    }
    const fallback = catalog.claudeCode.find((entry) => entry.isDefault) ?? catalog.claudeCode[0];
    return withDescription(fallback, "Selected by the Claude model catalog.");
  }
  return modelText(launch, catalog).hint;
}

export function agentLaunchModeLabel(launch: AgentLaunchOptions): string {
  return modeText(launch).label;
}

export function agentLaunchModeHint(
  launch: AgentLaunchOptions,
  target: AgentExecutionTarget = "local",
): string {
  if (target === "local") return modeText(launch).hint;
  const remote =
    launch.provider === "claudeCode"
      ? REMOTE_CLAUDE_MODE_HINT[launch.mode]
      : REMOTE_CODEX_MODE_HINT[launch.mode];
  return remote ?? modeText(launch).hint;
}

export function agentLaunchModelMeta(
  launch: AgentLaunchOptions,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
  codexCatalog: CodexModelCatalog = BUNDLED_CODEX_MODEL_CATALOG,
): string {
  return modelText(launch, catalog, codexCatalog).meta;
}

export function agentLaunchModeMeta(launch: AgentLaunchOptions): string {
  return modeText(launch).meta;
}

export function agentLaunchMetaLabel(
  launch: AgentLaunchOptions,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
  codexCatalog: CodexModelCatalog = BUNDLED_CODEX_MODEL_CATALOG,
): string {
  const base = `${agentLaunchModelMeta(launch, catalog, codexCatalog)} · ${agentLaunchModeMeta(launch)}`;
  if (agentLaunchEffortValue(launch) === "default") return base;
  return `${base} · ${agentLaunchEffortMeta(launch)}`;
}

export function agentLaunchSummaryLabel(
  launch: AgentLaunchOptions,
  configuredModel: string | null = null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
  codexCatalog: CodexModelCatalog = BUNDLED_CODEX_MODEL_CATALOG,
): string {
  const base = `${agentLaunchModelLabel(launch, configuredModel, catalog, codexCatalog)} · ${agentLaunchModeLabel(launch)}`;
  if (agentLaunchEffortValue(launch) === "default") return base;
  return `${base} · ${agentLaunchEffortLabel(launch)}`;
}

export function agentLaunchWithModel(
  launch: AgentLaunchOptions,
  value: string,
  configuredModel: string | null = null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
  codexCatalog: CodexModelCatalog = BUNDLED_CODEX_MODEL_CATALOG,
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
  return codexLaunchWithModel(launch, value, codexCatalog);
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

interface ModelText {
  readonly label: string;
  readonly meta: string;
  readonly hint: string | null;
}

function modelText(
  launch: AgentLaunchOptions,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
  codexCatalog: CodexModelCatalog = BUNDLED_CODEX_MODEL_CATALOG,
): ModelText {
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
      hint: entry === null ? `Runs the session on ${launch.model}.` : claudeModelDescription(entry),
    };
  }
  return codexModelText(launch.model, codexCatalog);
}

function withDescription(entry: ClaudeManifestModel, note: string): string {
  const description = claudeModelDescription(entry);
  return description === null ? note : `${description} ${note}`;
}

function modeText(launch: AgentLaunchOptions): LaunchText {
  if (launch.provider === "claudeCode") return CLAUDE_MODE_TEXT[launch.mode];
  return CODEX_MODE_TEXT[launch.mode];
}

function effortText(launch: AgentLaunchOptions): LaunchText {
  if (launch.provider === "codex") return CODEX_EFFORT_TEXT[launch.effort ?? "default"];
  return CLAUDE_EFFORT_TEXT[launch.effort];
}

function manifestClaudeModel(
  model: ClaudeModelChoice,
  configuredModel: string | null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): ClaudeManifestModel | null {
  if (model === "default") {
    return configuredModelEntry(configuredModel, catalog);
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
  configuredModel: string | null,
  catalog: ClaudeModelManifest = BUNDLED_CLAUDE_MODEL_MANIFEST,
): ClaudeManifestModel | null {
  if (configuredModel === null) return null;
  const base = configuredModel.replace(/\[[^\]]+\]$/, "");
  return (
    catalog.claudeCode.find((entry) => entry.choice === base || entry.runtimeIds.includes(base)) ??
    null
  );
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
