import {
  clearProjectDisplayNameEntries,
  isProjectDisplayName,
  isProjectDisplayNameToken,
  parseProjectDisplayName,
  projectDisplayNameToken,
  projectDisplayNameTokenInUse,
  renameProjectDisplayNameEntries,
  type ProjectDisplayNameEntries,
  type ProjectDisplayNameEntry,
} from "../domain/projectDisplayName";

export const PROJECT_DISPLAY_NAMES_STORAGE_KEY = "codevo.project-display-names.v1";
export const MAX_PROJECT_DISPLAY_NAME_ENTRIES = 256;
const MAX_STORAGE_CHARS = 2_000_000;
const MAX_ROOT_KEY_CHARS = 5000;
const MAX_DISPLAYED_ROOT_KEYS = 4096;
export const MAX_PROJECT_DISPLAY_NAME_TOKEN_ATTEMPTS = 8;
const TOKEN_BYTES = 8;
const NO_NAMES: ReadonlyMap<string, string> = new Map();
const NO_ENTRIES: ProjectDisplayNameEntries = new Map();
const NO_ROOT_KEYS: ReadonlyArray<string> = [];

type StoredProjectDisplayNames =
  | {
      readonly kind: "readable";
      readonly entries: ProjectDisplayNameEntries;
      readonly names: ReadonlyMap<string, string>;
    }
  | { readonly kind: "unreadable" };

const NOTHING_STORED: StoredProjectDisplayNames = {
  kind: "readable",
  entries: NO_ENTRIES,
  names: NO_NAMES,
};
const UNREADABLE: StoredProjectDisplayNames = { kind: "unreadable" };
let cachedRaw: string | null | undefined;
let cachedStored: StoredProjectDisplayNames = NOTHING_STORED;
const subscribers = new Set<() => void>();

export type ProjectDisplayNameTokenSource = () => string;

export type ProjectDisplayNameWriteRejection =
  | "invalidProject"
  | "invalidName"
  | "tokenUnavailable"
  | "storageFull"
  | "storageUnreadable"
  | "storageUnavailable";

export type ProjectDisplayNameWrite =
  | { readonly kind: "saved" }
  | { readonly kind: "rejected"; readonly reason: ProjectDisplayNameWriteRejection };

function publish(): void {
  cachedRaw = undefined;
  for (const notify of subscribers) notify();
}

export function subscribeProjectDisplayNames(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === PROJECT_DISPLAY_NAMES_STORAGE_KEY || event.key === null) publish();
  });
}

export function randomProjectDisplayNameToken(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validRootKey(rootKey: unknown): rootKey is string {
  return (
    typeof rootKey === "string" &&
    rootKey.length > 0 &&
    rootKey.length <= MAX_ROOT_KEY_CHARS &&
    !/\p{Cc}/u.test(rootKey)
  );
}

function parseEntry(value: unknown): readonly [string, ProjectDisplayNameEntry] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [rootKey, name, token]: readonly unknown[] = value;
  if (!validRootKey(rootKey) || !isProjectDisplayName(name)) return null;
  if (!isProjectDisplayNameToken(token)) return null;
  return [rootKey, { name, token }];
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parse(raw: string | null): StoredProjectDisplayNames {
  if (raw === null) return NOTHING_STORED;
  if (raw.length > MAX_STORAGE_CHARS) return UNREADABLE;
  const values = parseJson(raw);
  if (!Array.isArray(values) || values.length > MAX_PROJECT_DISPLAY_NAME_ENTRIES) return UNREADABLE;
  const entries = new Map<string, ProjectDisplayNameEntry>();
  for (const value of values) {
    const entry = parseEntry(value);
    if (entry === null || entries.has(entry[0])) continue;
    entries.set(entry[0], entry[1]);
  }
  return { kind: "readable", entries, names: namesOf(entries) };
}

function namesOf(entries: ProjectDisplayNameEntries): ReadonlyMap<string, string> {
  return new Map([...entries].map(([rootKey, entry]) => [rootKey, entry.name]));
}

function readStored(): StoredProjectDisplayNames {
  try {
    const raw = window.localStorage.getItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedStored = parse(raw);
      cachedRaw = raw;
    }
    return cachedStored;
  } catch {
    return UNREADABLE;
  }
}

export function readProjectDisplayNames(): ReadonlyMap<string, string> {
  const stored = readStored();
  if (stored.kind === "unreadable") return NO_NAMES;
  return stored.names;
}

