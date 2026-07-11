import type { EditorPosition } from "../domain/languageServerFeatures";
import { neonIncludesFromSource } from "../domain/neonConfig";
import {
  neonGeneratedServiceNamesFromServices,
  neonParametersFromSource,
  neonServiceAliasesFromSource,
  neonServicesFromSource,
} from "../domain/netteDiContainer";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface NeonProjectConfigActiveDocument {
  path: string;
}

export interface NeonProjectConfigDirectoryEntry {
  kind: "directory" | "file";
  path: string;
}

export interface NeonProjectConfigDiscoveryDependencies {
  getActiveDocument(): NeonProjectConfigActiveDocument | null;
  joinPath(rootPath: string, relativePath: string): string;
  listDirectory(path: string): Promise<NeonProjectConfigDirectoryEntry[]>;
  readFileContent(path: string): Promise<string>;
}

/** A definition location the cross-file scan resolves a name to. */
export interface NeonDefinitionLocation {
  path: string;
  position: EditorPosition;
}

/** The merged parameters + services of every scanned `.neon` file (per root). */
export interface NeonProjectConfig {
  parameterNames: string[];
  parameters: Map<string, NeonDefinitionLocation>;
  serviceAliases: Map<string, string>;
  serviceNameTypes: Map<string, string>;
  serviceNames: string[];
  services: Map<string, NeonDefinitionLocation>;
  serviceTypeLocations: Map<string, NeonDefinitionLocation[]>;
  serviceTypes: Map<string, NeonDefinitionLocation>;
}

interface NeonConfigCacheEntry {
  config: NeonProjectConfig;
  expiresAt: number;
}

/** Per-root cache of the merged project config (keyed by requested root). */
export type NeonConfigCache = Record<string, NeonConfigCacheEntry>;

/** In-flight config scans keyed by requested root (concurrent callers join). */
export type NeonConfigInFlight = Map<string, Promise<NeonProjectConfig>>;

const NEON_CONFIG_CACHE_REVISIONS = Symbol("neonConfigCacheRevisions");

interface NeonConfigCacheRevisionStore {
  [NEON_CONFIG_CACHE_REVISIONS]?: Map<string, number>;
}

export interface NeonProjectConfigRequestContext<
  Deps extends NeonProjectConfigDiscoveryDependencies =
    NeonProjectConfigDiscoveryDependencies,
> {
  configCache: NeonConfigCache;
  configInFlight: NeonConfigInFlight;
  deps: Deps;
  isRequestedRootActive: () => boolean;
  requestedRoot: string;
}

export const NEON_EXTENSION = ".neon";

/**
 * TTL for the per-root project-config listing (parameters + services collected
 * across the project's `.neon` files). A short TTL bounds staleness after a
 * config file changes, while explicit file-change invalidation removes entries
 * immediately when a known `.neon` file changes. `evictOtherRootConfigCacheEntries`
 * bounds cross-root growth; together they keep a single active project to at
 * most one entry.
 */
const NEON_CONFIG_CACHE_TTL_MS = 5_000;

/** Hard cap on `.neon` files read in one cross-file scan (hang-safety). */
const NEON_MAX_CONFIG_FILES = 200;

/**
 * Workspace-relative directories a Nette project keeps its config `.neon` files
 * under. The current config file's own directory is always scanned too, so a
 * non-standard layout still resolves same-directory cross-file definitions.
 */
const NEON_CONFIG_SCAN_DIRECTORIES: readonly string[] = ["config", "app/config"];
const NEON_CONFIG_RECURSIVE_SCAN_DIRECTORIES: readonly string[] = [
  "app/modules",
];

/**
 * Evicts every cached root except `requestedRoot` (spec §6b cache lifecycle):
 * with a single active project tab the per-root config cache holds at most one
 * entry, so switching projects - or closing the active one - never leaves a
 * previous root's config cached forever. Called synchronously at the top of each
 * async flow, before its first `await`, so it runs against a fresh
 * `requestedRoot`.
 */
export function evictOtherRootConfigCacheEntries(
  cache: NeonConfigCache,
  requestedRoot: string | null,
): void {
  for (const cachedRoot of Object.keys(cache)) {
    if (workspaceRootKeysEqual(cachedRoot, requestedRoot)) {
      continue;
    }

    delete cache[cachedRoot];
  }
}

