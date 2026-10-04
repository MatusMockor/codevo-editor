export const MAX_PROJECT_DISPLAY_NAME_CHARS = 64;

const FORBIDDEN_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const INVISIBLE_CHARACTERS = /[\p{Cf}\p{Z}\p{Cc}]/gu;
const TOKEN_PATTERN = /^[0-9a-f]{16}$/;

export type ProjectDisplayNameRejection = "tooLong" | "controlCharacters" | "noVisibleCharacters";

export type ProjectDisplayNameInput =
  | { readonly kind: "reset" }
  | { readonly kind: "name"; readonly name: string }
  | { readonly kind: "invalid"; readonly reason: ProjectDisplayNameRejection };

export interface ProjectDisplayNameEntry {
  readonly name: string;
  readonly token: string;
}

export type ProjectDisplayNameEntries = ReadonlyMap<string, ProjectDisplayNameEntry>;

export interface ProjectDisplayNameMembers {
  readonly representativeRootKey: string;
  readonly memberRootKeys: ReadonlyArray<string>;
}

export function parseProjectDisplayName(input: string): ProjectDisplayNameInput {
  const name = input.trim();
  if (name === "") return { kind: "reset" };
  if (name.length > MAX_PROJECT_DISPLAY_NAME_CHARS * 2) return invalid("tooLong");
  if (FORBIDDEN_CHARACTERS.test(name)) return invalid("controlCharacters");
  if (name.replace(INVISIBLE_CHARACTERS, "") === "") return invalid("noVisibleCharacters");
  if ([...name].length > MAX_PROJECT_DISPLAY_NAME_CHARS) return invalid("tooLong");
  return { kind: "name", name };
}

export function isProjectDisplayName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = parseProjectDisplayName(value);
  return parsed.kind === "name" && parsed.name === value;
}

export function projectDisplayNameRejectionMessage(reason: ProjectDisplayNameRejection): string {
  switch (reason) {
    case "tooLong":
      return `Use ${MAX_PROJECT_DISPLAY_NAME_CHARS} characters or fewer.`;
    case "controlCharacters":
      return "Use a single line without control characters.";
    case "noVisibleCharacters":
      return "Use at least one visible character.";
    default:
      return unsupportedRejection(reason);
  }
}

export function projectDisplayNameRootKeys(
  members: ProjectDisplayNameMembers,
): ReadonlyArray<string> {
  const others = [...new Set(members.memberRootKeys)]
    .filter((rootKey) => rootKey !== members.representativeRootKey)
    .sort(compareRootKeys);
  return [members.representativeRootKey, ...others];
}

export function projectDisplayNameOf(
  names: ReadonlyMap<string, string>,
  rootKey: string,
): string | null {
  return names.get(rootKey) ?? null;
}

export function resolveProjectDisplayName(
  names: ReadonlyMap<string, string>,
  members: ProjectDisplayNameMembers,
): string | null {
  if (names.size === 0) return null;
  for (const rootKey of projectDisplayNameRootKeys(members)) {
    const name = names.get(rootKey);
    if (name !== undefined) return name;
  }
  return null;
}

export function sameProjectDisplayName(left: string, right: string): boolean {
  return comparableName(left) === comparableName(right);
}

export function isProjectDisplayNameToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function projectDisplayNameToken(
  entries: ProjectDisplayNameEntries,
  memberRootKeys: ReadonlyArray<string>,
  displayedElsewhere: ReadonlySet<string>,
): string | null {
  const tokens = memberTokens(entries, memberRootKeys);
  if (sharedElsewhere(entries, memberRootKeys, tokens, displayedElsewhere)) return null;
  for (const rootKey of memberRootKeys) {
    const entry = entries.get(rootKey);
    if (entry !== undefined) return entry.token;
  }
  return null;
}

export function projectDisplayNameTokenInUse(
  entries: ProjectDisplayNameEntries,
  token: string,
): boolean {
  for (const entry of entries.values()) {
    if (entry.token === token) return true;
  }
  return false;
}

export function projectDisplayNameOfflineRootKeys(
  entries: ProjectDisplayNameEntries,
  memberRootKeys: ReadonlyArray<string>,
  displayedElsewhere: ReadonlySet<string>,
): ReadonlyArray<string> {
  const tokens = memberTokens(entries, memberRootKeys);
  if (tokens.size === 0) return [];
  const members = new Set(memberRootKeys);
  return [...entries]
    .filter(
      ([rootKey, entry]) =>
        tokens.has(entry.token) && !members.has(rootKey) && !displayedElsewhere.has(rootKey),
    )
    .map(([rootKey]) => rootKey)
    .sort(compareRootKeys);
}

export function renameProjectDisplayNameEntries(
  entries: ProjectDisplayNameEntries,
  memberRootKeys: ReadonlyArray<string>,
  name: string,
  token: string,
  displayedElsewhere: ReadonlySet<string>,
): ProjectDisplayNameEntries {
  const affected = affectedRootKeys(entries, memberRootKeys, displayedElsewhere);
  const renamed = new Map<string, ProjectDisplayNameEntry>();
  for (const [rootKey, entry] of entries) {
    renamed.set(rootKey, affected.has(rootKey) ? { name, token } : entry);
  }
  for (const rootKey of memberRootKeys) renamed.set(rootKey, { name, token });
  return renamed;
}

export function clearProjectDisplayNameEntries(
  entries: ProjectDisplayNameEntries,
  memberRootKeys: ReadonlyArray<string>,
  displayedElsewhere: ReadonlySet<string>,
): ProjectDisplayNameEntries {
  const affected = affectedRootKeys(entries, memberRootKeys, displayedElsewhere);
  return new Map([...entries].filter(([rootKey]) => !affected.has(rootKey)));
}

function affectedRootKeys(
  entries: ProjectDisplayNameEntries,
  memberRootKeys: ReadonlyArray<string>,
  displayedElsewhere: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set([
    ...memberRootKeys,
    ...projectDisplayNameOfflineRootKeys(entries, memberRootKeys, displayedElsewhere),
  ]);
}

function sharedElsewhere(
  entries: ProjectDisplayNameEntries,
  memberRootKeys: ReadonlyArray<string>,
  tokens: ReadonlySet<string>,
  displayedElsewhere: ReadonlySet<string>,
): boolean {
  if (tokens.size === 0) return false;
  const members = new Set(memberRootKeys);
  for (const [rootKey, entry] of entries) {
    if (tokens.has(entry.token) && !members.has(rootKey) && displayedElsewhere.has(rootKey))
      return true;
  }
  return false;
}

function memberTokens(
  entries: ProjectDisplayNameEntries,
  memberRootKeys: ReadonlyArray<string>,
): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const rootKey of memberRootKeys) {
    const entry = entries.get(rootKey);
    if (entry !== undefined) tokens.add(entry.token);
  }
  return tokens;
}

function comparableName(name: string): string {
  return name.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function compareRootKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function invalid(reason: ProjectDisplayNameRejection): ProjectDisplayNameInput {
  return { kind: "invalid", reason };
}

function unsupportedRejection(reason: never): never {
  throw new TypeError(`Unsupported project display name rejection: ${String(reason)}.`);
}
