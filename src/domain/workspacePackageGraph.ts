export const MAX_WORKSPACE_GLOB_PATTERNS = 128;
export const MAX_WORKSPACE_GLOB_EXPANSIONS = 256;
export const MAX_WORKSPACE_PACKAGES = 256;
export const MAX_WORKSPACE_SOURCE_FILES = 2_000;
export const MAX_WORKSPACE_SPECIFIER_DEPTH = 8;

const MAX_GLOB_LENGTH = 512;
const MAX_GLOB_SEGMENTS = 64;
const MAX_GLOB_MATCH_OPERATIONS = 65_536;
const MAX_PACKAGE_NAME_LENGTH = 214;
const MAX_RELATIVE_PATH_LENGTH = 4_096;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/iu;
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;
const TYPESCRIPT_SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const;

export interface WorkspacePackageManifestInput {
  readonly packageJson: unknown;
  readonly relativeDirPath: string;
}

export type WorkspacePackage =
  | {
      readonly name: string;
      readonly relativeDirPath: string;
      readonly sourceEntry: string;
      readonly status: "resolved";
    }
  | {
      readonly name: string;
      readonly relativeDirPath: string;
      readonly status: "unresolved";
    };

export type WorkspacePackagePathResolution =
  | { readonly relativePath: string; readonly status: "resolved" }
  | { readonly status: "missing" | "unresolved" };

export interface WorkspacePackageGraph {
  readonly packages: readonly WorkspacePackage[];
  readonly resolve: (specifier: string) => readonly string[];
  readonly resolvePackageDirectory: (specifier: string) => WorkspacePackagePathResolution;
  readonly resolvePackagePath: (specifier: string) => WorkspacePackagePathResolution;
  readonly truncated: boolean;
}

interface GlobBudget {
  expansions: number;
  matchOperations: number;
  truncated: boolean;
}

type WorkspacePatterns =
  | { readonly patterns: readonly string[]; readonly status: "supported" }
  | { readonly status: "unsupported" };

export function createWorkspacePackageGraph({
  authorityComplete = true,
  packageManifests,
  pnpmWorkspaceYaml,
  rootPackageJson,
  sourceFilePaths,
}: {
  readonly authorityComplete?: boolean;
  readonly packageManifests: readonly WorkspacePackageManifestInput[];
  readonly pnpmWorkspaceYaml: string | undefined;
  readonly rootPackageJson: unknown;
  readonly sourceFilePaths: readonly string[];
}): WorkspacePackageGraph {
  if (!authorityComplete) return emptyGraph(true);
  if (
    packageManifests.length > MAX_WORKSPACE_PACKAGES ||
    sourceFilePaths.length > MAX_WORKSPACE_SOURCE_FILES
  ) {
    return emptyGraph(true);
  }
  const npmPatterns = npmWorkspacePatterns(rootPackageJson);
  const pnpmPatterns = pnpmWorkspacePatterns(pnpmWorkspaceYaml);
  if (npmPatterns.status === "unsupported" || pnpmPatterns.status === "unsupported") {
    return emptyGraph(true);
  }
  const rawPatterns = [...npmPatterns.patterns, ...pnpmPatterns.patterns];
  if (rawPatterns.length === 0) return emptyGraph(false);
  if (rawPatterns.length > MAX_WORKSPACE_GLOB_PATTERNS) return emptyGraph(true);
  const budget: GlobBudget = { expansions: 0, matchOperations: 0, truncated: false };
  const patterns: string[] = [];
  for (const rawPattern of rawPatterns) {
    const expanded = expandWorkspaceGlob(rawPattern, budget);
    if (budget.truncated) return emptyGraph(true);
    patterns.push(...expanded);
    if (patterns.length > MAX_WORKSPACE_GLOB_EXPANSIONS) return emptyGraph(true);
  }
  const sourceFiles = normalizedSourceFiles(sourceFilePaths);
  if (!sourceFiles) return emptyGraph(true);
  const packages: WorkspacePackage[] = [];
  for (const input of packageManifests) {
    const relativeDirPath = normalizeRelativePath(input.relativeDirPath);
    if (!relativeDirPath) continue;
    if (!matchesWorkspacePatterns(relativeDirPath, patterns, budget)) {
      if (budget.truncated) return emptyGraph(true);
      continue;
    }
    const manifest = record(input.packageJson);
    if (!manifest) continue;
    const name = packageName(manifest.name);
    if (!name) continue;
    const sourceEntry = packageSourceEntry(relativeDirPath, manifest, sourceFiles);
    packages.push(
      sourceEntry
        ? { name, relativeDirPath, sourceEntry, status: "resolved" }
        : { name, relativeDirPath, status: "unresolved" },
    );
  }
  if (budget.truncated) return emptyGraph(true);
  const ordered = packages.sort(
    (left, right) =>
      compareText(left.name, right.name) ||
      compareText(left.relativeDirPath, right.relativeDirPath),
  );
  const packageByName = new Map<string, WorkspacePackage | null>();
  for (const workspacePackage of ordered) {
    if (packageByName.has(workspacePackage.name)) {
      packageByName.set(workspacePackage.name, null);
      continue;
    }
    packageByName.set(workspacePackage.name, workspacePackage);
  }
  return {
    packages: ordered,
    resolve: (specifier) => {
      if (!validBarePackageSpecifier(specifier)) return [];
      const workspacePackage = packageByName.get(specifier);
      return workspacePackage?.status === "resolved" ? [workspacePackage.sourceEntry] : [];
    },
    resolvePackageDirectory: (specifier) => resolvePackageDirectory(specifier, packageByName),
    resolvePackagePath: (specifier) => resolvePackagePath(specifier, packageByName),
    truncated: false,
  };
}

