import type { AgentCliKind } from "./agentTask";

export type AgentCommandCatalogEntryKind = "command" | "skill";

export interface AgentCommandCatalogEntry {
  readonly kind: AgentCommandCatalogEntryKind;
  readonly name: string;
  readonly label: string | null;
  readonly description: string | null;
  readonly argumentHint: string | null;
  readonly builtin: boolean;
}

export interface AgentCommandCatalog {
  readonly version: 1;
  readonly provider: AgentCliKind;
  readonly truncated: boolean;
  readonly entries: ReadonlyArray<AgentCommandCatalogEntry>;
}

export interface AgentCommandCatalogRequest {
  readonly repositoryRoot: string;
  readonly provider: AgentCliKind;
}

export const AGENT_COMMAND_CATALOG_LIMITS = Object.freeze({
  maxEntries: 512,
  maxNameBytes: 128,
  maxLabelBytes: 128,
  maxDescriptionBytes: 512,
  maxArgumentHintBytes: 128,
  maxRepositoryRootBytes: 4096,
});
export const AGENT_COMMAND_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_.-]*$/;

const PROVIDERS = ["claudeCode", "codex"] as const satisfies ReadonlyArray<AgentCliKind>;
const REQUEST_KEYS = ["repositoryRoot", "provider"] as const;
const ENVELOPE_KEYS = ["version", "provider", "truncated", "entries"] as const;
const ENTRY_KEYS = ["kind", "name", "label", "description", "argumentHint", "builtin"] as const;
const WINDOWS_ROOT = /^(?:[A-Za-z]:[\\/]|\\\\)/;
const UTF8_ENCODER = new TextEncoder();

export function agentCommandCatalogEntryKind(provider: AgentCliKind): AgentCommandCatalogEntryKind {
  switch (provider) {
    case "claudeCode":
      return "command";
    case "codex":
      return "skill";
    default: {
      const unreachable: never = provider;
      return unreachable;
    }
  }
}

export function agentCommandCatalogRequest(
  repositoryRoot: string | null,
  provider: AgentCliKind,
): AgentCommandCatalogRequest | null {
  if (repositoryRoot === null || !isRepositoryRoot(repositoryRoot)) return null;
  return Object.freeze({ repositoryRoot, provider });
}

export function parseAgentCommandCatalogRequest(
  value: unknown,
  path = "agentCommandCatalogRequest",
): AgentCommandCatalogRequest {
  const request = record(value, path);
  exactKeys(request, REQUEST_KEYS, path);
  const provider = member(request.provider, PROVIDERS, `${path}.provider`);
  const repositoryRoot = request.repositoryRoot;
  if (typeof repositoryRoot !== "string" || !isRepositoryRoot(repositoryRoot))
    invalid(`${path}.repositoryRoot`);
  return Object.freeze({ repositoryRoot, provider });
}

export function parseAgentCommandCatalog(
  value: unknown,
  path = "agentCommandCatalog",
): AgentCommandCatalog {
  const catalog = record(value, path);
  exactKeys(catalog, ENVELOPE_KEYS, path);
  if (catalog.version !== 1) invalid(`${path}.version`);
  const provider = member(catalog.provider, PROVIDERS, `${path}.provider`);
  const truncated = catalog.truncated;
  if (typeof truncated !== "boolean") invalid(`${path}.truncated`);
  const raw = catalog.entries;
  if (!Array.isArray(raw) || raw.length > AGENT_COMMAND_CATALOG_LIMITS.maxEntries)
    invalid(`${path}.entries`);
  const kind = agentCommandCatalogEntryKind(provider);
  const names = new Set<string>();
  const entries = raw.map((entry, index) => {
    const entryPath = `${path}.entries[${index}]`;
    const parsed = parseEntry(entry, kind, entryPath);
    if (names.has(parsed.name)) invalid(`${entryPath}.name`);
    names.add(parsed.name);
    return parsed;
  });
  return Object.freeze({ version: 1, provider, truncated, entries: Object.freeze(entries) });
}

export function sameAgentCommandCatalog(
  left: AgentCommandCatalog,
  right: AgentCommandCatalog,
): boolean {
  if (left === right) return true;
  if (left.provider !== right.provider || left.truncated !== right.truncated) return false;
  if (left.entries.length !== right.entries.length) return false;
  return left.entries.every((entry, index) => sameEntry(entry, right.entries[index]));
}

function sameEntry(
  left: AgentCommandCatalogEntry,
  right: AgentCommandCatalogEntry | undefined,
): boolean {
  if (right === undefined) return false;
  return ENTRY_KEYS.every((key) => left[key] === right[key]);
}

function parseEntry(
  value: unknown,
  kind: AgentCommandCatalogEntryKind,
  path: string,
): AgentCommandCatalogEntry {
  const entry = record(value, path);
  exactKeys(entry, ENTRY_KEYS, path);
  if (entry.kind !== kind) invalid(`${path}.kind`);
  const name = entry.name;
  if (
    typeof name !== "string" ||
    name.length > AGENT_COMMAND_CATALOG_LIMITS.maxNameBytes ||
    !AGENT_COMMAND_NAME_PATTERN.test(name)
  )
    invalid(`${path}.name`);
  const builtin = entry.builtin;
  if (typeof builtin !== "boolean") invalid(`${path}.builtin`);
  return Object.freeze({
    kind,
    name,
    label: optionalText(entry.label, AGENT_COMMAND_CATALOG_LIMITS.maxLabelBytes, `${path}.label`),
    description: optionalText(
      entry.description,
      AGENT_COMMAND_CATALOG_LIMITS.maxDescriptionBytes,
      `${path}.description`,
    ),
    argumentHint: optionalText(
      entry.argumentHint,
      AGENT_COMMAND_CATALOG_LIMITS.maxArgumentHintBytes,
      `${path}.argumentHint`,
    ),
    builtin,
  });
}

function isRepositoryRoot(value: string): boolean {
  if (value.length === 0 || value.length > AGENT_COMMAND_CATALOG_LIMITS.maxRepositoryRootBytes)
    return false;
  if (!value.startsWith("/") && !WINDOWS_ROOT.test(value)) return false;
  if (/\p{Cc}/u.test(value)) return false;
  return (
    UTF8_ENCODER.encode(value).byteLength <= AGENT_COMMAND_CATALOG_LIMITS.maxRepositoryRootBytes
  );
}

function optionalText(value: unknown, maxBytes: number, path: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxBytes ||
    UTF8_ENCODER.encode(value).byteLength > maxBytes ||
    /\p{Cc}/u.test(value)
  )
    invalid(path);
  return value;
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

function member<T extends string>(value: unknown, choices: ReadonlyArray<T>, path: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) invalid(path);
  return value as T;
}

function invalid(path: string): never {
  throw new TypeError(`Invalid agent command catalog at ${path}.`);
}
