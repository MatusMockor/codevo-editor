import {
  netteTemplateOwnershipsFromPhpFactorySource,
  type NetteTemplateOwnership,
} from "../domain/netteTemplateOwnership";
import { phpDeclaresExactFactoryClass } from "../domain/phpDeclaredFactoryMethod";
import {
  normalizedWorkspaceRootKey,
  workspaceRootKeysEqual,
} from "../domain/workspaceRootKey";

export interface NetteFactoryTemplateOwner {
  className: string;
  dependencyPaths: string[];
  factoryPaths: string[];
  path: string;
  source: string;
}

export interface NetteFactoryTemplateOwnerDependencies {
  readFileContent(path: string): Promise<string>;
  resolvePhpClassSourcePaths(className: string): Promise<string[]>;
  searchText(
    rootPath: string,
    query: string,
    maxResults: number,
  ): Promise<{ path: string }[]>;
}

export interface NetteFactoryTemplateOwnerCacheEntry {
  dependencyPaths: string[];
  ownersByTemplatePath: Record<
    string,
    NetteFactoryTemplateOwnerCachedResult
  >;
}

export interface NetteFactoryTemplateOwnerCachedResult {
  expiresAt: number;
  owner: NetteFactoryTemplateOwner | null;
}

export type NetteFactoryTemplateOwnerCache = Record<
  string,
  NetteFactoryTemplateOwnerCacheEntry
>;
export type NetteFactoryTemplateOwnerInFlight = Map<
  string,
  Promise<NetteFactoryTemplateOwner | null>
>;

export interface NetteFactoryTemplateOwnerGeneration {
  next: number;
  roots: Record<string, number>;
}

export interface NetteFactoryTemplateOwnerDiscoveryContext {
  cache: NetteFactoryTemplateOwnerCache;
  deps: NetteFactoryTemplateOwnerDependencies;
  generation: NetteFactoryTemplateOwnerGeneration;
  inFlight: NetteFactoryTemplateOwnerInFlight;
  isRequestedRootActive(): boolean;
  maxSearchResults: number;
  requestedRoot: string;
  ttlMs: number;
}

interface FactoryOwnerCandidate {
  factoryPath: string;
  ownerClassName: string;
}

const PHP_EXTENSION = ".php";
const MAX_OWNER_SOURCE_CHARACTERS = 750_000;
const MAX_OWNER_SOURCE_PATHS = 20;

export function createNetteFactoryTemplateOwnerGeneration():
  NetteFactoryTemplateOwnerGeneration {
  return { next: 0, roots: {} };
}

export function captureNetteFactoryTemplateOwnerGeneration(
  generation: NetteFactoryTemplateOwnerGeneration,
  rootPath: string,
): { generation: number; isCurrent(): boolean; rootKey: string } {
  const rootKey = ensureRootGeneration(generation, rootPath);
  const captured = generation.roots[rootKey] ?? 0;

  return {
    generation: captured,
    isCurrent: () => generation.roots[rootKey] === captured,
    rootKey,
  };
}

export async function loadNetteFactoryTemplateOwner(
  context: NetteFactoryTemplateOwnerDiscoveryContext,
  templatePath: string,
): Promise<NetteFactoryTemplateOwner | null> {
  if (!context.isRequestedRootActive()) {
    return null;
  }

  const rootKey = ensureRootGeneration(
    context.generation,
    context.requestedRoot,
  );
  const targetKey = normalizePath(templatePath);

  if (!targetKey || !templateBasename(targetKey)) {
    return null;
  }

  const cached = context.cache[rootKey]?.ownersByTemplatePath[targetKey];

  if (cached && cached.expiresAt > Date.now()) {
    return cached.owner;
  }

  const inFlightKey = `${rootKey}\0${targetKey}`;
  const existing = context.inFlight.get(inFlightKey);

  if (existing) {
    const result = await existing;
    return context.isRequestedRootActive() ? result : null;
  }

  const capturedGeneration = context.generation.roots[rootKey] ?? 0;
  const load = scanNetteFactoryTemplateOwner(
    context,
    rootKey,
    targetKey,
    capturedGeneration,
  ).finally(() => {
    if (context.inFlight.get(inFlightKey) === load) {
      context.inFlight.delete(inFlightKey);
    }
  });
  context.inFlight.set(inFlightKey, load);

  return load;
}

export const discoverNetteFactoryTemplateOwner =
  loadNetteFactoryTemplateOwner;

export function invalidateNetteFactoryTemplateOwnersForPath(
  cache: NetteFactoryTemplateOwnerCache,
  inFlight: NetteFactoryTemplateOwnerInFlight,
  generation: NetteFactoryTemplateOwnerGeneration,
  rootPath: string | null,
  path: string,
): void {
  if (!rootPath || !path.toLowerCase().endsWith(PHP_EXTENSION)) {
    return;
  }

  const rootKey = normalizedWorkspaceRootKey(rootPath);

  if (!pathBelongsToRoot(path, rootKey)) {
    return;
  }

  delete cache[rootKey];
  deleteInFlightForRoot(inFlight, rootKey);
  generation.next = Math.max(
    generation.next,
    generation.roots[rootKey] ?? 0,
  ) + 1;
  generation.roots[rootKey] = generation.next;
}

