import { exceedsScannedFileContentLength } from "../domain/fileScanPolicy";
import type { LattePhpExtensionCallableKind } from "../domain/lattePhpExtensionFilters";
import { lattePhpExtensionFunctionsFromSource } from "../domain/lattePhpExtensionFunctions";
import { evictOtherRootCacheEntries } from "./latteIntelligenceRuntime";
import {
  captureLatteExpressionGeneration,
  LATTE_FILTER_CACHE_TTL_MS,
  LATTE_TEMPLATE_SCAN_DIRECTORIES,
  MAX_LATTE_FILTER_CONFIG_FILES,
  MAX_LATTE_SCAN_DEPTH,
  type LatteProviderFlowCaches,
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import type { LatteProviderRequestContext } from "./latteProviderRequestContext";
import {
  isLatteScanSkippedDirectory,
  type LatteDirectoryEntry,
} from "./netteTemplateDiscovery";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface LatteFunctionDiscoveryDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  listDirectory(path: string): Promise<LatteDirectoryEntry[]>;
  readFileContent(path: string): Promise<string>;
}

export interface LatteFunctionRegistrationTarget {
  callableOffset?: number;
  callableKind?: LattePhpExtensionCallableKind;
  className?: string;
  methodName?: string;
  name: string;
  offset: number;
  path: string;
  serviceClassName?: string;
}

export interface LatteFunctionCacheEntry {
  expiresAt: number;
  generation: number;
  registrations: LatteFunctionRegistrationTarget[];
}

export type LatteFunctionCache = Record<string, LatteFunctionCacheEntry>;
export type LatteFunctionInFlight = Map<
  string,
  Promise<LatteFunctionRegistrationTarget[]>
>;

export interface LatteFunctionDiscoveryContext {
  cache: LatteFunctionCache;
  deps: LatteFunctionDiscoveryDependencies;
  generation: number;
  inFlight: LatteFunctionInFlight;
  isDirectorySkipped(path: string): boolean;
  isRequestedRootActive(): boolean;
  maxSourceFiles: number;
  maxDepth: number;
  requestedRoot: string;
  scanDirectories: readonly string[];
  ttlMs: number;
}

interface FunctionSourceScanState {
  phpSourceFilesFound: number;
  visitedDirectories: Set<string>;
}

interface LatteFunctionDiscoveryState {
  cache: LatteFunctionCache;
  inFlight: LatteFunctionInFlight;
}

const PHP_EXTENSION = ".php";

const discoveryStateByCaches = new WeakMap<
  LatteProviderFlowCaches,
  LatteFunctionDiscoveryState
>();

export function latteFunctionDiscoveryContext(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
): LatteFunctionDiscoveryContext {
  const state = discoveryState(options.caches);
  const fence = captureLatteExpressionGeneration(
    options.caches,
    request.requestedRoot,
  );
  evictOtherRootCacheEntries(state.cache, request.requestedRoot);
  evictOtherRootInFlight(state.inFlight, request.requestedRoot);
  evictOutdatedGenerationEntries(state, request.requestedRoot, fence.generation);

  return {
    cache: state.cache,
    deps: request.deps,
    generation: fence.generation,
    inFlight: state.inFlight,
    isDirectorySkipped: isLatteScanSkippedDirectory,
    isRequestedRootActive: () =>
      request.isRequestedRootActive() && fence.isCurrent(),
    maxSourceFiles: MAX_LATTE_FILTER_CONFIG_FILES,
    maxDepth: MAX_LATTE_SCAN_DEPTH,
    requestedRoot: request.requestedRoot,
    scanDirectories: LATTE_TEMPLATE_SCAN_DIRECTORIES,
    ttlMs: LATTE_FILTER_CACHE_TTL_MS,
  };
}

export async function loadLatteFunctionNames(
  context: LatteFunctionDiscoveryContext,
): Promise<readonly string[]> {
  const registrations = await loadLatteFunctionRegistrations(context);

  return registrations.map((registration) => registration.name);
}

export async function loadLatteFunctionRegistrations(
  context: LatteFunctionDiscoveryContext,
): Promise<LatteFunctionRegistrationTarget[]> {
  const { cache, generation, inFlight, requestedRoot } = context;
  const cached = cache[requestedRoot];

  if (
    cached &&
    cached.expiresAt > Date.now() &&
    cached.generation === generation
  ) {
    return cached.registrations;
  }

  const inFlightKey = latteFunctionInFlightKey(requestedRoot, generation);
  const existing = inFlight.get(inFlightKey);

  if (existing) {
    return existing;
  }

  const load = scanLatteFunctionRegistrations(context).finally(() => {
    if (inFlight.get(inFlightKey) === load) {
      inFlight.delete(inFlightKey);
    }
  });

  inFlight.set(inFlightKey, load);

  return load;
}

