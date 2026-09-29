import {
  CODEX_EFFORT_CHOICES,
  CODEX_NEW_MODEL_IDS,
  isCodexModelChoice,
  type CodexEffortChoice,
  type CodexEffortLevel,
  type CodexLaunchOptions,
  type CodexModelChoice,
  type CodexModelId,
} from "../../domain/agentLaunch";
import {
  codexCatalogDefault,
  resolveCodexCatalogModel,
  type CodexCatalogModel,
  type CodexModelCatalog,
} from "../../domain/codexModelCatalog";

export interface CodexLaunchText {
  readonly label: string;
  readonly meta: string;
  readonly hint: string;
}

export interface CodexModelRowModel {
  readonly value: CodexModelId;
  readonly label: string;
  readonly hint: string;
  readonly isLegacy: boolean;
  readonly isNew: boolean;
  readonly isDefault: boolean;
  readonly ownsDefaultFavorite: boolean;
}

export interface CodexLaunchTraits {
  readonly efforts: ReadonlyArray<CodexEffortLevel>;
  readonly defaultEffort: CodexEffortLevel | null;
}

const CODEX_CONFIGURATION_NOTE = "Selected by your Codex configuration.";

const DEFAULT_MODEL_TEXT: CodexLaunchText = {
  label: "Auto (Codex)",
  meta: "automatic model",
  hint: "No model override. Codex CLI chooses the model from its settings.",
};

export const CODEX_EFFORT_TEXT: Readonly<Record<CodexEffortChoice, CodexLaunchText>> = {
  default: {
    label: "Default effort",
    meta: "default effort",
    hint: "Uses the reasoning effort from your Codex configuration or the model default.",
  },
  none: { label: "None", meta: "none", hint: "Answers without extra reasoning." },
  minimal: { label: "Minimal", meta: "minimal", hint: "Reasons as little as possible." },
  low: { label: "Low", meta: "low", hint: "Answers fastest and reasons the least." },
  medium: {
    label: "Medium",
    meta: "medium",
    hint: "Balances reasoning depth against turnaround time.",
  },
  high: { label: "High", meta: "high", hint: "Reasons longer before acting on harder changes." },
  xhigh: {
    label: "Extra high",
    meta: "xhigh",
    hint: "Reasons noticeably longer than high and costs more.",
  },
  max: { label: "Max", meta: "max", hint: "Reasons the longest; slowest and most thorough." },
  ultra: {
    label: "Ultra",
    meta: "ultra",
    hint: "Maximum reasoning with automatic task delegation.",
  },
};

export function codexModelRows(
  configuredModel: string | null,
  catalog: CodexModelCatalog,
): ReadonlyArray<CodexModelRowModel> {
  const configured = codexConfiguredEntry(configuredModel, catalog);
  const effectiveDefault = codexDefaultEntry(configuredModel, catalog);
  return catalog.models.map((entry) => ({
    value: entry.id,
    label: entry.label,
    hint:
      entry.id === configured?.id
        ? `${entry.description} ${CODEX_CONFIGURATION_NOTE}`
        : entry.description,
    isLegacy: entry.status === "legacy",
    isNew: CODEX_NEW_MODEL_IDS.has(entry.id),
    isDefault: entry.isDefault,
    ownsDefaultFavorite: entry.id === effectiveDefault?.id,
  }));
}

export function codexModelText(
  model: CodexModelChoice,
  catalog: CodexModelCatalog,
): CodexLaunchText {
  if (model === "default") return DEFAULT_MODEL_TEXT;
  const entry = resolveCodexCatalogModel(catalog, model);
  if (entry === null) {
    return { label: model, meta: model, hint: `${model} is not in the Codex model catalog.` };
  }
  return { label: entry.label, meta: model, hint: entry.description };
}

export function codexDefaultModelLabel(
  configuredModel: string | null,
  catalog: CodexModelCatalog,
): string {
  return codexDefaultEntry(configuredModel, catalog)?.label ?? DEFAULT_MODEL_TEXT.label;
}