export function isNetteFactoryTemplateOwnerDependencyPath(
  cache: NetteFactoryTemplateOwnerCache,
  rootPath: string | null,
  path: string,
): boolean {
  if (!rootPath) {
    return false;
  }

  const rootKey = normalizedWorkspaceRootKey(rootPath);
  return (
    cache[rootKey]?.dependencyPaths.some(
      (dependencyPath) => normalizePath(dependencyPath) === normalizePath(path),
    ) ?? false
  );
}

export function evictOtherRootNetteFactoryTemplateOwnerEntries(
  cache: NetteFactoryTemplateOwnerCache,
  inFlight: NetteFactoryTemplateOwnerInFlight,
  generation: NetteFactoryTemplateOwnerGeneration,
  requestedRoot: string | null,
): void {
  const activeRoot = requestedRoot
    ? normalizedWorkspaceRootKey(requestedRoot)
    : null;
  const roots = new Set([
    ...Object.keys(cache),
    ...Array.from(inFlight.keys(), (key) => key.split("\0", 1)[0] ?? ""),
    ...Object.keys(generation.roots),
  ]);

  for (const root of roots) {
    if (activeRoot && workspaceRootKeysEqual(root, activeRoot)) {
      continue;
    }

    delete cache[root];
    deleteInFlightForRoot(inFlight, root);
    delete generation.roots[root];
  }
}