export function invalidateNeonConfigCacheForPath(
  cache: NeonConfigCache,
  inFlight: NeonConfigInFlight,
  requestedRoot: string | null,
  path: string,
): void {
  if (!requestedRoot || !path.endsWith(NEON_EXTENSION)) {
    return;
  }

  if (!pathBelongsToRoot(path, requestedRoot)) {
    return;
  }

  delete cache[requestedRoot];
  inFlight.delete(requestedRoot);
  bumpNeonConfigCacheRevision(cache, requestedRoot);
}

/**
 * Loads (and per-root caches) the merged project config. Concurrent callers for
 * the same root share one in-flight scan (Monaco fires a completion per
 * keystroke), mirroring the Latte loaders.
 */
export async function loadNeonProjectConfig<
  Deps extends NeonProjectConfigDiscoveryDependencies,
>(
  context: NeonProjectConfigRequestContext<Deps>,
): Promise<NeonProjectConfig> {
  const { configCache, configInFlight, requestedRoot } = context;
  const cached = configCache[requestedRoot];

  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  const existing = configInFlight.get(requestedRoot);

  if (existing) {
    return existing;
  }

  const load = scanNeonProjectConfig(context).finally(() => {
    if (configInFlight.get(requestedRoot) === load) {
      configInFlight.delete(requestedRoot);
    }
  });

  configInFlight.set(requestedRoot, load);

  return load;
}

export function emptyNeonProjectConfig(): NeonProjectConfig {
  return {
    parameterNames: [],
    parameters: new Map(),
    serviceAliases: new Map(),
    serviceNameTypes: new Map(),
    serviceNames: [],
    services: new Map(),
    serviceTypeLocations: new Map(),
    serviceTypes: new Map(),
  };
}

/**
 * The actual cross-file scan: collect the project's `.neon` files, read each
 * once, and merge their `parameters:` / named `services:` definitions (first
 * definition of a name wins). Per-project isolation: `requestedRoot` was captured
 * by the caller and re-checked after EVERY await; a stale root drops the result
 * without writing the cache.
 */
async function scanNeonProjectConfig<
  Deps extends NeonProjectConfigDiscoveryDependencies,
