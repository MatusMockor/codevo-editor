import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import {
  CLAUDE_EFFORT_CHOICES,
  CODEX_EFFORT_CHOICES,
  isClaudeModelChoice,
  isCodexModelChoice,
  type AgentLaunchOptions,
  type ClaudeEffortChoice,
  type ClaudeLaunchOptions,
  type ClaudeModelChoice,
  type CodexEffortLevel,
  type CodexLaunchOptions,
  type CodexModelChoice,
} from "../../domain/agentLaunch";
import type {
  AgentNewThreadDefaults,
  AgentNewThreadLaunchSource,
} from "../../domain/agentNewThreadDefaults";
import type { AgentProviderPreferences } from "../../domain/agentProviderSettings";
import type { AgentCliKind } from "../../domain/agentSettings";
import type { ClaudeModelManifest } from "../../domain/claudeModelCatalog";
import type { CodexModelCatalog } from "../../domain/codexModelCatalog";
import {
  availableNewThreadDefaults,
  newThreadComposerLaunch,
} from "../agentMode/agentComposerLaunch";
import {
  agentClaudeLaunchTraits,
  agentLaunchContextLabel,
  agentLaunchEffectiveModel,
  agentLaunchEffortLabel,
  agentLaunchEffortValue,
  agentLaunchForDispatch,
  agentLaunchModelLabel,
  agentModelRows,
} from "../agentMode/agentLaunchPresentation";
import {
  configuredProviderModel,
  configuredProviderVersion,
} from "../agentMode/agentModelProviderState";
import { codexLaunchTraits } from "../agentMode/codexLaunchPresentation";
import { providerLabel, unsupportedProviderValue } from "./agentProviderCardPresentation";
import { AGENT_PROVIDERS } from "./agentProviderSettingsPersistence";
import type { SettingsSegmentedOption } from "./primitives/SettingsSegmented";
import type { SettingsSelectOption } from "./primitives/SettingsSelect";

export type AgentProviderEnablement = Readonly<Record<AgentCliKind, boolean>>;

export interface AgentNewThreadModelContext {
  readonly claudeCatalog: ClaudeModelManifest;
  readonly codexCatalog: CodexModelCatalog;
  readonly configuredModel: Readonly<Record<AgentCliKind, string | null>>;
  readonly providerVersion: Readonly<Record<AgentCliKind, string | null>>;
}

export type AgentNewThreadProviderSelection =
  | { readonly kind: "selected"; readonly provider: AgentCliKind }
  | { readonly kind: "selectedDisabled"; readonly provider: AgentCliKind }
  | { readonly kind: "noneEnabled" };

export type AgentNewThreadTileState = "checked" | "available" | "disabled";

export type AgentNewThreadArrowStep = 1 | -1;

export interface AgentNewThreadEffectiveEffort {
  readonly value: string;
  readonly label: string;
}

export interface AgentNewThreadPreviewChip {
  readonly kind: "provider" | "model" | "effort" | "context";
  readonly label: string;
}

export interface AgentNewThreadPreview {
  readonly provider: AgentCliKind;
  readonly chips: ReadonlyArray<AgentNewThreadPreviewChip>;
  readonly summary: string;
}

type ClaudeEffortLevel = Exclude<ClaudeEffortChoice, "default">;

const DEFAULT_CHOICE = "default";
const MODEL_DEFAULT_EFFORT_LABEL = "Model default";
const NEW_THREAD_LAUNCH_SOURCES: ReadonlyArray<AgentNewThreadLaunchSource> = [
  "defaults",
  "lastUsed",
];

const DEFAULT_MODEL_PREFIX: Readonly<Record<AgentCliKind, string>> = {
  claudeCode: "CLI default",
  codex: "Config default",
};

export const NEW_THREAD_LAUNCH_SOURCE_OPTIONS: ReadonlyArray<SettingsSegmentedOption> = [
  { label: "Use these defaults", value: "defaults" },
  { label: "Continue with last used", value: "lastUsed" },
];

export function newThreadModelContext(
  management: AgentProviderManagementSurface,
  claudeCatalog: ClaudeModelManifest,
  codexCatalog: CodexModelCatalog,
): AgentNewThreadModelContext {
  return {
    claudeCatalog,
    codexCatalog,
    configuredModel: {
      claudeCode: configuredProviderModel(management, "claudeCode"),
      codex: configuredProviderModel(management, "codex"),
    },
    providerVersion: {
      claudeCode: configuredProviderVersion(management, "claudeCode"),
      codex: configuredProviderVersion(management, "codex"),
    },
  };
}

export function agentProviderEnablement(
  preferences: AgentProviderPreferences,
): AgentProviderEnablement {
  return { claudeCode: preferences.claudeCode.enabled, codex: preferences.codex.enabled };
}

