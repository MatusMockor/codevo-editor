import { isEarlierAgentAccountUsagePeriod } from "./agentAccountUsageFreshness";
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
  readonly accountIdentity?: string | null;
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
  const matchingCurrent = current?.provider === observation.provider ? current : null;
  const windows = new Map(matchingCurrent?.windows.map((window) => [window.id, window]) ?? []);
  for (const window of observation.windows) {
    const existing = windows.get(window.id);
    if (
      existing !== undefined &&
      isEarlierAgentAccountUsagePeriod(window, existing, observedAtEpochMs)
    ) {
      continue;
    }
    windows.set(window.id, window);
  }
  return {
    provider: observation.provider,
    ...(matchingCurrent?.accountIdentity === undefined
      ? {}
      : { accountIdentity: matchingCurrent.accountIdentity }),
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
  invalidateAgentAccountUsage(provider: AgentCliKind): void;
  subscribeAgentAccountUsage(listener: (change: AgentAccountUsageStoreChange) => void): () => void;
}

export type AgentAccountUsageStoreChange =
  | { readonly kind: "snapshot"; readonly snapshot: AgentAccountUsageSnapshot }
  | { readonly kind: "invalidated"; readonly provider: AgentCliKind };

export type AgentAccountUsageLoadState =
  | { readonly kind: "idle" | "loading" }
  | { readonly kind: "ready"; readonly snapshot: AgentAccountUsageSnapshot }
  | { readonly kind: "unavailable" };

export function parseAgentAccountUsageSnapshot(value: unknown): AgentAccountUsageSnapshot {
  const result = object(value, "result");
  exactKeys(result, ["provider", "fetchedAtEpochMs", "windows"], "result", ["accountIdentity"]);
  const provider = parseProvider(result.provider);
  const windows = array(result.windows, "result.windows");
  if (windows.length < 1 || windows.length > 12) {
    throw new TypeError("Invalid account usage: expected 1 to 12 windows.");
  }
  const parsedWindows = windows.map((window, index) =>
    parseWindow(window, `result.windows[${index}]`),
  );
  if (new Set(parsedWindows.map((window) => window.id)).size !== parsedWindows.length) {
    throw new TypeError("Invalid account usage: duplicate windows.");
  }
  return {
    provider,
    ...(result.accountIdentity === undefined
      ? {}
      : { accountIdentity: parseAccountIdentity(result.accountIdentity) }),
    fetchedAtEpochMs: unsignedInteger(result.fetchedAtEpochMs, "result.fetchedAtEpochMs"),
    windows: parsedWindows,
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
  optionalKeys: ReadonlyArray<string> = [],
): void {
  const expected = new Set([...keys, ...optionalKeys]);
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !(key in value))) {
    throw new TypeError(`Invalid account usage fields at ${path}.`);
  }
}

function parseAccountIdentity(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "string" && /^account:v1:sha256:[0-9a-f]{64}$/.test(value)) return value;
  throw new TypeError("Invalid account usage identity.");
}

function boundedString(value: unknown, max: number, path: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value) ||
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