function emptyGraph(truncated: boolean): WorkspacePackageGraph {
  return {
    packages: [],
    resolve: () => [],
    resolvePackageDirectory: () => ({ status: "missing" }),
    resolvePackagePath: () => ({ status: "missing" }),
    truncated,
  };
}

function npmWorkspacePatterns(rootPackageJson: unknown): WorkspacePatterns {
  const manifest = record(rootPackageJson);
  if (!manifest || manifest.workspaces === undefined) {
    return { patterns: [], status: "supported" };
  }
  if (Array.isArray(manifest.workspaces)) {
    if (manifest.workspaces.every((value) => typeof value === "string")) {
      return { patterns: manifest.workspaces, status: "supported" };
    }
    return { status: "unsupported" };
  }
  const workspaces = record(manifest.workspaces);
  if (!workspaces || !Array.isArray(workspaces.packages)) {
    return { status: "unsupported" };
  }
  if (workspaces.packages.every((value) => typeof value === "string")) {
    return { patterns: workspaces.packages as string[], status: "supported" };
  }
  return { status: "unsupported" };
}

function pnpmWorkspacePatterns(source: string | undefined): WorkspacePatterns {
  if (source === undefined) return { patterns: [], status: "supported" };
  if (source.length > 256 * 1024) return { status: "unsupported" };
  const patterns: string[] = [];
  let inPackages = false;
  let seenPackages = false;
  let seenContent = false;
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const topLevel = !rawLine.startsWith(" ") && !rawLine.startsWith("\t");
    if (topLevel && (line === "---" || line === "...")) {
      if (!seenContent) continue;
      return { patterns, status: "supported" };
    }
    if (!seenContent && topLevel && line.startsWith("%")) continue;
    seenContent = true;
    const packagesMatch = topLevel ? /^(?:packages|'packages'|"packages"):(.*)$/u.exec(line) : null;
    if (packagesMatch) {
      if (seenPackages) return { status: "unsupported" };
      seenPackages = true;
      const packageValue = stripYamlTrailingComment(packagesMatch[1] ?? "").trim();
      if (!packageValue) {
        inPackages = true;
        continue;
      }
      const flow = parseYamlFlowStrings(packageValue);
      if (!flow) return { status: "unsupported" };
      patterns.push(...flow);
      inPackages = false;
      continue;
    }
    if (topLevel && !line.startsWith("-")) {
      inPackages = false;
      continue;
    }
    if (!inPackages) continue;
    if (!/^-(?:\s|$)/u.test(line)) return { status: "unsupported" };
    const value = unquoteYamlScalar(stripYamlTrailingComment(line.slice(1)).trim());
    if (value === null) return { status: "unsupported" };
    patterns.push(value);
    if (patterns.length > MAX_WORKSPACE_GLOB_PATTERNS) {
      return { patterns, status: "supported" };
    }
  }
  return { patterns, status: "supported" };
}