>(
  context: NeonProjectConfigRequestContext<Deps>,
): Promise<NeonProjectConfig> {
  const { configCache, deps, isRequestedRootActive, requestedRoot } = context;
  const cacheRevision = currentNeonConfigCacheRevision(
    configCache,
    requestedRoot,
  );
  const filePaths = await collectNeonFilePaths(context);

  if (!isRequestedRootActive()) {
    return emptyNeonProjectConfig();
  }

  const parameters = new Map<string, NeonDefinitionLocation>();
  const serviceAliases = new Map<string, string>();
  const serviceNameTypes = new Map<string, string>();
  const services = new Map<string, NeonDefinitionLocation>();
  const serviceTypeLocations = new Map<string, NeonDefinitionLocation[]>();
  const serviceTypes = new Map<string, NeonDefinitionLocation>();
  let generatedServiceStartIndex = 1;

  for (let index = 0; index < filePaths.length; index += 1) {
    const path = filePaths[index];

    if (!path) {
      continue;
    }

    if (!isRequestedRootActive()) {
      return emptyNeonProjectConfig();
    }

    let content: string;

    try {
      content = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return emptyNeonProjectConfig();
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return emptyNeonProjectConfig();
    }

    collectNeonIncludedFilePaths(context, path, content, filePaths);

    for (const parameter of neonParametersFromSource(content)) {
      if (!parameters.has(parameter.name)) {
        parameters.set(parameter.name, {
          path,
          position: editorPositionAtOffset(content, parameter.offset),
        });
      }
    }

    const sourceServices = neonServicesFromSource(content);

    for (const service of sourceServices) {
      if (service.serviceName && !services.has(service.serviceName)) {
        services.set(service.serviceName, {
          path,
          position: editorPositionAtOffset(content, service.offset),
        });
      }

      const serviceType = neonResolvableServiceType(service);

      if (
        service.serviceName &&
        serviceType &&
        !serviceNameTypes.has(service.serviceName)
      ) {
        serviceNameTypes.set(service.serviceName, serviceType);
      }

      if (serviceType && !serviceTypes.has(serviceType)) {
        const location = {
          path,
          position: editorPositionAtOffset(content, service.offset),
        };

        serviceTypes.set(serviceType, location);
      }

      if (serviceType) {
        const locations = serviceTypeLocations.get(serviceType) ?? [];
        locations.push({
          path,
          position: editorPositionAtOffset(content, service.offset),
        });
        serviceTypeLocations.set(serviceType, locations);
      }
    }

    const generated = neonGeneratedServiceNamesFromServices(
      sourceServices,
      generatedServiceStartIndex,
    );
    generatedServiceStartIndex += generated.length;

    for (const entry of generated) {
      if (!services.has(entry.name)) {
        services.set(entry.name, {
          path,
          position: editorPositionAtOffset(content, entry.service.offset),
        });
      }

      const generatedType = neonResolvableServiceType(entry.service);

      if (generatedType && !serviceNameTypes.has(entry.name)) {
        serviceNameTypes.set(entry.name, generatedType);
      }
    }

    for (const alias of neonServiceAliasesFromSource(content)) {
      if (!serviceAliases.has(alias.serviceName)) {
        serviceAliases.set(alias.serviceName, alias.targetName);
      }
    }
  }

  if (!isRequestedRootActive()) {
    return emptyNeonProjectConfig();
  }

  for (const [aliasName] of serviceAliases) {
    if (serviceNameTypes.has(aliasName)) {
      continue;
    }

    const aliasType = resolveNeonServiceTypeFromMaps(
      aliasName,
      serviceNameTypes,
      serviceAliases,
    );

    if (aliasType) {
      serviceNameTypes.set(aliasName, aliasType);
    }
  }

  const config: NeonProjectConfig = {
    parameterNames: Array.from(parameters.keys()).sort((left, right) =>
      left.localeCompare(right),
    ),
    parameters,
    serviceAliases,
    serviceNameTypes,
    serviceNames: Array.from(services.keys()).sort((left, right) =>
      left.localeCompare(right),
    ),
    services,
    serviceTypeLocations,
    serviceTypes,
  };

  if (
    cacheRevision !== currentNeonConfigCacheRevision(configCache, requestedRoot)
  ) {
    return config;
  }

  configCache[requestedRoot] = {
    config,
    expiresAt: Date.now() + NEON_CONFIG_CACHE_TTL_MS,
  };

  return config;
}

function collectNeonIncludedFilePaths<
  Deps extends NeonProjectConfigDiscoveryDependencies,
>(
  context: NeonProjectConfigRequestContext<Deps>,
  currentPath: string,
  content: string,
  filePaths: string[],
): void {
  const { requestedRoot } = context;
  const knownPaths = new Set(filePaths);

  for (const include of neonIncludesFromSource(content)) {
    if (filePaths.length >= NEON_MAX_CONFIG_FILES) {
      return;
    }

    const includedPath = resolveNeonIncludePath(
      requestedRoot,
      currentPath,
      include.path,
    );

    if (!includedPath || knownPaths.has(includedPath)) {
      continue;
    }

    knownPaths.add(includedPath);
    filePaths.push(includedPath);
  }
}

/**
 * Collects the workspace `.neon` config file paths from the candidate scan
 * directories (the current config's own directory plus conventional `config` /
 * `app/config`) and recursively from module config folders, bounded by
 * `NEON_MAX_CONFIG_FILES`. Per-project isolation: re-checks the live root after
 * every directory read.
 */
async function collectNeonFilePaths<
  Deps extends NeonProjectConfigDiscoveryDependencies,
