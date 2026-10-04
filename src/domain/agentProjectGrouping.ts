export const AGENT_PROJECT_GROUPING_MODES = ["repository", "separate"] as const;

export type AgentProjectGroupingMode = (typeof AGENT_PROJECT_GROUPING_MODES)[number];

export const MAX_AGENT_PROJECT_GROUPING_OVERRIDES = 256;
export const MAX_AGENT_PROJECT_GROUPING_ROOT_KEY_CHARS = 5000;

export interface AgentProjectGroupingSettings {
  readonly mode: AgentProjectGroupingMode;
  readonly overrides: ReadonlyMap<string, AgentProjectGroupingMode>;
}

export interface EncodedAgentProjectGroupingSettings {
  readonly mode: AgentProjectGroupingMode;
  readonly overrides: ReadonlyArray<readonly [string, AgentProjectGroupingMode]>;
}

export type AgentProjectGroupingRejection = "invalidMode" | "invalidProject" | "tooManyOverrides";

export type AgentProjectGroupingUpdate =
  | { readonly kind: "updated"; readonly settings: AgentProjectGroupingSettings }
  | { readonly kind: "rejected"; readonly reason: AgentProjectGroupingRejection };

export const DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS: AgentProjectGroupingSettings = Object.freeze({
  mode: "repository",
  overrides: new Map<string, AgentProjectGroupingMode>(),
});

export function isAgentProjectGroupingMode(value: unknown): value is AgentProjectGroupingMode {
  return AGENT_PROJECT_GROUPING_MODES.some((mode) => mode === value);
}

export function isAgentProjectGroupingRootKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_AGENT_PROJECT_GROUPING_ROOT_KEY_CHARS &&
    !/\p{Cc}/u.test(value)
  );
}

export function resolveGroupingMode(
  rootKey: string,
  settings: AgentProjectGroupingSettings,
): AgentProjectGroupingMode {
  return settings.overrides.get(rootKey) ?? settings.mode;
}

export function parseAgentProjectGroupingSettings(
  value: unknown,
): AgentProjectGroupingSettings | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("mode") || !keys.includes("overrides")) return null;
  const mode = value.mode;
  if (!isAgentProjectGroupingMode(mode)) return null;
  const overrides = parseOverrides(value.overrides);
  if (overrides === null) return null;
  return { mode, overrides };
}

export function encodeAgentProjectGroupingSettings(
  settings: AgentProjectGroupingSettings,
): EncodedAgentProjectGroupingSettings {
  return { mode: settings.mode, overrides: [...settings.overrides] };
}

export function withAgentProjectGroupingMode(
  settings: AgentProjectGroupingSettings,
  mode: AgentProjectGroupingMode,
): AgentProjectGroupingUpdate {
  if (!isAgentProjectGroupingMode(mode)) return rejected("invalidMode");
  if (mode === settings.mode) return updated(settings);
  return updated({ mode, overrides: settings.overrides });
}

export function withAgentProjectGroupingOverride(
  settings: AgentProjectGroupingSettings,
  rootKey: string,
  mode: AgentProjectGroupingMode | null,
): AgentProjectGroupingUpdate {
  if (!isAgentProjectGroupingRootKey(rootKey)) return rejected("invalidProject");
  if (mode === null) return updated(withoutOverrides(settings, [rootKey]));
  if (!isAgentProjectGroupingMode(mode)) return rejected("invalidMode");
  if (settings.overrides.get(rootKey) === mode) return updated(settings);
  const overrides = new Map(settings.overrides);
  overrides.set(rootKey, mode);
  if (overrides.size > MAX_AGENT_PROJECT_GROUPING_OVERRIDES) return rejected("tooManyOverrides");
  return updated({ mode: settings.mode, overrides });
}

export function withoutAgentProjectGroupingOverrides(
  settings: AgentProjectGroupingSettings,
  rootKeys: ReadonlyArray<string>,
): AgentProjectGroupingUpdate {
  if (rootKeys.length > MAX_AGENT_PROJECT_GROUPING_OVERRIDES) return rejected("invalidProject");
  if (!rootKeys.every(isAgentProjectGroupingRootKey)) return rejected("invalidProject");
  return updated(withoutOverrides(settings, rootKeys));
}

export function unsupportedAgentProjectGroupingMode(mode: never): never {
  throw new TypeError(`Unsupported project grouping mode: ${String(mode)}.`);
}

function parseOverrides(value: unknown): ReadonlyMap<string, AgentProjectGroupingMode> | null {
  if (!Array.isArray(value) || value.length > MAX_AGENT_PROJECT_GROUPING_OVERRIDES) return null;
  const overrides = new Map<string, AgentProjectGroupingMode>();
  for (const entry of value) {
    const override = parseOverride(entry);
    if (override === null || overrides.has(override[0])) return null;
    overrides.set(override[0], override[1]);
  }
  return overrides;
}

function parseOverride(value: unknown): readonly [string, AgentProjectGroupingMode] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [rootKey, mode]: readonly unknown[] = value;
  if (!isAgentProjectGroupingRootKey(rootKey) || !isAgentProjectGroupingMode(mode)) return null;
  return [rootKey, mode];
}

function withoutOverrides(
  settings: AgentProjectGroupingSettings,
  rootKeys: ReadonlyArray<string>,
): AgentProjectGroupingSettings {
  const removed = rootKeys.filter((rootKey) => settings.overrides.has(rootKey));
  if (removed.length === 0) return settings;
  const overrides = new Map(settings.overrides);
  for (const rootKey of removed) overrides.delete(rootKey);
  return { mode: settings.mode, overrides };
}

function updated(settings: AgentProjectGroupingSettings): AgentProjectGroupingUpdate {
  return { kind: "updated", settings };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejected(reason: AgentProjectGroupingRejection): AgentProjectGroupingUpdate {
  return { kind: "rejected", reason };
}