async function scanLatteFunctionRegistrations(
  context: LatteFunctionDiscoveryContext,
): Promise<LatteFunctionRegistrationTarget[]> {
  const {
    cache,
    deps,
    generation,
    isRequestedRootActive,
    maxSourceFiles,
    requestedRoot,
    scanDirectories,
    ttlMs,
  } = context;
  const phpPaths = new Set<string>();
  const scanState: FunctionSourceScanState = {
    phpSourceFilesFound: 0,
    visitedDirectories: new Set<string>(),
  };

  for (const directory of scanDirectories) {
    await collectLatteFunctionSourcePaths(
      context,
      deps.joinPath(requestedRoot, directory),
      phpPaths,
      0,
      scanState,
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    if (scanState.phpSourceFilesFound >= maxSourceFiles) {
      break;
    }
  }

  const registrationsByName = new Map<string, LatteFunctionRegistrationTarget>();

  for (const path of phpPaths) {
    if (!isRequestedRootActive()) {
      return [];
    }

    let content: string;

    try {
      content = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return [];
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    if (exceedsScannedFileContentLength(content)) {
      continue;
    }

    for (const registration of lattePhpExtensionFunctionsFromSource(content)) {
      if (registrationsByName.has(registration.name)) {
        continue;
      }

      registrationsByName.set(registration.name, { ...registration, path });
    }
  }

  if (!isRequestedRootActive()) {
    return [];
  }

  const registrations = Array.from(registrationsByName.values()).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  cache[requestedRoot] = {
    expiresAt: Date.now() + ttlMs,
    generation,
    registrations,
  };

  return registrations;
}

async function collectLatteFunctionSourcePaths(
  context: LatteFunctionDiscoveryContext,
  directory: string,
  phpPaths: Set<string>,
  depth: number,
  scanState: FunctionSourceScanState,
): Promise<void> {
  const {
    deps,
    isDirectorySkipped,
    isRequestedRootActive,
    maxSourceFiles,
    maxDepth,
  } = context;

  if (depth > maxDepth) {
    return;
  }

  if (scanState.phpSourceFilesFound >= maxSourceFiles) {
    return;
  }

  if (scanState.visitedDirectories.has(directory)) {
    return;
  }

  scanState.visitedDirectories.add(directory);

  let entries: LatteDirectoryEntry[];

  try {
    entries = await deps.listDirectory(directory);
  } catch {
    return;
  }

  if (!isRequestedRootActive()) {
    return;
  }

  for (const entry of entries) {
    if (!isRequestedRootActive()) {
      return;
    }

    if (scanState.phpSourceFilesFound >= maxSourceFiles) {
      return;
    }

    if (entry.kind === "directory") {
      if (isDirectorySkipped(entry.path)) {
        continue;
      }

      await collectLatteFunctionSourcePaths(
        context,
        entry.path,
        phpPaths,
        depth + 1,
        scanState,
      );
      continue;
    }

    if (!entry.path.endsWith(PHP_EXTENSION)) {
      continue;
    }

    phpPaths.add(entry.path);
    scanState.phpSourceFilesFound += 1;
  }
}

function discoveryState(
  caches: LatteProviderFlowCaches,
): LatteFunctionDiscoveryState {
  const existing = discoveryStateByCaches.get(caches);

  if (existing) {
    return existing;
  }

  const created: LatteFunctionDiscoveryState = {
    cache: {},
    inFlight: new Map(),
  };
  discoveryStateByCaches.set(caches, created);
  return created;
}

function evictOtherRootInFlight(
  inFlight: LatteFunctionInFlight,
  requestedRoot: string,
): void {
  for (const key of inFlight.keys()) {
    const separator = key.indexOf("\u0000");
    const keyRoot = separator < 0 ? key : key.slice(0, separator);

    if (workspaceRootKeysEqual(keyRoot, requestedRoot)) {
      continue;
    }

    inFlight.delete(key);
  }
}

function evictOutdatedGenerationEntries(
  state: LatteFunctionDiscoveryState,
  requestedRoot: string,
  generation: number,
): void {
  for (const [root, entry] of Object.entries(state.cache)) {
    if (!workspaceRootKeysEqual(root, requestedRoot)) {
      continue;
    }

    if (entry.generation !== generation) {
      delete state.cache[root];
    }
  }

  for (const key of state.inFlight.keys()) {
    if (key !== latteFunctionInFlightKey(requestedRoot, generation)) {
      state.inFlight.delete(key);
    }
  }
}

function latteFunctionInFlightKey(
  requestedRoot: string,
  generation: number,
): string {
  return `${requestedRoot}\u0000${generation}`;
}
