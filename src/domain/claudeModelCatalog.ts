import {
  CLAUDE_CONTEXT_CHOICES,
  CLAUDE_EFFORT_CHOICES,
  isClaudeModelChoice,
  type ClaudeContextChoice,
  type ClaudeEffortChoice,
  type ClaudeModelChoice,
} from "./agentLaunch";
import bundledManifest from "./claudeModelManifest.json";

export interface ClaudeManifestModel {
  readonly choice: ClaudeModelChoice;
  readonly label: string;
  readonly description: string;
  readonly runtimeIds: ReadonlyArray<string>;
  readonly status: "current" | "legacy";
  readonly isDefault?: boolean;
  readonly minVersion?: string;
  readonly maxVersionExclusive?: string;
  readonly efforts: ReadonlyArray<Exclude<ClaudeEffortChoice, "default">>;
  readonly defaultEffort: ClaudeEffortChoice;
  readonly effortMap?: Readonly<
    Partial<
      Record<
        Exclude<ClaudeEffortChoice, "default">,
        "low" | "medium" | "high" | "xhigh" | "max" | null
      >
    >
  >;
  readonly contextWindows: ReadonlyArray<ClaudeContextChoice>;
  readonly defaultContext: ClaudeContextChoice | null;
  readonly fastMode: boolean;
  readonly thinkingMode: boolean;
}

export interface ClaudeModelManifest {
  readonly version: 1;
  readonly updatedAt: string;
  readonly claudeCode: ReadonlyArray<ClaudeManifestModel>;
}

const MODEL_KEYS = [
  "choice",
  "label",
  "description",
  "runtimeIds",
  "status",
  "efforts",
  "defaultEffort",
  "contextWindows",
  "defaultContext",
  "fastMode",
  "thinkingMode",
];
const OPTIONAL_KEYS = ["isDefault", "minVersion", "maxVersionExclusive", "effortMap"];

export function parseClaudeModelManifest(
  value: unknown,
  path = "claudeModelManifest",
): ClaudeModelManifest {
  const manifest = record(value, path);
  exactKeys(manifest, ["version", "updatedAt", "claudeCode"], [], path);
  if (manifest.version !== 1) invalid(`${path}.version`);
  const updatedAt = string(manifest.updatedAt, 20, `${path}.updatedAt`);
  const timestamp = Date.parse(updatedAt);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(updatedAt) ||
    !Number.isFinite(timestamp) ||
    Number(updatedAt.slice(0, 4)) < 2020 ||
    new Date(timestamp).toISOString() !== updatedAt.replace("Z", ".000Z")
  )
    invalid(`${path}.updatedAt`);
  const models = array(manifest.claudeCode, 128, `${path}.claudeCode`).map((entry, index) =>
    parseModel(entry, `${path}.claudeCode[${index}]`),
  );
  if (models.length === 0 || models.filter((entry) => entry.isDefault).length !== 1)
    invalid(`${path}.claudeCode`);
  const identifiers = new Set<string>();
  for (const model of models) {
    // A model may repeat its own choice in runtimeIds, but never another model's identifier.
    for (const id of new Set([model.choice, ...model.runtimeIds])) {
      if (identifiers.has(id)) invalid(`${path}.claudeCode`);
      identifiers.add(id);
    }
  }
  return Object.freeze({ version: 1, updatedAt, claudeCode: Object.freeze(models) });
}

