import type {
  PhpFrameworkProvider,
  PhpFrameworkViewDataEntry,
  PhpFrameworkViewDataVariable,
} from "../domain/phpFrameworkProviders";
import { phpFrameworkSupportsViewDataComponentFactories } from "../domain/phpFrameworkProviders";
import { scanNetteCreateComponentViewDataEntries } from "./netteCreateComponentViewDataScanner";

export interface NetteViewDataSearchResult {
  path: string;
}

export interface NetteViewDataTypeResolver {
  resolveDeclaredType(source: string, typeHint: string | null): string | null;
}

export interface NetteViewDataDependencies extends NetteViewDataTypeResolver {
  joinPath(rootPath: string, relativePath: string): string;
  readFileContent(path: string): Promise<string>;
  searchText(
    rootPath: string,
    query: string,
    limit: number,
  ): Promise<NetteViewDataSearchResult[]>;
}

export interface NetteViewDataFrameworkCapabilities {
  viewDataEntryFromSource(
    source: string,
    providers: readonly PhpFrameworkProvider[],
  ): PhpFrameworkViewDataEntry | null;
  viewDataSearchQueries(
    providers: readonly PhpFrameworkProvider[],
  ): readonly string[];
}

export interface NetteViewDataEntry extends PhpFrameworkViewDataEntry {
  sourcePath?: string;
}

export interface NetteViewDataCacheEntry {
  entries: NetteViewDataEntry[];
  expiresAt: number;
}

export type NetteViewDataCache = Record<string, NetteViewDataCacheEntry>;

export type NetteViewDataInFlight = Map<
  string,
  Promise<NetteViewDataEntry[]>
>;

export interface NetteViewDataLoadContext {
  cache: NetteViewDataCache;
  deps: NetteViewDataDependencies;
  frameworkCapabilities: NetteViewDataFrameworkCapabilities;
  inFlight: NetteViewDataInFlight;
  isRequestedRootActive(): boolean;
  phpExtension: string;
  providers: readonly PhpFrameworkProvider[];
  requestedRoot: string;
  searchLimit: number;
  ttlMs: number;
}

/**
 * Loads (and per-root caches) presenter/control view-data entries. Concurrent
 * callers for the same root share one in-flight scan, matching Monaco's
 * completion-per-keystroke shape without leaking results across project tabs.
 */
export async function loadNetteViewDataEntries(
  context: NetteViewDataLoadContext,
): Promise<NetteViewDataEntry[]> {
  const { cache, inFlight, requestedRoot } = context;
  const cached = cache[requestedRoot];

  if (cached && cached.expiresAt > Date.now()) {
    return cached.entries;
  }

  const existingLoad = inFlight.get(requestedRoot);

  if (existingLoad) {
    return existingLoad;
  }

  const load = scanNetteViewDataEntries(context).finally(() => {
    if (inFlight.get(requestedRoot) === load) {
      inFlight.delete(requestedRoot);
    }
  });

  inFlight.set(requestedRoot, load);

  return load;
}

export function supportsNetteComponentFactoryViewData(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return phpFrameworkSupportsViewDataComponentFactories(providers);
}

export function netteViewDataVariablesForViews(
  entries: readonly PhpFrameworkViewDataEntry[],
  viewNames: readonly string[],
): PhpFrameworkViewDataVariable[] {
  const variables: PhpFrameworkViewDataVariable[] = [];

  for (const entry of entries) {
    for (const binding of entry.bindings) {
      if (!matchesLatteViewName(binding.viewName, viewNames)) {
        continue;
      }

      variables.push(...binding.variables);
    }
  }

  return variables;
}

export function matchesLatteViewName(
  bindingViewName: string,
  candidateViewNames: readonly string[],
): boolean {
  return candidateViewNames.includes(bindingViewName);
}

async function scanNetteViewDataEntries(
  context: NetteViewDataLoadContext,
): Promise<NetteViewDataEntry[]> {
  const {
    cache,
    deps,
    frameworkCapabilities,
    isRequestedRootActive,
    phpExtension,
    providers,
    requestedRoot,
    searchLimit,
    ttlMs,
  } = context;
  const searchQueries = frameworkCapabilities.viewDataSearchQueries(providers);
  const shouldScanCreateComponentContexts =
    supportsNetteComponentFactoryViewData(providers);

  if (searchQueries.length === 0 && !shouldScanCreateComponentContexts) {
    cache[requestedRoot] = {
      entries: [],
      expiresAt: Date.now() + ttlMs,
    };

    return [];
  }

  const searchResults = await Promise.all(
    searchQueries.map((query) =>
      deps.searchText(requestedRoot, query, searchLimit),
    ),
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  const visitedPaths = new Set<string>();
  const visitedSources = new Map<string, string>();
  const entries: NetteViewDataEntry[] = [];

  for (const result of searchResults.flat()) {
    if (!isRequestedRootActive()) {
      return [];
    }

    if (visitedPaths.has(result.path) || !result.path.endsWith(phpExtension)) {
      continue;
    }

    visitedPaths.add(result.path);

    let content: string;

    try {
      content = await deps.readFileContent(result.path);
    } catch {
      if (!isRequestedRootActive()) {
        return [];
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    visitedSources.set(result.path, content);

    const parsedEntry = frameworkCapabilities.viewDataEntryFromSource(
      content,
      providers,
    );

    if (!parsedEntry) {
      continue;
    }

    const entry: NetteViewDataEntry = {
      ...parsedEntry,
      sourcePath: result.path,
    };

    if (entry.bindings.length > 0) {
      entries.push(entry);
    }
  }

  if (shouldScanCreateComponentContexts) {
    entries.push(
      ...(await scanNetteCreateComponentViewDataEntries(context, visitedSources)),
    );
  }

  if (!isRequestedRootActive()) {
    return [];
  }

  cache[requestedRoot] = {
    entries,
    expiresAt: Date.now() + ttlMs,
  };

  return entries;
}
