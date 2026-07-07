import {
  phpFrameworkSupportsViewData,
  phpFrameworkViewDataEntryFromSource,
  phpFrameworkViewDataSearchQueries,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { BladeViewDataEntry } from "../domain/bladeViewVariables";
import type { TextSearchGateway } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface BladeViewDataCacheRef {
  current: Record<string, BladeViewDataEntry[]>;
}

export interface BladeViewDataInFlightRef {
  current: Map<string, Promise<BladeViewDataEntry[] | null>>;
}

export interface BladeViewDataCacheDependencies {
  entriesByRootRef: BladeViewDataCacheRef;
  loadInFlightRef: BladeViewDataInFlightRef;
  currentWorkspaceRootRef: { readonly current: string | null };
  frameworkProviders: readonly PhpFrameworkProvider[];
  readNavigationFileContent: (path: string) => Promise<string>;
  textSearch: Pick<TextSearchGateway, "searchText">;
}

export async function ensureBladeViewDataEntriesLoaded(
  requestedRoot: string,
  dependencies: BladeViewDataCacheDependencies,
): Promise<BladeViewDataEntry[] | null> {
  const {
    currentWorkspaceRootRef,
    entriesByRootRef,
    frameworkProviders,
    loadInFlightRef,
    readNavigationFileContent,
    textSearch,
  } = dependencies;

  if (!requestedRoot || !phpFrameworkSupportsViewData(frameworkProviders)) {
    return null;
  }

  const cached = entriesByRootRef.current[requestedRoot];

  if (cached) {
    return cached;
  }

  const inFlight = loadInFlightRef.current.get(requestedRoot);

  if (inFlight) {
    return inFlight;
  }

  const isRequestedRootActive = () =>
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
  let load: Promise<BladeViewDataEntry[] | null> | null = null;
  const isRegisteredLoad = () =>
    load !== null && loadInFlightRef.current.get(requestedRoot) === load;

  load = (async (): Promise<BladeViewDataEntry[] | null> => {
    try {
      const searchResults = await Promise.all(
        phpFrameworkViewDataSearchQueries(frameworkProviders).map((query) =>
          textSearch.searchText(requestedRoot, query, 200),
        ),
      );

      if (!isRequestedRootActive()) {
        return null;
      }

      const visitedPaths = new Set<string>();
      const entries: BladeViewDataEntry[] = [];

      for (const result of searchResults.flat()) {
        if (!isRequestedRootActive()) {
          return null;
        }

        if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
          continue;
        }

        visitedPaths.add(result.path);

        try {
          const content = await readNavigationFileContent(result.path);

          if (!isRequestedRootActive()) {
            return null;
          }

          const entry = phpFrameworkViewDataEntryFromSource(
            content,
            frameworkProviders,
          );

          if (entry && entry.bindings.length > 0) {
            entries.push(entry);
          }
        } catch {
          if (!isRequestedRootActive()) {
            return null;
          }
        }
      }

      if (!isRequestedRootActive()) {
        return null;
      }

      if (isRegisteredLoad()) {
        entriesByRootRef.current[requestedRoot] = entries;
      }

      return entries;
    } finally {
      if (isRegisteredLoad()) {
        loadInFlightRef.current.delete(requestedRoot);
      }
    }
  })();

  loadInFlightRef.current.set(requestedRoot, load);

  return load;
}

export function invalidateBladeViewDataEntriesForPath(
  entriesByRootRef: BladeViewDataCacheRef,
  loadInFlightRef: BladeViewDataInFlightRef,
  root: string,
  path: string,
): void {
  if (!isPhpPath(path)) {
    return;
  }

  delete entriesByRootRef.current[root];
  loadInFlightRef.current.delete(root);
}

export function isPhpPath(path: string): boolean {
  return path.toLowerCase().endsWith(".php");
}
