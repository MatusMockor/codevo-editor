import type { AgentCliKind } from "./agentTask";

export const MODEL_NEW_WINDOW_DAYS = 14;
export const MAX_MODEL_FIRST_SEEN_ENTRIES = 256;

const DAY_MS = 86_400_000;
const MAX_MODEL_ID_LENGTH = 128;
const PROVIDERS: ReadonlyArray<AgentCliKind> = ["claudeCode", "codex"];
const ORIGINS = ["baseline", "discovered"] as const;
const LEDGER_KEYS = ["version", "baselineProviders", "entries"];
const ENTRY_KEYS = ["provider", "modelId", "firstSeenAtMs", "origin"];

export type ModelFirstSeenOrigin = (typeof ORIGINS)[number];

export interface ModelFirstSeenEntry {
  readonly provider: AgentCliKind;
  readonly modelId: string;
  readonly firstSeenAtMs: number;
  readonly origin: ModelFirstSeenOrigin;
}

export interface ModelFirstSeenLedger {
  readonly version: 1;
  readonly baselineProviders: ReadonlyArray<AgentCliKind>;
  readonly entries: ReadonlyArray<ModelFirstSeenEntry>;
}

export interface ModelNewnessEvidence {
  readonly catalogFlag?: boolean;
  readonly releaseDate?: string;
  readonly firstSeen?: ModelFirstSeenEntry;
}

export interface ModelCatalogObservation {
  readonly provider: AgentCliKind;
  readonly modelIds: ReadonlyArray<string>;
  readonly live: boolean;
}

export const EMPTY_MODEL_FIRST_SEEN_LEDGER: ModelFirstSeenLedger = Object.freeze({
  version: 1,
  baselineProviders: Object.freeze([]),
  entries: Object.freeze([]),
});

export function modelIsNew(evidence: ModelNewnessEvidence, nowMs: number): boolean {
  if (evidence.catalogFlag === false) return false;
  if (evidence.catalogFlag === true) {
    return evidence.releaseDate === undefined || !releaseIsStale(evidence.releaseDate, nowMs);
  }
  if (evidence.releaseDate !== undefined) return releasedRecently(evidence.releaseDate, nowMs);
  if (evidence.firstSeen?.origin !== "discovered") return false;
  const age = nowMs - evidence.firstSeen.firstSeenAtMs;
  return age > -DAY_MS && age < MODEL_NEW_WINDOW_DAYS * DAY_MS;
}

function releaseAgeDays(releaseDate: string, nowMs: number): number {
  return Math.floor(nowMs / DAY_MS) - Math.floor(Date.parse(`${releaseDate}T00:00:00Z`) / DAY_MS);
}

function releaseIsStale(releaseDate: string, nowMs: number): boolean {
  return releaseAgeDays(releaseDate, nowMs) >= MODEL_NEW_WINDOW_DAYS;
}

function releasedRecently(releaseDate: string, nowMs: number): boolean {
  const days = releaseAgeDays(releaseDate, nowMs);
  return Number.isFinite(days) && days >= -1 && days < MODEL_NEW_WINDOW_DAYS;
}

export function isModelReleaseDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return (
    Number(value.slice(0, 4)) >= 2020 &&
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().startsWith(value)
  );
}

export function findModelFirstSeen(
  ledger: ModelFirstSeenLedger,
  provider: AgentCliKind,
  modelId: string,
): ModelFirstSeenEntry | undefined {
  return ledger.entries.find((entry) => entry.provider === provider && entry.modelId === modelId);
}

