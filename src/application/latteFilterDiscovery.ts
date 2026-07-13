import {
  latteFilterRegistrationsFromSource,
} from "../domain/latteFilterRegistrations";
import type { LatteDirectoryEntry } from "./netteTemplateDiscovery";

export interface LatteFilterDiscoveryDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  listDirectory(path: string): Promise<LatteDirectoryEntry[]>;
  readFileContent(path: string): Promise<string>;
}

export interface LatteFilterRegistrationTarget {
  name: string;
  offset: number;
  path: string;
}

export interface LatteFilterCacheEntry {
  expiresAt: number;
  registrations: LatteFilterRegistrationTarget[];
}

export type LatteFilterCache = Record<string, LatteFilterCacheEntry>;
export type LatteFilterInFlight = Map<
  string,
  Promise<LatteFilterRegistrationTarget[]>
>;

export interface LatteFilterDiscoveryContext {
  cache: LatteFilterCache;
  deps: LatteFilterDiscoveryDependencies;
  inFlight: LatteFilterInFlight;
  isDirectorySkipped(path: string): boolean;
  isRequestedRootActive(): boolean;
  maxConfigFiles: number;
  maxDepth: number;
  requestedRoot: string;
  scanDirectories: readonly string[];
  ttlMs: number;
}

interface FilterConfigScanState {
  configFilesFound: number;
  visitedDirectories: Set<string>;
}

const NEON_EXTENSION = ".neon";

export async function loadLatteFilterNames(
  context: LatteFilterDiscoveryContext,
): Promise<readonly string[]> {
  const registrations = await loadLatteFilterRegistrations(context);

  return registrations.map((registration) => registration.name);
}

export async function loadLatteFilterRegistrations(
  context: LatteFilterDiscoveryContext,
): Promise<LatteFilterRegistrationTarget[]> {
  const { cache, inFlight, requestedRoot } = context;
  const cached = cache[requestedRoot];

  if (cached && cached.expiresAt > Date.now()) {
    return cached.registrations;
  }

  const existing = inFlight.get(requestedRoot);

  if (existing) {
    return existing;
  }

  const load = scanLatteFilterRegistrations(context).finally(() => {
    if (inFlight.get(requestedRoot) === load) {
      inFlight.delete(requestedRoot);
    }
  });

  inFlight.set(requestedRoot, load);

  return load;
}

async function scanLatteFilterRegistrations(
  context: LatteFilterDiscoveryContext,
): Promise<LatteFilterRegistrationTarget[]> {
  const {
    cache,
    deps,
    isRequestedRootActive,
    maxConfigFiles,
    requestedRoot,
    scanDirectories,
    ttlMs,
  } = context;
  const configPaths = new Set<string>();
  const scanState: FilterConfigScanState = {
    configFilesFound: 0,
    visitedDirectories: new Set<string>(),
  };

  for (const directory of scanDirectories) {
    await collectLatteFilterConfigPaths(
      context,
      deps.joinPath(requestedRoot, directory),
      configPaths,
      0,
      scanState,
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    if (scanState.configFilesFound >= maxConfigFiles) {
      break;
    }
  }

  const registrationsByName = new Map<string, LatteFilterRegistrationTarget>();

  for (const path of configPaths) {
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

    for (const registration of latteFilterRegistrationsFromSource(content)) {
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
    registrations,
  };

  return registrations;
}

async function collectLatteFilterConfigPaths(
  context: LatteFilterDiscoveryContext,
  directory: string,
  into: Set<string>,
  depth: number,
  scanState: FilterConfigScanState,
): Promise<void> {
  const {
    deps,
    isDirectorySkipped,
    isRequestedRootActive,
    maxConfigFiles,
    maxDepth,
  } = context;

  if (depth > maxDepth) {
    return;
  }

  if (scanState.configFilesFound >= maxConfigFiles) {
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

    if (scanState.configFilesFound >= maxConfigFiles) {
      return;
    }

    if (entry.kind === "directory") {
      if (isDirectorySkipped(entry.path)) {
        continue;
      }

      await collectLatteFilterConfigPaths(
        context,
        entry.path,
        into,
        depth + 1,
        scanState,
      );
      continue;
    }

    if (!entry.path.endsWith(NEON_EXTENSION)) {
      continue;
    }

    into.add(entry.path);
    scanState.configFilesFound += 1;
  }
}
