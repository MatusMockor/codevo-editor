import {
  exceedsScannedFileContentLength,
} from "../domain/fileScanPolicy";
import {
  latteFilterRegistrationsFromSource,
} from "../domain/latteFilterRegistrations";
import {
  lattePhpExtensionFiltersFromSource,
  type LattePhpExtensionCallableKind,
} from "../domain/lattePhpExtensionFilters";
import type { LatteDirectoryEntry } from "./netteTemplateDiscovery";

export interface LatteFilterDiscoveryDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  listDirectory(path: string): Promise<LatteDirectoryEntry[]>;
  readFileContent(path: string): Promise<string>;
}

export interface LatteFilterRegistrationTarget {
  callableOffset?: number;
  callableKind?: LattePhpExtensionCallableKind;
  callable?: LatteFilterRegistrationCallableTarget;
  methodName?: string;
  name: string;
  offset: number;
  path: string;
  serviceClassName?: string;
  serviceName?: string;
}

export interface LatteFilterRegistrationCallableTarget {
  methodName: string;
  serviceClassName?: string;
  serviceName?: string;
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
  neonConfigFilesFound: number;
  phpSourceFilesFound: number;
  visitedDirectories: Set<string>;
}

const NEON_EXTENSION = ".neon";
const PHP_EXTENSION = ".php";

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
  const neonPaths = new Set<string>();
  const phpPaths = new Set<string>();
  const scanState: FilterConfigScanState = {
    neonConfigFilesFound: 0,
    phpSourceFilesFound: 0,
    visitedDirectories: new Set<string>(),
  };

  for (const directory of scanDirectories) {
    await collectLatteFilterSourcePaths(
      context,
      deps.joinPath(requestedRoot, directory),
      neonPaths,
      phpPaths,
      0,
      scanState,
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    if (areFilterSourceBudgetsExhausted(scanState, maxConfigFiles)) {
      break;
    }
  }

  const registrationsByName = new Map<string, LatteFilterRegistrationTarget>();

  for (const path of neonPaths) {
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

    for (const registration of latteFilterRegistrationsFromSource(content)) {
      if (registrationsByName.has(registration.name)) {
        continue;
      }

      registrationsByName.set(
        registration.name,
        latteFilterRegistrationTarget(registration, path),
      );
    }
  }

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

    for (const registration of lattePhpExtensionFiltersFromSource(content)) {
      if (registrationsByName.has(registration.name)) {
        continue;
      }

      registrationsByName.set(
        registration.name,
        latteFilterRegistrationTarget(registration, path),
      );
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

function latteFilterRegistrationTarget(
  registration: {
    callable?: LatteFilterRegistrationCallableTarget;
    callableOffset?: number;
    callableKind?: LattePhpExtensionCallableKind;
    methodName?: string;
    name: string;
    offset: number;
    serviceClassName?: string;
    serviceName?: string;
  },
  path: string,
): LatteFilterRegistrationTarget {
  const methodName = registration.methodName ?? registration.callable?.methodName;
  const serviceClassName =
    registration.serviceClassName ?? registration.callable?.serviceClassName;
  const serviceName = registration.serviceName ?? registration.callable?.serviceName;

  return {
    ...registration,
    path,
    ...(methodName === undefined ? {} : { methodName }),
    ...(serviceClassName === undefined ? {} : { serviceClassName }),
    ...(serviceName === undefined ? {} : { serviceName }),
  };
}

async function collectLatteFilterSourcePaths(
  context: LatteFilterDiscoveryContext,
  directory: string,
  neonPaths: Set<string>,
  phpPaths: Set<string>,
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

  if (areFilterSourceBudgetsExhausted(scanState, maxConfigFiles)) {
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

    if (areFilterSourceBudgetsExhausted(scanState, maxConfigFiles)) {
      return;
    }

    if (entry.kind === "directory") {
      if (isDirectorySkipped(entry.path)) {
        continue;
      }

      await collectLatteFilterSourcePaths(
        context,
        entry.path,
        neonPaths,
        phpPaths,
        depth + 1,
        scanState,
      );
      continue;
    }

    if (entry.path.endsWith(NEON_EXTENSION)) {
      if (scanState.neonConfigFilesFound >= maxConfigFiles) {
        continue;
      }

      neonPaths.add(entry.path);
      scanState.neonConfigFilesFound += 1;
    } else if (entry.path.endsWith(PHP_EXTENSION)) {
      if (scanState.phpSourceFilesFound >= maxConfigFiles) {
        continue;
      }

      phpPaths.add(entry.path);
      scanState.phpSourceFilesFound += 1;
    }
  }
}

function areFilterSourceBudgetsExhausted(
  scanState: FilterConfigScanState,
  maxSourceFiles: number,
): boolean {
  return (
    scanState.neonConfigFilesFound >= maxSourceFiles &&
    scanState.phpSourceFilesFound >= maxSourceFiles
  );
}