export function newThreadProviderSelection(
  stored: AgentCliKind,
  enabled: AgentProviderEnablement,
): AgentNewThreadProviderSelection {
  if (enabled[stored]) return { kind: "selected", provider: stored };
  if (AGENT_PROVIDERS.some((provider) => enabled[provider])) {
    return { kind: "selectedDisabled", provider: stored };
  }

  return { kind: "noneEnabled" };
}

export function newThreadSelectionNote(selection: AgentNewThreadProviderSelection): string | null {
  switch (selection.kind) {
    case "selected":
      return null;
    case "selectedDisabled":
      return `${providerLabel(selection.provider)} is the default provider but it is disabled. Choose another provider or enable ${providerLabel(selection.provider)} under Providers.`;
    case "noneEnabled":
      return "No provider is enabled. Enable one under Providers to start new threads.";
    default:
      return selection satisfies never;
  }
}

export function newThreadTileState(
  provider: AgentCliKind,
  selection: AgentNewThreadProviderSelection,
  enabled: AgentProviderEnablement,
): AgentNewThreadTileState {
  if (!enabled[provider]) return "disabled";
  if (selection.kind === "selected" && selection.provider === provider) return "checked";

  return "available";
}

export function newThreadTileFootnote(
  provider: AgentCliKind,
  state: AgentNewThreadTileState,
): string {
  switch (state) {
    case "checked":
      return "New threads start here";
    case "available":
      return `Used when you switch to ${providerLabel(provider)}`;
    case "disabled":
      return `Enable ${providerLabel(provider)} under Providers to use it`;
    default:
      return state satisfies never;
  }
}

export function newThreadTabStop(
  selection: AgentNewThreadProviderSelection,
  enabled: AgentProviderEnablement,
): AgentCliKind | null {
  if (selection.kind === "selected") return selection.provider;

  return AGENT_PROVIDERS.find((provider) => enabled[provider]) ?? null;
}

export function newThreadArrowTarget(
  from: AgentCliKind,
  step: AgentNewThreadArrowStep,
  enabled: AgentProviderEnablement,
): AgentCliKind | null {
  const count = AGENT_PROVIDERS.length;
  const start = AGENT_PROVIDERS.indexOf(from);
  const ordered = AGENT_PROVIDERS.map(
    (_, offset) => AGENT_PROVIDERS[(start + (step + count) * (offset + 1)) % count],
  );

  return (
    ordered.find(
      (candidate) => candidate !== undefined && candidate !== from && enabled[candidate],
    ) ?? null
  );
}

export function newThreadModelValue(
  provider: AgentCliKind,
  defaults: AgentNewThreadDefaults,
  context: AgentNewThreadModelContext,
): string {
  switch (provider) {
    case "claudeCode":
      return canonicalClaudeModel(defaults.claudeCode.model, context.claudeCatalog);
    case "codex":
      return defaults.codex.model;
    default:
      return unsupportedProviderValue(provider, "agent provider");
  }
}

export function newThreadModelOptions(
  provider: AgentCliKind,
  defaults: AgentNewThreadDefaults,
  context: AgentNewThreadModelContext,
): ReadonlyArray<SettingsSelectOption> {
  const stored = newThreadModelValue(provider, defaults, context);
  const listed = agentModelRows(
    provider,
    context.configuredModel[provider],
    context.providerVersion[provider],
    context.claudeCatalog,
    context.codexCatalog,
  )
    .filter((row) => row.isLegacy !== true || row.value === stored)
    .map((row) => ({ label: row.label, value: row.value }));
  const options: ReadonlyArray<SettingsSelectOption> = [
    { label: defaultModelLabel(provider, context), value: DEFAULT_CHOICE },
    ...listed,
  ];

  if (options.some((option) => option.value === stored)) return options;

  return [
    ...options,
    {
      disabled: true,
      label: `${modelLabel(storedModelLaunch(provider, defaults), context)} (unavailable)`,
      value: stored,
    },
  ];
}

export function newThreadEffectiveEffort(
  provider: AgentCliKind,
  defaults: AgentNewThreadDefaults,
  context: AgentNewThreadModelContext,
): AgentNewThreadEffectiveEffort {
  const launch = effectiveLaunch(provider, defaults, context);
  const value = agentLaunchEffortValue(launch);

  if (value === DEFAULT_CHOICE) return { value, label: MODEL_DEFAULT_EFFORT_LABEL };

  return { value, label: agentLaunchEffortLabel(launch) };
}

export function newThreadEffortOptions(
  provider: AgentCliKind,
  defaults: AgentNewThreadDefaults,
  context: AgentNewThreadModelContext,
): ReadonlyArray<SettingsSelectOption> {
  const effective = newThreadEffectiveEffort(provider, defaults, context);
  const selectable = selectableEffortOptions(provider, defaults, context);

  if (selectable.some((option) => option.value === effective.value)) return selectable;

  return [effective, ...selectable];
}

