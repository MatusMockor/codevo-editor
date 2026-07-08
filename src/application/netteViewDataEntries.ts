import type {
  PhpFrameworkProvider,
  PhpFrameworkViewDataEntry,
  PhpFrameworkViewDataVariable,
} from "../domain/phpFrameworkProviders";
import {
  componentClassCandidatePathsForTemplate,
  presenterCandidatePathsForTemplate,
} from "../domain/nettePathResolution";
import {
  netteCreateComponentViewDataEntryFromSource,
} from "./netteCreateComponentViewData";
import type { NetteCreateComponentTypeResolver } from "./netteCreateComponentContracts";
import { factoryDerivedLatteCandidateViewNames } from "./netteFactoryDerivedLatteViewNames";

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

export interface NetteCandidateViewNamesContext {
  deps: NetteCreateComponentTypeResolver & {
    joinPath(rootPath: string, relativePath: string): string;
    readFileContent(path: string): Promise<string>;
  };
  isRequestedRootActive(): boolean;
  presenterSuffix: string;
  controlSuffix: string;
  requestedRoot: string;
  templateRelativePath: string;
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

const NETTE_PROVIDER_ID = "nette";
const CREATE_COMPONENT_CONTEXT_SEARCH_QUERY = "createComponent";
const LATTE_TEMPLATE_EXTENSION = ".latte";

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

export function hasNetteFrameworkProvider(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return providers.some((provider) => provider.id === NETTE_PROVIDER_ID);
}

/**
 * The `"<Presenter>:<action>"` view names that could render the active template,
 * plus wildcard names used by lifecycle helpers (`beforeRender`, bare `render`).
 * This belongs with view-data matching because it defines which provider entries
 * are in scope for the current template.
 */
export async function latteCandidateViewNames(
  context: NetteCandidateViewNamesContext,
): Promise<string[]> {
  const {
    controlSuffix,
    deps,
    isRequestedRootActive,
    presenterSuffix,
    requestedRoot,
    templateRelativePath,
  } = context;
  const action = latteActionFromTemplatePath(templateRelativePath);
  const names = new Set<string>();

  for (const ownerPath of [
    ...presenterCandidatePathsForTemplate(templateRelativePath),
    ...componentClassCandidatePathsForTemplate(templateRelativePath),
  ]) {
    const fileName = ownerPath.split("/").pop() ?? "";
    const isControl = fileName.endsWith(controlSuffix);
    const suffix = fileName.endsWith(presenterSuffix)
      ? presenterSuffix
      : isControl
        ? controlSuffix
        : null;

    if (!suffix) {
      continue;
    }

    const shortName = fileName.slice(0, -suffix.length);

    names.add(`${shortName}:${action}`);
    names.add(`${shortName}:*`);

    if (isControl) {
      names.add(`${shortName}:default`);
    }
  }

  for (const name of await factoryDerivedLatteCandidateViewNames({
    action,
    deps,
    isRequestedRootActive,
    requestedRoot,
    templateRelativePath,
  })) {
    if (!isRequestedRootActive()) {
      return [];
    }

    names.add(name);
  }

  return Array.from(names);
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
  const shouldScanCreateComponentContexts = hasNetteFrameworkProvider(providers);

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

async function scanNetteCreateComponentViewDataEntries(
  context: NetteViewDataLoadContext,
  knownSources: ReadonlyMap<string, string>,
): Promise<NetteViewDataEntry[]> {
  const {
    deps,
    isRequestedRootActive,
    phpExtension,
    requestedRoot,
    searchLimit,
  } = context;
  const results = await deps.searchText(
    requestedRoot,
    CREATE_COMPONENT_CONTEXT_SEARCH_QUERY,
    searchLimit,
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  const visitedPaths = new Set<string>();
  const entries: NetteViewDataEntry[] = [];

  for (const result of results) {
    if (!isRequestedRootActive()) {
      return [];
    }

    if (visitedPaths.has(result.path) || !result.path.endsWith(phpExtension)) {
      continue;
    }

    visitedPaths.add(result.path);

    let content = knownSources.get(result.path);

    if (content === undefined) {
      try {
        content = await deps.readFileContent(result.path);
      } catch {
        if (!isRequestedRootActive()) {
          return [];
        }

        continue;
      }
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    const parsedEntry = netteCreateComponentViewDataEntryFromSource(
      deps,
      content,
    );

    if (parsedEntry.bindings.length > 0) {
      entries.push({ ...parsedEntry, sourcePath: result.path });
    }
  }

  return entries;
}

/**
 * The view/action name a template file renders: the base name without the
 * `.latte` extension, and for the classic dotted `Product.show.latte` form the
 * segment after the final dot (`show`).
 */
function latteActionFromTemplatePath(templateRelativePath: string): string {
  const fileName = templateRelativePath.split("/").pop() ?? "";
  const base = fileName.endsWith(LATTE_TEMPLATE_EXTENSION)
    ? fileName.slice(0, -LATTE_TEMPLATE_EXTENSION.length)
    : fileName;
  const dotIndex = base.lastIndexOf(".");

  if (dotIndex >= 0 && dotIndex < base.length - 1) {
    return base.slice(dotIndex + 1);
  }

  return base.length > 0 ? base : "default";
}
