import {
  CODEX_EFFORT_CHOICES,
  isCodexModelId,
  type CodexEffortLevel,
  type CodexModelChoice,
  type CodexModelId,
} from "./agentLaunch";
import bundledCatalog from "./codexModelManifest.json";

export interface CodexCatalogModel {
  readonly id: CodexModelId;
  readonly label: string;
  readonly description: string;
  readonly status: "current" | "legacy";
  readonly isDefault: boolean;
  readonly efforts: ReadonlyArray<CodexEffortLevel>;
  readonly defaultEffort: CodexEffortLevel | null;
  readonly upgradeTo: CodexModelId | null;
}

export interface CodexModelCatalog {
  readonly version: 1;
  readonly source: "live" | "bundled";
  readonly revision: number;
  readonly models: ReadonlyArray<CodexCatalogModel>;
}

export const MAX_CODEX_CATALOG_MODELS = 64;
const MAX_LABEL_BYTES = 128;
const MAX_DESCRIPTION_BYTES = 1024;
const ENVELOPE_KEYS = ["version", "source", "revision", "models"] as const;
const MODEL_KEYS = [
  "id",
  "label",
  "description",
  "status",
  "isDefault",
  "efforts",
  "defaultEffort",
  "upgradeTo",
] as const;
const EFFORT_LEVELS = CODEX_EFFORT_CHOICES.filter(
  (effort): effort is CodexEffortLevel => effort !== "default",
);

export function parseCodexModelCatalog(
  value: unknown,
  path = "codexModelCatalog",
): CodexModelCatalog {
  const catalog = record(value, path);
  exactKeys(catalog, ENVELOPE_KEYS, path);
  if (catalog.version !== 1) invalid(`${path}.version`);
  const source = member(catalog.source, ["live", "bundled"] as const, `${path}.source`);
  const revision = catalog.revision;
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    (source === "bundled" ? revision !== 0 : revision < 1)
  )
    invalid(`${path}.revision`);
  const entries = catalog.models;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_CODEX_CATALOG_MODELS)
    invalid(`${path}.models`);
  const models = entries.map((entry, index) => parseModel(entry, `${path}.models[${index}]`));
  if (
    new Set(models.map((model) => model.id)).size !== models.length ||
    models.filter((model) => model.isDefault).length !== 1
  )
    invalid(`${path}.models`);
  return Object.freeze({ version: 1, source, revision, models: Object.freeze(models) });
}

function parseModel(value: unknown, path: string): CodexCatalogModel {
  const model = record(value, path);
  exactKeys(model, MODEL_KEYS, path);
  if (!isCodexModelId(model.id)) invalid(`${path}.id`);
  const efforts = array(model.efforts, EFFORT_LEVELS.length, `${path}.efforts`).map((effort) =>
    member(effort, EFFORT_LEVELS, `${path}.efforts`),
  );
  if (new Set(efforts).size !== efforts.length) invalid(`${path}.efforts`);
  const defaultEffort =
    model.defaultEffort === null
      ? null
      : member(model.defaultEffort, efforts, `${path}.defaultEffort`);
  const upgradeTo = model.upgradeTo;
  if (upgradeTo !== null && !isCodexModelId(upgradeTo)) invalid(`${path}.upgradeTo`);
  if (typeof model.isDefault !== "boolean") invalid(`${path}.isDefault`);
  return Object.freeze({
    id: model.id,
    label: text(model.label, MAX_LABEL_BYTES, `${path}.label`),
    description: text(model.description, MAX_DESCRIPTION_BYTES, `${path}.description`),
    status: member(model.status, ["current", "legacy"] as const, `${path}.status`),
    isDefault: model.isDefault,
    efforts: Object.freeze(efforts),
    defaultEffort,
    upgradeTo,
  });
}

export function resolveCodexCatalogModel(
  catalog: CodexModelCatalog,
  model: CodexModelChoice,
): CodexCatalogModel | null {
  if (model === "default") return codexCatalogDefault(catalog);
  return catalog.models.find((entry) => entry.id === model) ?? null;
}

export function codexCatalogDefault(catalog: CodexModelCatalog): CodexCatalogModel {
  return catalog.models.find((entry) => entry.isDefault) ?? catalog.models[0];
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: ReadonlyArray<string>,
  path: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalid(path);
}

function array(value: unknown, max: number, path: string): ReadonlyArray<unknown> {
  if (!Array.isArray(value) || value.length > max) invalid(path);
  return value;
}

function member<T extends string>(value: unknown, choices: ReadonlyArray<T>, path: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) invalid(path);
  return value as T;
}

function text(value: unknown, maxBytes: number, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    new TextEncoder().encode(value).length > maxBytes ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  )
    invalid(path);
  return value;
}

function invalid(path: string): never {
  throw new TypeError(`Invalid Codex model catalog at ${path}.`);
}

export const BUNDLED_CODEX_MODEL_CATALOG = parseCodexModelCatalog(bundledCatalog);