export function newThreadEffortValue(
  provider: AgentCliKind,
  defaults: AgentNewThreadDefaults,
  context: AgentNewThreadModelContext,
): string {
  return newThreadEffectiveEffort(provider, defaults, context).value;
}

export function withNewThreadModel(
  defaults: AgentNewThreadDefaults,
  provider: AgentCliKind,
  value: string,
  context: AgentNewThreadModelContext,
): AgentNewThreadDefaults | null {
  const offered = newThreadModelOptions(provider, defaults, context).some(
    (option) => option.value === value && option.disabled !== true,
  );

  if (!offered) return null;

  switch (provider) {
    case "claudeCode": {
      if (!isClaudeModelChoice(value)) return null;

      const { effort } = defaults.claudeCode;
      const supported = effortSupported(effort, claudeEfforts(value, context));

      return {
        ...defaults,
        claudeCode: { model: value, effort: supported ? effort : DEFAULT_CHOICE },
      };
    }
    case "codex": {
      if (!isCodexModelChoice(value)) return null;

      const { effort } = defaults.codex;
      const supported = effortSupported(effort, codexEfforts(value, context));

      return { ...defaults, codex: { model: value, effort: supported ? effort : DEFAULT_CHOICE } };
    }
    default:
      return unsupportedProviderValue(provider, "agent provider");
  }
}

export function withNewThreadEffort(
  defaults: AgentNewThreadDefaults,
  provider: AgentCliKind,
  value: string,
  context: AgentNewThreadModelContext,
): AgentNewThreadDefaults | null {
  const offered = newThreadEffortOptions(provider, defaults, context).some(
    (option) => option.value === value,
  );

  if (!offered) return null;

  switch (provider) {
    case "claudeCode": {
      const effort = CLAUDE_EFFORT_CHOICES.find((choice) => choice === value);

      if (effort === undefined) return null;

      return { ...defaults, claudeCode: { ...defaults.claudeCode, effort } };
    }
    case "codex": {
      const effort = CODEX_EFFORT_CHOICES.find((choice) => choice === value);

      if (effort === undefined) return null;

      return { ...defaults, codex: { ...defaults.codex, effort } };
    }
    default:
      return unsupportedProviderValue(provider, "agent provider");
  }
}

export function withNewThreadLaunchSource(
  defaults: AgentNewThreadDefaults,
  value: string,
): AgentNewThreadDefaults | null {
  const source = NEW_THREAD_LAUNCH_SOURCES.find((candidate) => candidate === value);

  if (source === undefined) return null;

  return { ...defaults, source };
}

export function newThreadLaunchSourceDescription(source: AgentNewThreadLaunchSource): string {
  switch (source) {
    case "defaults":
      return "Every new thread starts from the defaults above.";
    case "lastUsed":
      return "A new thread reuses the model and effort of the last thread in that project.";
    default:
      return source satisfies never;
  }
}

export function newThreadPreview(
  provider: AgentCliKind,
  defaults: AgentNewThreadDefaults,
  context: AgentNewThreadModelContext,
): AgentNewThreadPreview {
  const launch = effectiveLaunch(provider, defaults, context);
  const chips: ReadonlyArray<AgentNewThreadPreviewChip> = [
    { kind: "provider", label: providerLabel(provider) },
    { kind: "model", label: modelLabel(launch, context) },
    ...effortChips(newThreadEffectiveEffort(provider, defaults, context)),
    ...contextChips(launch),
  ];

  return {
    provider,
    chips,
    summary: `New thread preview: ${chips.map(chipSummary).join(", ")}`,
  };
}

function composerLaunch(
  provider: AgentCliKind,
  defaults: AgentNewThreadDefaults,
  context: AgentNewThreadModelContext,
): AgentLaunchOptions {
  return newThreadComposerLaunch(
    provider,
    availableNewThreadDefaults(defaults, context.claudeCatalog, context.providerVersion.claudeCode),
  );
}

function effectiveLaunch(
  provider: AgentCliKind,
  defaults: AgentNewThreadDefaults,
  context: AgentNewThreadModelContext,
): AgentLaunchOptions {
  return agentLaunchForDispatch(
    composerLaunch(provider, defaults, context),
    context.configuredModel[provider],
    context.claudeCatalog,
    context.codexCatalog,
  );
}

function chipSummary(chip: AgentNewThreadPreviewChip): string {
  if (chip.kind === "effort") return `${chip.label} effort`;

  return chip.label;
}

function effortChips(
  effort: AgentNewThreadEffectiveEffort,
): ReadonlyArray<AgentNewThreadPreviewChip> {
  if (effort.value === DEFAULT_CHOICE) return [];

  return [{ kind: "effort", label: effort.label }];
}