export function observeModelCatalogs(
  ledger: ModelFirstSeenLedger,
  observations: ReadonlyArray<ModelCatalogObservation>,
  nowMs: number,
): ModelFirstSeenLedger {
  const repaired = ledger.entries.map((entry) =>
    entry.firstSeenAtMs > nowMs + DAY_MS
      ? Object.freeze({ ...entry, firstSeenAtMs: nowMs })
      : entry,
  );
  let changed = repaired.some((entry, index) => entry !== ledger.entries[index]);
  let entries: ReadonlyArray<ModelFirstSeenEntry> = repaired;
  let baselineProviders = ledger.baselineProviders;
  for (const { provider, modelIds, live } of observations) {
    if (!live) continue;
    const baselined = baselineProviders.includes(provider);
    const origin: ModelFirstSeenOrigin = baselined ? "discovered" : "baseline";
    const known = new Set(
      entries.filter((entry) => entry.provider === provider).map((entry) => entry.modelId),
    );
    const added = [...new Set(modelIds)]
      .filter((modelId) => validModelId(modelId) && !known.has(modelId))
      .map((modelId) => Object.freeze({ provider, modelId, firstSeenAtMs: nowMs, origin }));
    if (!baselined) baselineProviders = [...baselineProviders, provider];
    changed ||= !baselined || added.length > 0;
    entries = [...entries, ...added];
  }
  if (!changed) return ledger;
  const current = new Set(
    observations.flatMap(({ provider, modelIds }) =>
      modelIds.map((modelId) => identity(provider, modelId)),
    ),
  );
  return Object.freeze({
    version: 1,
    baselineProviders: Object.freeze([...baselineProviders]),
    entries: Object.freeze(
      boundEntries(entries, (entry) => current.has(identity(entry.provider, entry.modelId))),
    ),
  });
}

function identity(provider: AgentCliKind, modelId: string): string {
  return `${provider}/${modelId}`;
}

function boundEntries(
  entries: ReadonlyArray<ModelFirstSeenEntry>,
  isCurrent: (entry: ModelFirstSeenEntry) => boolean,
): ReadonlyArray<ModelFirstSeenEntry> {
  const excess = entries.length - MAX_MODEL_FIRST_SEEN_ENTRIES;
  if (excess <= 0) return entries;
  const evicted = new Set(
    [...entries]
      .sort(
        (left, right) =>
          Number(isCurrent(left)) - Number(isCurrent(right)) ||
          left.firstSeenAtMs - right.firstSeenAtMs ||
          left.provider.localeCompare(right.provider) ||
          left.modelId.localeCompare(right.modelId),
      )
      .slice(0, excess),
  );
  return entries.filter((entry) => !evicted.has(entry));
}

export function parseModelFirstSeenLedger(value: unknown): ModelFirstSeenLedger {
  const ledger = record(value, "ledger");
  exactKeys(ledger, LEDGER_KEYS, "ledger");
  if (ledger.version !== 1) invalid("ledger.version");
  const baselineProviders = array(ledger.baselineProviders, PROVIDERS.length, "baselines").map(
    (provider) => member(provider, PROVIDERS, "baselines"),
  );
  if (new Set(baselineProviders).size !== baselineProviders.length) invalid("baselines");
  const identities = new Set<string>();
  const entries = array(ledger.entries, MAX_MODEL_FIRST_SEEN_ENTRIES, "entries").map((value) => {
    const entry = parseEntry(value);
    const key = identity(entry.provider, entry.modelId);
    if (identities.has(key)) invalid("entries");
    identities.add(key);
    return entry;
  });
  return Object.freeze({
    version: 1,
    baselineProviders: Object.freeze(baselineProviders),
    entries: Object.freeze(entries),
  });
}

function parseEntry(value: unknown): ModelFirstSeenEntry {
  const entry = record(value, "entry");
  exactKeys(entry, ENTRY_KEYS, "entry");
  if (!validModelId(entry.modelId)) invalid("entry.modelId");
  const firstSeenAtMs = entry.firstSeenAtMs;
  if (
    typeof firstSeenAtMs !== "number" ||
    !Number.isSafeInteger(firstSeenAtMs) ||
    firstSeenAtMs < 0
  )
    invalid("entry.firstSeenAtMs");
  return Object.freeze({
    provider: member(entry.provider, PROVIDERS, "entry.provider"),
    modelId: entry.modelId,
    firstSeenAtMs,
    origin: member(entry.origin, ORIGINS, "entry.origin"),
  });
}

function validModelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_MODEL_ID_LENGTH &&
    !/[\p{Cc}\s]/u.test(value)
  );
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

function invalid(path: string): never {
  throw new TypeError(`Invalid model first-seen ledger at ${path}.`);
}