>(context: NeonProjectConfigRequestContext<Deps>): Promise<string[]> {
  const { deps, isRequestedRootActive, requestedRoot } = context;
  const paths = new Set<string>();

  for (const directory of neonScanDirectories(deps, requestedRoot)) {
    if (!isRequestedRootActive()) {
      return [];
    }

    if (paths.size >= NEON_MAX_CONFIG_FILES) {
      break;
    }

    let entries: NeonProjectConfigDirectoryEntry[];

    try {
      entries = await deps.listDirectory(directory);
    } catch {
      if (!isRequestedRootActive()) {
        return [];
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    for (const entry of entries) {
      if (paths.size >= NEON_MAX_CONFIG_FILES) {
        break;
      }

      if (entry.kind === "file" && entry.path.endsWith(NEON_EXTENSION)) {
        paths.add(entry.path);
      }
    }
  }

  for (const directory of recursiveNeonScanDirectories(deps, requestedRoot)) {
    if (!isRequestedRootActive() || paths.size >= NEON_MAX_CONFIG_FILES) {
      break;
    }

    await collectNeonFilePathsUnderDirectory(context, directory, paths);
  }

  return Array.from(paths);
}

async function collectNeonFilePathsUnderDirectory<
  Deps extends NeonProjectConfigDiscoveryDependencies,
>(
  context: NeonProjectConfigRequestContext<Deps>,
  directory: string,
  paths: Set<string>,
): Promise<void> {
  const { deps, isRequestedRootActive } = context;

  if (!isRequestedRootActive() || paths.size >= NEON_MAX_CONFIG_FILES) {
    return;
  }

  let entries: NeonProjectConfigDirectoryEntry[];

  try {
    entries = await deps.listDirectory(directory);
  } catch {
    return;
  }

  if (!isRequestedRootActive()) {
    return;
  }

  for (const entry of entries) {
    if (!isRequestedRootActive() || paths.size >= NEON_MAX_CONFIG_FILES) {
      return;
    }

    if (entry.kind === "file") {
      if (entry.path.endsWith(NEON_EXTENSION)) {
        paths.add(entry.path);
      }

      continue;
    }

    await collectNeonFilePathsUnderDirectory(context, entry.path, paths);
  }
}

/**
 * The absolute directories the `.neon` config scan visits: the current config
 * file's own directory (so a non-standard layout still resolves), plus the
 * conventional `config` / `app/config` directories. De-duplicated.
 */
function neonScanDirectories(
  deps: NeonProjectConfigDiscoveryDependencies,
  requestedRoot: string,
): string[] {
  const directories = new Set<string>();
  const currentPath = deps.getActiveDocument()?.path ?? null;

  if (currentPath) {
    const directory = dirnameOf(currentPath);

    if (directory.length > 0) {
      directories.add(directory);
    }
  }

  for (const relative of NEON_CONFIG_SCAN_DIRECTORIES) {
    directories.add(deps.joinPath(requestedRoot, relative));
  }

  return Array.from(directories);
}

/** Conventional module root scanned recursively for ebox-crm style configs. */
function recursiveNeonScanDirectories(
  deps: NeonProjectConfigDiscoveryDependencies,
  requestedRoot: string,
): string[] {
  return NEON_CONFIG_RECURSIVE_SCAN_DIRECTORIES.map((relative) =>
    deps.joinPath(requestedRoot, relative),
  );
}

function resolveNeonIncludePath(
  requestedRoot: string,
  currentPath: string,
  includePath: string,
): string | null {
  const reference = includePath.split("\\").join("/").trim();

  if (reference.length === 0) {
    return null;
  }

  const basePath = reference.startsWith("/")
    ? normalizePathSeparators(requestedRoot)
    : dirnameOf(currentPath);
  const body = reference.startsWith("/") ? reference.replace(/^\/+/, "") : reference;
  const combined = body.length > 0 ? `${basePath}/${body}` : basePath;
  const collapsed = collapseAbsolutePath(combined);

  if (!collapsed || !pathBelongsToRoot(collapsed, requestedRoot)) {
    return null;
  }

  const lastSegment = collapsed.split("/").pop() ?? "";

  if (lastSegment.includes(".")) {
    return collapsed;
  }

  return `${collapsed}${NEON_EXTENSION}`;
}

export function editorPositionAtOffset(
  source: string,
  offset: number,
): EditorPosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineStart = before.lastIndexOf("\n") + 1;

  return {
    column: clamped - lineStart + 1,
    lineNumber: before.split("\n").length,
  };
}

export function neonServiceAliasMapFromSource(source: string): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const alias of neonServiceAliasesFromSource(source)) {
    if (!aliases.has(alias.serviceName)) {
      aliases.set(alias.serviceName, alias.targetName);
    }
  }

  return aliases;
}

export function resolveNeonServiceTypeFromMaps(
  name: string,
  serviceNameTypes: ReadonlyMap<string, string>,
  serviceAliases: ReadonlyMap<string, string>,
): string | null {
  let currentName = name;
  const seen = new Set<string>();

  for (let depth = 0; depth < 20; depth += 1) {
    if (currentName.includes("\\")) {
      return normalizeNeonServiceType(currentName);
    }

    const directType = serviceNameTypes.get(currentName);

    if (directType) {
      return directType;
    }

    if (seen.has(currentName)) {
      return null;
    }

    seen.add(currentName);

    const targetName = serviceAliases.get(currentName);

    if (!targetName) {
      return null;
    }

    currentName = targetName;
  }

  return null;
}