export function readProjectDisplayNameEntries(): ProjectDisplayNameEntries {
  const stored = readStored();
  if (stored.kind === "unreadable") return NO_ENTRIES;
  return stored.entries;
}

export function saveProjectDisplayName(
  rootKeys: ReadonlyArray<string>,
  name: string,
  generateToken: ProjectDisplayNameTokenSource = randomProjectDisplayNameToken,
  displayedElsewhere: ReadonlyArray<string> = NO_ROOT_KEYS,
): ProjectDisplayNameWrite {
  if (!validRootKeys(rootKeys) || !validDisplayedElsewhere(displayedElsewhere))
    return rejected("invalidProject");
  const parsed = parseProjectDisplayName(name);
  if (parsed.kind !== "name") return rejected("invalidName");
  const stored = readStored();
  if (stored.kind === "unreadable") return rejected("storageUnreadable");
  const elsewhere = new Set(displayedElsewhere);
  const token =
    projectDisplayNameToken(stored.entries, rootKeys, elsewhere) ??
    unusedToken(stored.entries, generateToken);
  if (token === null) return rejected("tokenUnavailable");
  const entries = renameProjectDisplayNameEntries(
    stored.entries,
    rootKeys,
    parsed.name,
    token,
    elsewhere,
  );
  if (entries.size > MAX_PROJECT_DISPLAY_NAME_ENTRIES) return rejected("storageFull");
  return commit(entries);
}

export function clearProjectDisplayName(
  rootKeys: ReadonlyArray<string>,
  displayedElsewhere: ReadonlyArray<string> = NO_ROOT_KEYS,
): ProjectDisplayNameWrite {
  if (!validRootKeys(rootKeys) || !validDisplayedElsewhere(displayedElsewhere))
    return rejected("invalidProject");
  const stored = readStored();
  if (stored.kind === "unreadable") return rejected("storageUnreadable");
  return commit(
    clearProjectDisplayNameEntries(stored.entries, rootKeys, new Set(displayedElsewhere)),
  );
}

export function projectDisplayNameWriteMessage(reason: ProjectDisplayNameWriteRejection): string {
  switch (reason) {
    case "invalidProject":
      return "This project can no longer be renamed.";
    case "invalidName":
      return "Enter a valid project name.";
    case "tokenUnavailable":
      return "The project name could not be linked to this project. Try again.";
    case "storageFull":
      return "Too many project names are stored. Reset another project name first.";
    case "storageUnreadable":
      return "Saved project names could not be read, so nothing was changed.";
    case "storageUnavailable":
      return "The project name could not be saved.";
    default:
      return unsupportedRejection(reason);
  }
}

function validRootKeys(rootKeys: ReadonlyArray<string>): boolean {
  if (rootKeys.length === 0 || rootKeys.length > MAX_PROJECT_DISPLAY_NAME_ENTRIES) return false;
  return rootKeys.every(validRootKey);
}

function validDisplayedElsewhere(rootKeys: ReadonlyArray<string>): boolean {
  return rootKeys.length <= MAX_DISPLAYED_ROOT_KEYS;
}

function unusedToken(
  entries: ProjectDisplayNameEntries,
  generateToken: ProjectDisplayNameTokenSource,
): string | null {
  for (let attempt = 0; attempt < MAX_PROJECT_DISPLAY_NAME_TOKEN_ATTEMPTS; attempt += 1) {
    const token = generatedToken(generateToken);
    if (token === null) return null;
    if (!projectDisplayNameTokenInUse(entries, token)) return token;
  }
  return null;
}

function generatedToken(generateToken: ProjectDisplayNameTokenSource): string | null {
  try {
    const token: unknown = generateToken();
    return isProjectDisplayNameToken(token) ? token : null;
  } catch {
    return null;
  }
}

function commit(entries: ProjectDisplayNameEntries): ProjectDisplayNameWrite {
  const encoded = JSON.stringify(
    [...entries].map(([rootKey, entry]) => [rootKey, entry.name, entry.token]),
  );
  if (encoded.length > MAX_STORAGE_CHARS) return rejected("storageFull");
  try {
    if (entries.size === 0) window.localStorage.removeItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY);
    if (entries.size > 0) window.localStorage.setItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY, encoded);
  } catch {
    return rejected("storageUnavailable");
  }
  publish();
  return { kind: "saved" };
}

function rejected(reason: ProjectDisplayNameWriteRejection): ProjectDisplayNameWrite {
  return { kind: "rejected", reason };
}

function unsupportedRejection(reason: never): never {
  throw new TypeError(`Unsupported project display name write rejection: ${String(reason)}.`);
}
