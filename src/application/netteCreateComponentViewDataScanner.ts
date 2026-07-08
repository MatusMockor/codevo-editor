import {
  netteCreateComponentViewDataEntryFromSource,
} from "./netteCreateComponentViewData";
import type {
  NetteViewDataEntry,
  NetteViewDataLoadContext,
} from "./netteViewDataEntries";

const CREATE_COMPONENT_CONTEXT_SEARCH_QUERY = "createComponent";

export async function scanNetteCreateComponentViewDataEntries(
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