function contextChips(launch: AgentLaunchOptions): ReadonlyArray<AgentNewThreadPreviewChip> {
  if (launch.provider !== "claudeCode") return [];
  if (launch.context === undefined) return [];

  return [{ kind: "context", label: `${agentLaunchContextLabel(launch.context)} context` }];
}

function selectableEffortOptions(
  provider: AgentCliKind,
  defaults: AgentNewThreadDefaults,
  context: AgentNewThreadModelContext,
): ReadonlyArray<SettingsSelectOption> {
  const supported = supportedEffortOptions(composerLaunch(provider, defaults, context), context);

  switch (provider) {
    case "claudeCode":
      return supported;
    case "codex":
      return [{ label: MODEL_DEFAULT_EFFORT_LABEL, value: DEFAULT_CHOICE }, ...supported];
    default:
      return unsupportedProviderValue(provider, "agent provider");
  }
}

function supportedEffortOptions(
  launch: AgentLaunchOptions,
  context: AgentNewThreadModelContext,
): ReadonlyArray<SettingsSelectOption> {
  switch (launch.provider) {
    case "claudeCode":
      return agentClaudeLaunchTraits(
        launch,
        context.configuredModel.claudeCode,
        "local",
        context.claudeCatalog,
      ).efforts.map((effort) => ({
        label: agentLaunchEffortLabel({ ...launch, effort }),
        value: effort,
      }));
    case "codex":
      return codexLaunchTraits(
        launch,
        context.configuredModel.codex,
        context.codexCatalog,
      ).efforts.map((effort) => ({
        label: agentLaunchEffortLabel({ ...launch, effort }),
        value: effort,
      }));
    default:
      return launch satisfies never;
  }
}

function defaultModelLabel(provider: AgentCliKind, context: AgentNewThreadModelContext): string {
  const launch = defaultModelLaunch(provider);
  const prefix = DEFAULT_MODEL_PREFIX[provider];
  const effective = agentLaunchEffectiveModel(
    launch,
    context.configuredModel[provider],
    context.claudeCatalog,
    context.codexCatalog,
  );

  if (effective === DEFAULT_CHOICE) return prefix;

  return `${prefix} (${modelLabel(launch, context)})`;
}

function modelLabel(launch: AgentLaunchOptions, context: AgentNewThreadModelContext): string {
  return agentLaunchModelLabel(
    launch,
    context.configuredModel[launch.provider],
    context.claudeCatalog,
    context.codexCatalog,
  );
}

function defaultModelLaunch(provider: AgentCliKind): AgentLaunchOptions {
  switch (provider) {
    case "claudeCode":
      return claudeProbe(DEFAULT_CHOICE);
    case "codex":
      return codexProbe(DEFAULT_CHOICE);
    default:
      return unsupportedProviderValue(provider, "agent provider");
  }
}

function storedModelLaunch(
  provider: AgentCliKind,
  defaults: AgentNewThreadDefaults,
): AgentLaunchOptions {
  switch (provider) {
    case "claudeCode":
      return claudeProbe(defaults.claudeCode.model);
    case "codex":
      return codexProbe(defaults.codex.model);
    default:
      return unsupportedProviderValue(provider, "agent provider");
  }
}

function claudeProbe(model: ClaudeModelChoice): ClaudeLaunchOptions {
  return { provider: "claudeCode", model, mode: "default", effort: DEFAULT_CHOICE };
}

function codexProbe(model: CodexModelChoice): CodexLaunchOptions {
  return { provider: "codex", model, mode: "default" };
}

function claudeEfforts(
  model: ClaudeModelChoice,
  context: AgentNewThreadModelContext,
): ReadonlyArray<ClaudeEffortLevel> {
  return agentClaudeLaunchTraits(
    claudeProbe(model),
    context.configuredModel.claudeCode,
    "local",
    context.claudeCatalog,
  ).efforts;
}

function codexEfforts(
  model: CodexModelChoice,
  context: AgentNewThreadModelContext,
): ReadonlyArray<CodexEffortLevel> {
  return codexLaunchTraits(codexProbe(model), context.configuredModel.codex, context.codexCatalog)
    .efforts;
}

function effortSupported(effort: string, supported: ReadonlyArray<string>): boolean {
  return effort === DEFAULT_CHOICE || supported.includes(effort);
}

function canonicalClaudeModel(
  model: ClaudeModelChoice,
  catalog: ClaudeModelManifest,
): ClaudeModelChoice {
  if (model === DEFAULT_CHOICE) return model;

  return (
    catalog.claudeCode.find((entry) => entry.choice === model || entry.runtimeIds.includes(model))
      ?.choice ?? model
  );
}
