export const MAX_DIRECTORY_LISTING_ENTRIES = 2000;
export const MAX_DIRECTORY_ENTRY_NAME_BYTES = 255;
export const MAX_DIRECTORY_PATH_BYTES = 4096;
export const MAX_DIRECTORY_FILTER_QUERY_CHARS = 200;

export type DirectoryEntryKind = "directory" | "file" | "symlink";

export interface DirectoryEntry {
  readonly name: string;
  readonly kind: DirectoryEntryKind;
  readonly hidden: boolean;
}

export interface DirectoryListing {
  readonly path: string;
  readonly parent: string | null;
  readonly entries: ReadonlyArray<DirectoryEntry>;
  readonly truncated: boolean;
}

export interface DirectoryListingRequest {
  readonly path: string | null;
  readonly includeFiles: boolean;
}

export interface DirectoryListingGateway {
  listDirectoryEntries(request: DirectoryListingRequest): Promise<DirectoryListing>;
  revealDirectory(path: string): Promise<void>;
}

const ENTRY_KINDS: ReadonlySet<string> = new Set<DirectoryEntryKind>([
  "directory",
  "file",
  "symlink",
]);
const UTF8_ENCODER = new TextEncoder();

export function parseDirectoryListing(value: unknown): DirectoryListing {
  const listing = record(value, "listing");
  exactKeys(listing, ["path", "parent", "entries", "truncated"], "listing");
  const path = absolutePath(listing.path, "listing.path");
  const parent = listing.parent === null ? null : absolutePath(listing.parent, "listing.parent");
  if (typeof listing.truncated !== "boolean") {
    throw new Error("listing.truncated must be a boolean.");
  }
  if (!Array.isArray(listing.entries)) {
    throw new Error("listing.entries must be an array.");
  }
  if (listing.entries.length > MAX_DIRECTORY_LISTING_ENTRIES) {
    throw new Error(`listing.entries exceeds ${MAX_DIRECTORY_LISTING_ENTRIES} entries.`);
  }
  const entries = listing.entries.map((entry, index) =>
    parseDirectoryEntry(entry, `listing.entries[${index}]`),
  );
  return { path, parent, entries, truncated: listing.truncated };
}

export function filterDirectoryEntries(
  entries: ReadonlyArray<DirectoryEntry>,
  query: string,
  showHidden: boolean,
): ReadonlyArray<DirectoryEntry> {
  const needle = query.slice(0, MAX_DIRECTORY_FILTER_QUERY_CHARS).trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (!showHidden && entry.hidden) return false;
    if (needle === "") return true;
    return entry.name.toLocaleLowerCase().includes(needle);
  });
}

export function directoryDisplayPath(path: string, homePath: string | null): string {
  if (homePath === null) return path;
  if (path === homePath) return "~/";
  if (path.startsWith(`${homePath}/`)) return `~/${path.slice(homePath.length + 1)}`;
  return path;
}

function parseDirectoryEntry(value: unknown, label: string): DirectoryEntry {
  const entry = record(value, label);
  exactKeys(entry, ["name", "kind", "hidden"], label);
  if (typeof entry.name !== "string" || entry.name === "") {
    throw new Error(`${label}.name must be a non-empty string.`);
  }
  if (UTF8_ENCODER.encode(entry.name).byteLength > MAX_DIRECTORY_ENTRY_NAME_BYTES) {
    throw new Error(`${label}.name exceeds ${MAX_DIRECTORY_ENTRY_NAME_BYTES} bytes.`);
  }
  if (entry.name.includes("/") || entry.name === "." || entry.name === "..") {
    throw new Error(`${label}.name must be a single path segment.`);
  }
  if (typeof entry.kind !== "string" || !ENTRY_KINDS.has(entry.kind)) {
    throw new Error(`${label}.kind is not a supported entry kind.`);
  }
  if (typeof entry.hidden !== "boolean") {
    throw new Error(`${label}.hidden must be a boolean.`);
  }
  return { name: entry.name, kind: entry.kind as DirectoryEntryKind, hidden: entry.hidden };
}

function absolutePath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    throw new Error(`${label} must be an absolute path.`);
  }
  if (UTF8_ENCODER.encode(value).byteLength > MAX_DIRECTORY_PATH_BYTES) {
    throw new Error(`${label} exceeds ${MAX_DIRECTORY_PATH_BYTES} bytes.`);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: ReadonlyArray<string>, label: string) {
  const actual = Object.keys(value);
  const expected = new Set(keys);
  for (const key of actual) {
    if (!expected.has(key)) throw new Error(`${label} has unsupported field "${key}".`);
  }
  for (const key of keys) {
    if (!(key in value)) throw new Error(`${label} is missing field "${key}".`);
  }
}
