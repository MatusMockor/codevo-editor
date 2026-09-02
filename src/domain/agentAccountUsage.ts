import type { AgentCliKind } from "./agentTask";

export interface AgentAccountUsageWindow {
  readonly id: string;
  readonly label: string;
  readonly usedPercent: number;
  readonly windowDurationMinutes: number | null;
  readonly resetsAtEpochMs: number | null;
  readonly resetsLabel: string | null;
}

export interface AgentAccountUsageSnapshot {
  readonly provider: AgentCliKind;
  readonly fetchedAtEpochMs: number;
  readonly windows: ReadonlyArray<AgentAccountUsageWindow>;
}

export interface AgentAccountUsageObservation {
  readonly provider: AgentCliKind;
  readonly windows: ReadonlyArray<AgentAccountUsageWindow>;
}

export function mergeAgentAccountUsageObservation(
  current: AgentAccountUsageSnapshot | null,
  observation: AgentAccountUsageObservation,
  observedAtEpochMs: number,
): AgentAccountUsageSnapshot {
  const windows = new Map(current?.windows.map((window) => [window.id, window]) ?? []);
  for (const window of observation.windows) windows.set(window.id, window);
  return {
    provider: observation.provider,
    fetchedAtEpochMs: observedAtEpochMs,
    windows: [...windows.values()],
  };
}

export interface AgentAccountUsageGateway {
  readAgentProviderUsage(request: {
    readonly provider: AgentCliKind;
    readonly providerGeneration: number;
  }): Promise<AgentAccountUsageSnapshot>;
}

export interface AgentAccountUsageStoreGateway {
  loadAgentAccountUsage(): ReadonlyArray<AgentAccountUsageSnapshot>;
  saveAgentAccountUsage(snapshot: AgentAccountUsageSnapshot): void;
}

export type AgentAccountUsageLoadState =
  | { readonly kind: "idle" | "loading" }
  | { readonly kind: "ready"; readonly snapshot: AgentAccountUsageSnapshot }
  | { readonly kind: "unavailable" };

export function parseAgentAccountUsageSnapshot(value: unknown): AgentAccountUsageSnapshot {
  const result = object(value, "result");
  exactKeys(result, ["provider", "fetchedAtEpochMs", "windows"], "result");
  const provider = parseProvider(result.provider);
  const windows = array(result.windows, "result.windows");
  if (windows.length > 12) throw new TypeError("Invalid account usage: too many windows.");
  return {
    provider,
    fetchedAtEpochMs: unsignedInteger(result.fetchedAtEpochMs, "result.fetchedAtEpochMs"),
    windows: windows.map((window, index) => parseWindow(window, `result.windows[${index}]`)),
  };
}

function parseWindow(value: unknown, path: string): AgentAccountUsageWindow {
  const window = object(value, path);
  exactKeys(
    window,
    ["id", "label", "usedPercent", "windowDurationMinutes", "resetsAtEpochMs", "resetsLabel"],
    path,
  );
  const usedPercent = finiteNumber(window.usedPercent, `${path}.usedPercent`);
  if (usedPercent < 0 || usedPercent > 100) {
    throw new TypeError(`Invalid account usage at ${path}.usedPercent.`);
  }
  return {
    id: boundedString(window.id, 160, `${path}.id`),
    label: boundedString(window.label, 160, `${path}.label`),
    usedPercent,
    windowDurationMinutes: nullableUnsignedInteger(
      window.windowDurationMinutes,
      `${path}.windowDurationMinutes`,
    ),
    resetsAtEpochMs: nullableUnsignedInteger(window.resetsAtEpochMs, `${path}.resetsAtEpochMs`),
    resetsLabel:
      window.resetsLabel === null
        ? null
        : boundedString(window.resetsLabel, 200, `${path}.resetsLabel`),
  };
}

function parseProvider(value: unknown): AgentCliKind {
  if (value === "claudeCode" || value === "codex") return value;
  throw new TypeError("Invalid account usage provider.");
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Invalid account usage at ${path}.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): ReadonlyArray<unknown> {
  if (!Array.isArray(value)) throw new TypeError(`Invalid account usage at ${path}.`);
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: ReadonlyArray<string>,
  path: string,
): void {
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !(key in value))) {
    throw new TypeError(`Invalid account usage fields at ${path}.`);
  }
}

function boundedString(value: unknown, max: number, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    new TextEncoder().encode(value).length > max
  ) {
    throw new TypeError(`Invalid account usage at ${path}.`);
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Invalid account usage at ${path}.`);
  }
  return value;
}

function unsignedInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`Invalid account usage at ${path}.`);
  }
  return value as number;
}

function nullableUnsignedInteger(value: unknown, path: string): number | null {
  return value === null ? null : unsignedInteger(value, path);
}
