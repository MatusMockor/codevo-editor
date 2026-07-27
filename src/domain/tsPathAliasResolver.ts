export const MAX_ALIAS_ENTRIES = 256;
export const MAX_ALIAS_CANDIDATES = 4;

const MAX_ALIAS_PATTERN_LENGTH = 512;
const MAX_ALIAS_SPECIFIER_LENGTH = 1_024;
const MAX_ALIAS_TARGET_LENGTH = 1_024;

export type TsPathAliasResolver = (specifier: string) => readonly string[];

export interface TsPathAliasResolverResult {
  readonly resolve: TsPathAliasResolver;
  readonly resolvedBaseUrl: string | null;
  readonly truncated: boolean;
}

export interface TsPathAliasResolverOptions {
  /**
   * Workspace-relative directory containing the configuration. TypeScript
   * resolves both `baseUrl` and `paths` targets from this directory.
   */
  readonly configDirectory?: string;
  /** Workspace-relative baseUrl inherited through an explicit extends chain. */
  readonly inheritedBaseUrl?: string;
}

interface AliasEntry {
  readonly baseUrl: string;
  readonly candidates: readonly string[];
  readonly exact: boolean;
  readonly prefix: string;
  readonly suffix: string;
}

interface ParsedAliasEntries {
  readonly entries: readonly AliasEntry[];
  readonly truncated: boolean;
}

interface ParsedAliasEntry {
  readonly entry: AliasEntry | null;
  readonly truncated: boolean;
}

export function createTsPathAliasResolver(
  tsconfig: unknown,
  options: TsPathAliasResolverOptions = {},
): TsPathAliasResolverResult {
  const configDirectory = normalizeWorkspacePath(options.configDirectory ?? "");
  const inheritedBaseUrl =
    options.inheritedBaseUrl === undefined
      ? undefined
      : normalizeWorkspacePath(options.inheritedBaseUrl);
  const resolvedBaseUrl =
    configDirectory === null || inheritedBaseUrl === null
      ? null
      : parseBaseUrl(tsconfig, configDirectory, inheritedBaseUrl);
  const { entries, truncated } =
    resolvedBaseUrl === null
      ? { entries: [], truncated: false }
      : parseAliasEntries(tsconfig, resolvedBaseUrl);
  return {
    resolve: (specifier) => resolveAliasSpecifier(specifier, entries),
    resolvedBaseUrl,
    truncated,
  };
}

function parseBaseUrl(
  tsconfig: unknown,
  configDirectory: string,
  inheritedBaseUrl: string | undefined,
): string | null {
  if (!isRecord(tsconfig)) return null;
  const compilerOptions = tsconfig.compilerOptions;
  if (compilerOptions === undefined) return inheritedBaseUrl ?? configDirectory;
  if (!isRecord(compilerOptions)) return null;
  const baseUrlValue = compilerOptions.baseUrl;
  if (baseUrlValue === undefined) return inheritedBaseUrl ?? configDirectory;
  if (typeof baseUrlValue !== "string") return null;
  return normalizeWorkspacePath(baseUrlValue, configDirectory);
}

function parseAliasEntries(tsconfig: unknown, baseUrl: string): ParsedAliasEntries {
  if (!isRecord(tsconfig)) return { entries: [], truncated: false };
  const compilerOptions = tsconfig.compilerOptions;
  if (!isRecord(compilerOptions)) return { entries: [], truncated: false };
  const paths = compilerOptions.paths;
  if (!isRecord(paths)) return { entries: [], truncated: false };
  const entries: AliasEntry[] = [];
  let truncated = false;
  let seen = 0;
  for (const pattern in paths) {
    if (!Object.prototype.hasOwnProperty.call(paths, pattern)) continue;
    seen += 1;
    if (seen > MAX_ALIAS_ENTRIES) {
      truncated = true;
      break;
    }
    const parsed = parseAliasEntry(pattern, paths[pattern], baseUrl);
    if (parsed.truncated) truncated = true;
    if (parsed.entry) entries.push(parsed.entry);
  }
  return { entries: entries.sort(compareAliasEntries), truncated };
}

function parseAliasEntry(pattern: string, value: unknown, baseUrl: string): ParsedAliasEntry {
  if (pattern.length === 0 || pattern.length > MAX_ALIAS_PATTERN_LENGTH || !Array.isArray(value)) {
    return { entry: null, truncated: false };
  }
  const wildcard = pattern.indexOf("*");
  if (wildcard !== pattern.lastIndexOf("*")) return { entry: null, truncated: false };
  const exact = wildcard < 0;
  const candidates: string[] = [];
  for (const target of value.slice(0, MAX_ALIAS_CANDIDATES)) {
    if (typeof target !== "string" || target.length > MAX_ALIAS_TARGET_LENGTH) continue;
    if (target.includes("\\")) continue;
    const targetWildcard = target.indexOf("*");
    if (targetWildcard !== target.lastIndexOf("*")) continue;
    if (exact && targetWildcard >= 0) continue;
    candidates.push(target);
  }
  const truncated = value.length > MAX_ALIAS_CANDIDATES;
  if (candidates.length === 0) return { entry: null, truncated };
  return {
    entry: {
      baseUrl,
      candidates,
      exact,
      prefix: exact ? pattern : pattern.slice(0, wildcard),
      suffix: exact ? "" : pattern.slice(wildcard + 1),
    },
    truncated,
  };
}

function compareAliasEntries(left: AliasEntry, right: AliasEntry): number {
  if (left.exact !== right.exact) return left.exact ? -1 : 1;
  const prefixDifference = right.prefix.length - left.prefix.length;
  if (prefixDifference !== 0) return prefixDifference;
  return right.suffix.length - left.suffix.length;
}

function resolveAliasSpecifier(
  specifier: string,
  entries: readonly AliasEntry[],
): readonly string[] {
  if (specifier.length === 0 || specifier.length > MAX_ALIAS_SPECIFIER_LENGTH) return [];
  for (const entry of entries) {
    const wildcardValue = matchAliasEntry(specifier, entry);
    if (wildcardValue === null) continue;
    const candidates: string[] = [];
    for (const target of entry.candidates) {
      const substituted = target.includes("*") ? target.replace("*", () => wildcardValue) : target;
      const candidate = normalizeWorkspacePath(substituted, entry.baseUrl);
      if (!candidate || candidates.includes(candidate)) continue;
      candidates.push(candidate);
    }
    return candidates;
  }
  return [];
}

function matchAliasEntry(specifier: string, entry: AliasEntry): string | null {
  if (entry.exact) return specifier === entry.prefix ? "" : null;
  if (!specifier.startsWith(entry.prefix) || !specifier.endsWith(entry.suffix)) return null;
  const wildcardEnd = specifier.length - entry.suffix.length;
  if (wildcardEnd < entry.prefix.length) return null;
  return specifier.slice(entry.prefix.length, wildcardEnd);
}

function normalizeWorkspacePath(path: string, baseUrl = ""): string | null {
  const normalizedInput = path.replace(/\\/g, "/");
  if (normalizedInput.startsWith("/") || /^[A-Za-z]:\//.test(normalizedInput)) return null;
  const segments: string[] = [];
  for (const segment of `${baseUrl}/${normalizedInput}`.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