export function normalizeNeonServiceType(type: string): string {
  return type.replace(/^\\+/, "");
}

export function neonServiceDefinitionLocations(
  config: NeonProjectConfig,
  className: string,
): NeonDefinitionLocation[] {
  const normalizedType = normalizeNeonServiceType(className);
  const locations = [...(config.serviceTypeLocations.get(normalizedType) ?? [])];
  const exactLocation =
    config.services.get(className) ?? config.services.get(normalizedType);

  if (exactLocation) {
    locations.unshift(exactLocation);
  }

  const seen = new Set<string>();

  return locations.filter((location) => {
    const key = `${location.path}:${location.position.lineNumber}:${location.position.column}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function neonResolvableServiceType(service: {
  className: string | null;
  factory: string | null;
}): string | null {
  if (service.className) {
    return normalizeNeonServiceType(service.className);
  }

  if (!service.factory) {
    return null;
  }

  const factoryClass = service.factory.split("::")[0]?.trim() ?? "";

  if (!factoryClass || factoryClass.startsWith("@")) {
    return null;
  }

  return normalizeNeonServiceType(factoryClass);
}

function dirnameOf(path: string): string {
  const normalizedPath = normalizePathSeparators(path);
  const index = normalizedPath.lastIndexOf("/");

  if (index < 0) {
    return "";
  }

  return normalizedPath.slice(0, index);
}

function collapseAbsolutePath(path: string): string | null {
  const normalizedPath = normalizePathSeparators(path);
  const isAbsolute = normalizedPath.startsWith("/");
  const result: string[] = [];

  for (const segment of normalizedPath.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (result.length === 0) {
        return null;
      }

      result.pop();
      continue;
    }

    result.push(segment);
  }

  if (result.length === 0) {
    return isAbsolute ? "/" : null;
  }

  return `${isAbsolute ? "/" : ""}${result.join("/")}`;
}

function pathBelongsToRoot(path: string, root: string): boolean {
  const normalizedPath = normalizePathSeparators(path);
  const normalizedRoot = normalizeRootPathForComparison(root);

  if (normalizedRoot === "/") {
    return normalizedPath.startsWith("/");
  }

  if (/^[A-Za-z]:\/$/.test(normalizedRoot)) {
    return normalizedPath.startsWith(normalizedRoot);
  }

  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

function normalizePathSeparators(path: string): string {
  return path.split("\\").join("/");
}

function normalizeRootPathForComparison(root: string): string {
  const normalizedRoot = normalizePathSeparators(root);

  if (normalizedRoot === "/") {
    return normalizedRoot;
  }

  if (/^[A-Za-z]:\/$/.test(normalizedRoot)) {
    return normalizedRoot;
  }

  return normalizedRoot.replace(/\/+$/, "");
}

function currentNeonConfigCacheRevision(
  cache: NeonConfigCache,
  requestedRoot: string,
): number {
  return (
    (cache as NeonConfigCacheRevisionStore)[NEON_CONFIG_CACHE_REVISIONS]?.get(
      neonConfigCacheRevisionKey(requestedRoot),
    ) ?? 0
  );
}

function bumpNeonConfigCacheRevision(
  cache: NeonConfigCache,
  requestedRoot: string,
): void {
  const revisions = neonConfigCacheRevisions(cache);
  const key = neonConfigCacheRevisionKey(requestedRoot);
  revisions.set(key, (revisions.get(key) ?? 0) + 1);
}

function neonConfigCacheRevisions(cache: NeonConfigCache): Map<string, number> {
  const store = cache as NeonConfigCacheRevisionStore;
  const existing = store[NEON_CONFIG_CACHE_REVISIONS];

  if (existing) {
    return existing;
  }

  const revisions = new Map<string, number>();
  Object.defineProperty(store, NEON_CONFIG_CACHE_REVISIONS, {
    enumerable: false,
    value: revisions,
  });

  return revisions;
}

function neonConfigCacheRevisionKey(requestedRoot: string): string {
  return normalizeRootPathForComparison(requestedRoot);
}