export function codexDefaultModelHint(
  configuredModel: string | null,
  catalog: CodexModelCatalog,
): string {
  const configured = codexConfiguredEntry(configuredModel, catalog);
  if (configured !== null) return `${configured.description} ${CODEX_CONFIGURATION_NOTE}`;
  if (configuredModel !== null) return DEFAULT_MODEL_TEXT.hint;
  return `${codexCatalogDefault(catalog).description} Selected by the Codex model catalog.`;
}

export function codexEffectiveModel(
  model: CodexModelChoice,
  configuredModel: string | null,
  catalog: CodexModelCatalog,
): CodexModelChoice {
  if (model !== "default") return model;
  return codexDefaultEntry(configuredModel, catalog)?.id ?? "default";
}

export function codexLaunchForDispatch(
  launch: CodexLaunchOptions,
  configuredModel: string | null,
  catalog: CodexModelCatalog,
): CodexLaunchOptions {
  const available = codexUnavailableModel(launch, catalog) === null;
  const model = codexEffectiveModel(available ? launch.model : "default", configuredModel, catalog);
  const entry = resolveCodexCatalogModel(catalog, model);
  const effort =
    available && entry !== null && supportsEffort(entry, launch.effort) ? launch.effort : undefined;
  return withEffort({ ...launch, model }, effort);
}

export function codexUnavailableModel(
  launch: CodexLaunchOptions,
  catalog: CodexModelCatalog,
): string | null {
  if (launch.model === "default") return null;
  return resolveCodexCatalogModel(catalog, launch.model) === null ? launch.model : null;
}

export function codexUnavailableModelNotice(
  launch: CodexLaunchOptions,
  catalog: CodexModelCatalog,
): string | null {
  const model = codexUnavailableModel(launch, catalog);
  if (model === null) return null;
  return `${model} is no longer available in Codex. This turn uses your Codex default model instead.`;
}

export function codexLaunchWithModel(
  launch: CodexLaunchOptions,
  value: string,
  catalog: CodexModelCatalog,
): CodexLaunchOptions {
  if (!isCodexModelChoice(value)) return launch;
  if (value !== "default" && resolveCodexCatalogModel(catalog, value) === null) return launch;
  return withEffort({ ...launch, model: value }, undefined);
}

export function codexLaunchWithEffort(
  launch: CodexLaunchOptions,
  value: string,
  configuredModel: string | null,
  catalog: CodexModelCatalog,
): CodexLaunchOptions {
  const effort = CODEX_EFFORT_CHOICES.find((choice) => choice === value);
  if (effort === undefined) return launch;
  const model = codexEffectiveModel(launch.model, configuredModel, catalog);
  const entry = resolveCodexCatalogModel(catalog, model);
  if (effort !== "default" && (entry === null || !supportsEffort(entry, effort))) return launch;
  return withEffort({ ...launch, model }, effort === "default" ? undefined : effort);
}

export function codexLaunchTraits(
  launch: CodexLaunchOptions,
  configuredModel: string | null,
  catalog: CodexModelCatalog,
): CodexLaunchTraits {
  const model = codexEffectiveModel(launch.model, configuredModel, catalog);
  const entry = resolveCodexCatalogModel(catalog, model);
  if (entry === null) return { efforts: [], defaultEffort: null };
  return { efforts: entry.efforts, defaultEffort: entry.defaultEffort };
}

function codexDefaultEntry(
  configuredModel: string | null,
  catalog: CodexModelCatalog,
): CodexCatalogModel | null {
  if (configuredModel !== null) return codexConfiguredEntry(configuredModel, catalog);
  return codexCatalogDefault(catalog);
}

function codexConfiguredEntry(
  configuredModel: string | null,
  catalog: CodexModelCatalog,
): CodexCatalogModel | null {
  if (configuredModel === null) return null;
  return catalog.models.find((entry) => entry.id === configuredModel) ?? null;
}

function supportsEffort(
  entry: CodexCatalogModel,
  effort: CodexEffortChoice | undefined,
): effort is CodexEffortLevel {
  return entry.efforts.some((candidate) => candidate === effort);
}

function withEffort(
  launch: CodexLaunchOptions,
  effort: CodexEffortChoice | undefined,
): CodexLaunchOptions {
  const { effort: _previous, ...rest } = launch;
  return effort === undefined ? rest : { ...rest, effort };
}