function parseModel(value: unknown, path: string): ClaudeManifestModel {
  const model = record(value, path);
  exactKeys(model, MODEL_KEYS, OPTIONAL_KEYS, path);
  const choice = model.choice;
  if (!isClaudeModelChoice(choice) || !choice.startsWith("claude-")) invalid(`${path}.choice`);
  const runtimeIds = array(model.runtimeIds, 16, `${path}.runtimeIds`).map((value) => {
    const id = string(value, 96, `${path}.runtimeIds`);
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) invalid(`${path}.runtimeIds`);
    return id;
  });
  if (!runtimeIds.includes(choice)) invalid(`${path}.runtimeIds`);
  unique(runtimeIds, `${path}.runtimeIds`);
  const efforts = array(model.efforts, 7, `${path}.efforts`).map((value) =>
    member(
      value,
      CLAUDE_EFFORT_CHOICES.filter((effort) => effort !== "default"),
      `${path}.efforts`,
    ),
  );
  unique(efforts, `${path}.efforts`);
  const defaultEffort = member(model.defaultEffort, CLAUDE_EFFORT_CHOICES, `${path}.defaultEffort`);
  if (defaultEffort === "default" ? efforts.length !== 0 : !efforts.includes(defaultEffort))
    invalid(`${path}.defaultEffort`);
  const effortMap =
    model.effortMap === undefined
      ? undefined
      : parseEffortMap(model.effortMap, efforts, `${path}.effortMap`);
  const contextWindows = array(model.contextWindows, 2, `${path}.contextWindows`).map((value) =>
    member(value, CLAUDE_CONTEXT_CHOICES, `${path}.contextWindows`),
  );
  unique(contextWindows, `${path}.contextWindows`);
  const defaultContext =
    model.defaultContext === null
      ? null
      : member(model.defaultContext, CLAUDE_CONTEXT_CHOICES, `${path}.defaultContext`);
  if (
    defaultContext === null ? contextWindows.length !== 0 : !contextWindows.includes(defaultContext)
  )
    invalid(`${path}.defaultContext`);
  const minVersion =
    model.minVersion === undefined ? undefined : version(model.minVersion, `${path}.minVersion`);
  const maxVersionExclusive =
    model.maxVersionExclusive === undefined
      ? undefined
      : version(model.maxVersionExclusive, `${path}.maxVersionExclusive`);
  if (minVersion && maxVersionExclusive && compareVersions(minVersion, maxVersionExclusive) >= 0)
    invalid(`${path}.maxVersionExclusive`);
  return Object.freeze({
    choice,
    label: string(model.label, 128, `${path}.label`),
    description: string(model.description, 1024, `${path}.description`),
    runtimeIds: Object.freeze(runtimeIds),
    status: member(model.status, ["current", "legacy"] as const, `${path}.status`),
    ...(model.isDefault === undefined
      ? {}
      : { isDefault: boolean(model.isDefault, `${path}.isDefault`) }),
    ...(minVersion === undefined ? {} : { minVersion }),
    ...(maxVersionExclusive === undefined ? {} : { maxVersionExclusive }),
    efforts: Object.freeze(efforts),
    defaultEffort,
    ...(effortMap === undefined ? {} : { effortMap }),
    contextWindows: Object.freeze(contextWindows),
    defaultContext,
    fastMode: boolean(model.fastMode, `${path}.fastMode`),
    thinkingMode: boolean(model.thinkingMode, `${path}.thinkingMode`),
  });
}

function parseEffortMap(
  value: unknown,
  efforts: ClaudeManifestModel["efforts"],
  path: string,
): NonNullable<ClaudeManifestModel["effortMap"]> {
  const mapping = record(value, path);
  const result: Partial<
    Record<
      Exclude<ClaudeEffortChoice, "default">,
      "low" | "medium" | "high" | "xhigh" | "max" | null
    >
  > = {};
  for (const [source, target] of Object.entries(mapping)) {
    const key = member(source, efforts, path);
    if (key === "ultrathink") {
      if (target !== null) invalid(path);
      result[key] = null;
    } else {
      const mapped = member(target, ["low", "medium", "high", "xhigh", "max"] as const, path);
      if (key === "ultracode" && mapped !== "xhigh") invalid(path);
      result[key] = mapped;
    }
  }
  return Object.freeze(result);
}

function version(value: unknown, path: string): string {
  const result = string(value, 20, path);
  if (!/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(result)) invalid(path);
  return result;
}

function compareVersions(a: string, b: string): number {
  const right = b.split(".").map(Number);
  for (const [index, left] of a.split(".").map(Number).entries()) {
    if (left !== right[index]) return left - right[index];
  }
  return 0;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path);
  return value as Record<string, unknown>;
}
function exactKeys(
  value: Record<string, unknown>,
  required: ReadonlyArray<string>,
  optional: ReadonlyArray<string>,
  path: string,
): void {
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    invalid(path);
}
function string(value: unknown, max: number, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    new TextEncoder().encode(value).length > max ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  )
    invalid(path);
  return value;
}
function array(value: unknown, max: number, path: string): ReadonlyArray<unknown> {
  if (!Array.isArray(value) || value.length > max) invalid(path);
  return value;
}
function member<T extends string>(value: unknown, choices: ReadonlyArray<T>, path: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) invalid(path);
  return value as T;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}
function unique(values: ReadonlyArray<string>, path: string): void {
  if (new Set(values).size !== values.length) invalid(path);
}
function invalid(path: string): never {
  throw new TypeError(`Invalid Claude model manifest at ${path}.`);
}

export const BUNDLED_CLAUDE_MODEL_MANIFEST = parseClaudeModelManifest(bundledManifest);