async function scanNetteFactoryTemplateOwner(
  context: NetteFactoryTemplateOwnerDiscoveryContext,
  rootKey: string,
  targetPath: string,
  capturedGeneration: number,
): Promise<NetteFactoryTemplateOwner | null> {
  const { deps, isRequestedRootActive, maxSearchResults, requestedRoot } =
    context;
  const basename = templateBasename(targetPath);

  if (!basename) {
    return null;
  }

  let searchResults: { path: string }[];

  try {
    searchResults = await deps.searchText(
      requestedRoot,
      basename,
      maxSearchResults,
    );
  } catch {
    searchResults = [];
  }

  if (!isRequestedRootActive()) {
    return null;
  }

  const factoryPaths = confinedPhpPaths(
    searchResults,
    requestedRoot,
    maxSearchResults,
  );
  const candidates: FactoryOwnerCandidate[] = [];

  for (const factoryPath of factoryPaths) {
    if (!isRequestedRootActive()) {
      return null;
    }

    let source: string;

    try {
      source = await deps.readFileContent(factoryPath);
    } catch {
      if (!isRequestedRootActive()) {
        return null;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return null;
    }

    for (const ownership of netteTemplateOwnershipsFromPhpFactorySource(
      source,
    )) {
      if (
        !ownershipMatchesTarget(
          ownership,
          factoryPath,
          requestedRoot,
          targetPath,
        )
      ) {
        continue;
      }

      candidates.push({
        factoryPath,
        ownerClassName: ownership.ownerClassName,
      });
    }
  }

  const resolved = await resolveSingleOwner(context, candidates);

  if (!isRequestedRootActive()) {
    return null;
  }

  const dependencyPaths = Array.from(
    new Set([
      ...factoryPaths,
      ...(resolved?.dependencyPaths ?? []),
    ]),
  ).sort((left, right) => left.localeCompare(right));

  if (resolved) {
    resolved.dependencyPaths = dependencyPaths;
  }

  if (
    context.generation.roots[rootKey] !== capturedGeneration ||
    !isRequestedRootActive()
  ) {
    return null;
  }

  const targetKey = normalizePath(targetPath);
  const current = context.cache[rootKey];
  const ownersByTemplatePath = current?.ownersByTemplatePath ?? {};
  const currentDependencies = current?.dependencyPaths ?? [];

  context.cache[rootKey] = {
    dependencyPaths: Array.from(
      new Set([...currentDependencies, ...dependencyPaths]),
    ).sort((left, right) => left.localeCompare(right)),
    ownersByTemplatePath: {
      ...ownersByTemplatePath,
      [targetKey]: {
        expiresAt: Date.now() + context.ttlMs,
        owner: resolved,
      },
    },
  };

  return resolved;
}

async function resolveSingleOwner(
  context: NetteFactoryTemplateOwnerDiscoveryContext,
  candidates: readonly FactoryOwnerCandidate[],
): Promise<NetteFactoryTemplateOwner | null> {
  if (candidates.length === 0) {
    return null;
  }

  const classNames = new Map<string, string>();

  for (const candidate of candidates) {
    classNames.set(
      candidate.ownerClassName.toLowerCase(),
      candidate.ownerClassName,
    );
  }

  if (classNames.size !== 1) {
    return null;
  }

  const className = classNames.values().next().value;

  if (!className) {
    return null;
  }

  let sourcePaths: string[];

  try {
    sourcePaths = await context.deps.resolvePhpClassSourcePaths(className);
  } catch {
    return null;
  }

  if (!context.isRequestedRootActive()) {
    return null;
  }

  if (sourcePaths.length > MAX_OWNER_SOURCE_PATHS) {
    return null;
  }

  if (
    sourcePaths.some(
      (sourcePath) => !pathBelongsToRoot(sourcePath, context.requestedRoot),
    )
  ) {
    return null;
  }

  const pathsByNormalizedPath = new Map(
    sourcePaths.map((sourcePath) => {
      const canonicalPath = collapsePath(sourcePath);
      return [canonicalPath, canonicalPath];
    }),
  );

  if (pathsByNormalizedPath.size !== 1) {
    return null;
  }

  const path = pathsByNormalizedPath.values().next().value;

  if (!path) {
    return null;
  }

  let source: string;

  try {
    source = await context.deps.readFileContent(path);
  } catch {
    return null;
  }

  if (
    !context.isRequestedRootActive() ||
    source.length > MAX_OWNER_SOURCE_CHARACTERS ||
    !phpDeclaresExactFactoryClass(source, className)
  ) {
    return null;
  }

  const factoryPaths = Array.from(
    new Set(candidates.map((candidate) => candidate.factoryPath)),
  ).sort((left, right) => left.localeCompare(right));

  return {
    className,
    dependencyPaths: [...factoryPaths, path],
    factoryPaths,
    path,
    source,
  };
}

function ownershipMatchesTarget(
  ownership: NetteTemplateOwnership,
  factoryPath: string,
  requestedRoot: string,
  targetPath: string,
): boolean {
  const root = normalizedWorkspaceRootKey(requestedRoot);
  const normalizedTarget = collapsePath(
    isAbsolutePath(targetPath) ? targetPath : `${root}/${targetPath}`,
  );
  const reference = normalizePath(ownership.template.path);

  if (!pathBelongsToRoot(normalizedTarget, root)) {
    return false;
  }

  if (ownership.template.kind === "factoryDirectory") {
    const resolved = collapsePath(`${dirname(factoryPath)}/${reference}`);
    return pathBelongsToRoot(resolved, root) && resolved === normalizedTarget;
  }

  const normalizedLiteral = reference.replace(/^\/+/, "");

  if (
    !normalizedLiteral.includes("/") ||
    normalizedLiteral === ".." ||
    normalizedLiteral.startsWith("../")
  ) {
    return false;
  }

  if (isAbsolutePath(reference)) {
    const absoluteReference = collapsePath(reference);
    return (
      pathBelongsToRoot(absoluteReference, root) &&
      normalizedTarget === absoluteReference
    );
  }

  const relativeTarget = workspaceRelativeTemplatePath(root, normalizedTarget);
  const relativeLiteral = collapseRootRelativePath(normalizedLiteral);
  return relativeLiteral !== null && relativeTarget === relativeLiteral;
}

function workspaceRelativeTemplatePath(
  requestedRoot: string,
  targetPath: string,
): string | null {
  if (!isAbsolutePath(targetPath)) {
    return collapseRootRelativePath(targetPath);
  }

  const root = collapsePath(requestedRoot).replace(/\/+$/, "");

  if (!targetPath.startsWith(`${root}/`)) {
    return null;
  }

  return targetPath.slice(root.length + 1);
}

function collapseRootRelativePath(path: string): string | null {
  const segments: string[] = [];

  for (const segment of normalizePath(path).split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (segments.length === 0) {
        return null;
      }

      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return segments.join("/");
}

function isAbsolutePath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
}

function confinedPhpPaths(
  results: readonly { path: string }[],
  requestedRoot: string,
  limit: number,
): string[] {
  const paths = new Set<string>();

  for (const result of results) {
    if (paths.size >= limit) {
      break;
    }

    const canonicalPath = collapsePath(result.path);

    if (
      canonicalPath.toLowerCase().endsWith(PHP_EXTENSION) &&
      pathBelongsToRoot(canonicalPath, requestedRoot)
    ) {
      paths.add(canonicalPath);
    }
  }

  return Array.from(paths);
}

function ensureRootGeneration(
  generation: NetteFactoryTemplateOwnerGeneration,
  rootPath: string,
): string {
  const rootKey = normalizedWorkspaceRootKey(rootPath);

  if (!Object.prototype.hasOwnProperty.call(generation.roots, rootKey)) {
    generation.next += 1;
    generation.roots[rootKey] = generation.next;
  }

  return rootKey;
}

function deleteInFlightForRoot(
  inFlight: NetteFactoryTemplateOwnerInFlight,
  rootKey: string,
): void {
  const prefix = `${rootKey}\0`;

  for (const key of inFlight.keys()) {
    if (key.startsWith(prefix)) {
      inFlight.delete(key);
    }
  }
}

function pathBelongsToRoot(path: string, root: string): boolean {
  const normalizedPath = collapsePath(path);
  const normalizedRoot = collapsePath(root).replace(/\/+$/, "");
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

function templateBasename(path: string): string {
  return normalizePath(path).split("/").pop() ?? "";
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? "" : normalized.slice(0, separator);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function collapsePath(path: string): string {
  const normalized = normalizePath(path);
  const prefix = normalized.startsWith("/") ? "/" : "";
  const segments: string[] = [];

  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return `${prefix}${segments.join("/")}`;
}