function parseYamlFlowStrings(value: string): readonly string[] | null {
  if (!value.startsWith("[") || !value.endsWith("]")) return null;
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  const values: string[] = [];
  let start = 0;
  let quote = "";
  for (let index = 0; index <= inner.length; index += 1) {
    const token = inner[index] ?? ",";
    if ((token === "'" || token === '"') && (!quote || quote === token)) {
      quote = quote ? "" : token;
      continue;
    }
    if (token !== "," || quote) continue;
    const scalar = unquoteYamlScalar(inner.slice(start, index).trim());
    if (scalar === null) return null;
    values.push(scalar);
    if (values.length > MAX_WORKSPACE_GLOB_PATTERNS) return values;
    start = index + 1;
  }
  return quote ? null : values;
}

function unquoteYamlScalar(value: string): string | null {
  if (!value) return null;
  const quote = value[0];
  if (quote !== "'" && quote !== '"') {
    if (
      "&*!{[|>%@`,]}".includes(quote) ||
      /^[-?:](?:\s|$)/u.test(value) ||
      value.includes("#") ||
      value.includes(": ")
    ) {
      return null;
    }
    return value;
  }
  if (value.length < 2 || value[value.length - 1] !== quote) return null;
  const inner = value.slice(1, -1);
  if (quote === "'" && inner.includes("''")) return inner.replace(/''/gu, "'");
  if (inner.includes("\\")) return null;
  return inner;
}

function stripYamlTrailingComment(value: string): string {
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const token = value[index] ?? "";
    if (quote === "'" && token === "'" && value[index + 1] === "'") {
      index += 1;
      continue;
    }
    if ((token === "'" || token === '"') && (!quote || quote === token)) {
      quote = quote ? "" : token;
      continue;
    }
    if (token !== "#" || quote) continue;
    if (index > 0 && !/\s/u.test(value[index - 1] ?? "")) continue;
    return value.slice(0, index).trimEnd();
  }
  return value;
}

function expandWorkspaceGlob(rawPattern: string, budget: GlobBudget): readonly string[] {
  const negated = rawPattern.startsWith("!");
  const value = negated ? rawPattern.slice(1) : rawPattern;
  const normalized = normalizeGlob(value);
  if (!normalized) {
    budget.truncated = true;
    return [];
  }
  const braceStart = normalized.indexOf("{");
  if (braceStart < 0) {
    budget.expansions += 1;
    if (budget.expansions > MAX_WORKSPACE_GLOB_EXPANSIONS) budget.truncated = true;
    return [`${negated ? "!" : ""}${normalized}`];
  }
  const braceEnd = normalized.indexOf("}", braceStart + 1);
  const nextBrace = normalized.indexOf("{", braceStart + 1);
  if (braceEnd < 0 || (nextBrace >= 0 && nextBrace < braceEnd)) {
    budget.truncated = true;
    return [];
  }
  const alternatives = normalized.slice(braceStart + 1, braceEnd).split(",");
  if (alternatives.some((alternative) => !alternative)) {
    budget.truncated = true;
    return [];
  }
  const expanded: string[] = [];
  for (const alternative of alternatives) {
    const nested = `${normalized.slice(0, braceStart)}${alternative}${normalized.slice(braceEnd + 1)}`;
    expanded.push(...expandWorkspaceGlob(`${negated ? "!" : ""}${nested}`, budget));
    if (budget.truncated) return [];
  }
  return expanded;
}

function normalizeGlob(value: string): string | null {
  const normalized = value.replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
  if (
    !normalized ||
    normalized.length > MAX_GLOB_LENGTH ||
    normalized.startsWith("/") ||
    normalized.split("/").length > MAX_GLOB_SEGMENTS ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return normalized;
}

function matchesWorkspacePatterns(
  relativeDirPath: string,
  patterns: readonly string[],
  budget: GlobBudget,
): boolean {
  let included = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    const candidate = negated ? pattern.slice(1) : pattern;
    if (!globMatches(relativeDirPath, candidate, budget)) {
      if (budget.truncated) return false;
      continue;
    }
    included = !negated;
  }
  return included;
}

function globMatches(path: string, pattern: string, budget: GlobBudget): boolean {
  const pathSegments = path.split("/");
  const patternSegments = pattern.split("/");
  const pending: Array<readonly [number, number]> = [[0, 0]];
  const visited = new Set<string>();
  while (pending.length > 0) {
    budget.matchOperations += 1;
    if (budget.matchOperations > MAX_GLOB_MATCH_OPERATIONS) {
      budget.truncated = true;
      return false;
    }
    const state = pending.pop();
    if (!state) return false;
    const [pathIndex, patternIndex] = state;
    const key = `${pathIndex}:${patternIndex}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (patternIndex === patternSegments.length) {
      if (pathIndex === pathSegments.length) return true;
      continue;
    }
    const patternSegment = patternSegments[patternIndex];
    if (patternSegment === "**") {
      pending.push([pathIndex, patternIndex + 1]);
      if (pathIndex < pathSegments.length) pending.push([pathIndex + 1, patternIndex]);
      continue;
    }
    if (
      pathIndex >= pathSegments.length ||
      !segmentMatches(pathSegments[pathIndex] ?? "", patternSegment ?? "", budget)
    ) {
      continue;
    }
    pending.push([pathIndex + 1, patternIndex + 1]);
  }
  return false;
}

function segmentMatches(value: string, pattern: string, budget: GlobBudget): boolean {
  let valueIndex = 0;
  let patternIndex = 0;
  let wildcardIndex = -1;
  let wildcardValueIndex = -1;
  while (valueIndex < value.length) {
    budget.matchOperations += 1;
    if (budget.matchOperations > MAX_GLOB_MATCH_OPERATIONS) {
      budget.truncated = true;
      return false;
    }
    const token = pattern[patternIndex];
    if (token === "?" || token === value[valueIndex]) {
      valueIndex += 1;
      patternIndex += 1;
      continue;
    }
    if (token === "*") {
      wildcardIndex = patternIndex;
      wildcardValueIndex = valueIndex;
      patternIndex += 1;
      continue;
    }
    if (wildcardIndex < 0) return false;
    patternIndex = wildcardIndex + 1;
    wildcardValueIndex += 1;
    valueIndex = wildcardValueIndex;
  }
  while (pattern[patternIndex] === "*") {
    budget.matchOperations += 1;
    if (budget.matchOperations > MAX_GLOB_MATCH_OPERATIONS) {
      budget.truncated = true;
      return false;
    }
    patternIndex += 1;
  }
  return patternIndex === pattern.length;
}

function packageSourceEntry(
  relativeDirPath: string,
  manifest: Readonly<Record<string, unknown>>,
  sourceFiles: ReadonlySet<string>,
): string | null {
  const declaredEntries = [
    sourceDirectoryEntry(manifest.module),
    sourceDirectoryEntry(manifest.main),
  ];
  const hasDeclaredEntry = typeof manifest.module === "string" || typeof manifest.main === "string";
  const hasExcludedBuildOutputEntry =
    isBuildOutputEntry(manifest.module) || isBuildOutputEntry(manifest.main);
  const sourceIndexCandidates =
    !hasDeclaredEntry || hasExcludedBuildOutputEntry
      ? [
          ...TYPESCRIPT_SOURCE_EXTENSIONS.map((extension) => `src/index${extension}`),
          ...SOURCE_EXTENSIONS.map((extension) => `src/index${extension}`),
        ]
      : [];
  const candidates = [
    sourceConditionEntry(record(manifest.publishConfig)?.exports, 0),
    stringValue(record(manifest.publishConfig)?.source),
    sourceConditionEntry(manifest.exports, 0),
    stringValue(manifest.source),
    ...declaredEntries,
    ...sourceIndexCandidates,
    ...SOURCE_EXTENSIONS.map((extension) => `index${extension}`),
    ...["lib", "out", "build"].flatMap((directory) =>
      SOURCE_EXTENSIONS.map((extension) => `${directory}/index${extension}`),
    ),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = resolvePackageRelativePath(relativeDirPath, candidate);
    if (!normalized) continue;
    for (const preferred of typescriptSourceCandidates(normalized)) {
      if (sourceFiles.has(preferred)) return preferred;
    }
  }
  return null;
}

function sourceConditionEntry(value: unknown, depth: number): string | null {
  if (depth > MAX_WORKSPACE_SPECIFIER_DEPTH) return null;
  const exports = record(value);
  if (!exports) return null;
  if (typeof exports.source === "string") return exports.source;
  if (Object.prototype.hasOwnProperty.call(exports, ".")) {
    return sourceConditionEntry(exports["."], depth + 1);
  }
  return null;
}

function sourceDirectoryEntry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizePackageEntryPath(value);
  if (!normalized) return null;
  return buildOutputPath(normalized) ? null : normalized;
}

function isBuildOutputEntry(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = normalizePackageEntryPath(value);
  return normalized ? buildOutputPath(normalized) : false;
}

function buildOutputPath(value: string): boolean {
  const firstSegment = value.split("/")[0];
  return (
    firstSegment === ".next" ||
    firstSegment === "dist" ||
    firstSegment === "build" ||
    firstSegment === "lib" ||
    firstSegment === "out"
  );
}

function normalizePackageEntryPath(value: string): string | null {
  const normalizedValue = value.replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (!normalizedValue || normalizedValue.startsWith("/")) return null;
  const segments: string[] = [];
  for (const segment of normalizedValue.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

function resolvePackageDirectory(
  specifier: string,
  packageByName: ReadonlyMap<string, WorkspacePackage | null>,
): WorkspacePackagePathResolution {
  const parsed = packageSpecifier(specifier);
  if (!parsed || parsed.subpath) return { status: "missing" };
  const workspacePackage = packageByName.get(parsed.packageName);
  if (workspacePackage === undefined) return { status: "missing" };
  if (workspacePackage === null) return { status: "unresolved" };
  return { relativePath: workspacePackage.relativeDirPath, status: "resolved" };
}

function resolvePackagePath(
  specifier: string,
  packageByName: ReadonlyMap<string, WorkspacePackage | null>,
): WorkspacePackagePathResolution {
  const parsed = packageSpecifier(specifier);
  if (!parsed) return { status: "missing" };
  const workspacePackage = packageByName.get(parsed.packageName);
  if (workspacePackage === undefined) return { status: "missing" };
  if (workspacePackage === null) return { status: "unresolved" };
  if (!parsed.subpath) {
    if (workspacePackage.status === "unresolved") return { status: "unresolved" };
    return { relativePath: workspacePackage.sourceEntry, status: "resolved" };
  }
  const relativePath = resolvePackageRelativePath(workspacePackage.relativeDirPath, parsed.subpath);
  return relativePath ? { relativePath, status: "resolved" } : { status: "unresolved" };
}

function packageSpecifier(
  value: string,
): { readonly packageName: string; readonly subpath: string } | null {
  if (!value || value.length > MAX_RELATIVE_PATH_LENGTH || value.includes("\\")) return null;
  const segments = value.split("/");
  const packageSegmentCount = value.startsWith("@") ? 2 : 1;
  if (segments.length < packageSegmentCount) return null;
  const name = packageName(segments.slice(0, packageSegmentCount).join("/"));
  if (!name) return null;
  const subpathSegments = segments.slice(packageSegmentCount);
  if (
    subpathSegments.length > MAX_WORKSPACE_SPECIFIER_DEPTH ||
    subpathSegments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return { packageName: name, subpath: subpathSegments.join("/") };
}

function resolvePackageRelativePath(relativeDirPath: string, value: string): string | null {
  const normalizedValue = value.replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (!normalizedValue || normalizedValue.length > MAX_RELATIVE_PATH_LENGTH) return null;
  const segments = relativeDirPath.split("/");
  for (const segment of normalizedValue.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length <= relativeDirPath.split("/").length) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function typescriptSourceCandidates(path: string): readonly string[] {
  const extension = SOURCE_EXTENSIONS.find((candidate) => path.endsWith(candidate));
  if (!extension) return [path];
  const base = path.slice(0, -extension.length);
  return SOURCE_EXTENSIONS.map((candidate) => `${base}${candidate}`);
}

function normalizedSourceFiles(paths: readonly string[]): ReadonlySet<string> | null {
  const normalized = new Set<string>();
  for (const path of paths) {
    const candidate = normalizeRelativePath(path);
    if (!candidate) return null;
    normalized.add(candidate);
  }
  return normalized;
}

function normalizeRelativePath(value: string): string | null {
  const normalized = value.replace(/\\/gu, "/").replace(/\/+$/u, "");
  if (
    !normalized ||
    normalized.length > MAX_RELATIVE_PATH_LENGTH ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    normalized.split("/").includes("node_modules")
  ) {
    return null;
  }
  return normalized;
}

function validBarePackageSpecifier(value: string): boolean {
  if (value.split("/").length > MAX_WORKSPACE_SPECIFIER_DEPTH) return false;
  return packageName(value) !== null;
}

function packageName(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > MAX_PACKAGE_NAME_LENGTH ||
    !PACKAGE_NAME_PATTERN.test(value)
  ) {
    return null;
  }
  return value;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
