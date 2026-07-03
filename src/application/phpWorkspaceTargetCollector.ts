import type { EditorPosition } from "../domain/languageServerFeatures";
import type { TextSearchGateway } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

// Upper bound on text-search matches pulled per query. Matches the pre-extraction
// call sites verbatim (`searchText(root, query, 200)`), so migrated collectors
// keep fanning out the exact same bounded search.
const WORKSPACE_TARGET_SEARCH_LIMIT = 200;

/**
 * A parsed definition every text-search collector shares: a named symbol at a
 * source position. The engine derives both the dedup key and the sort order from
 * these two fields alone, so a new text-search collector only has to supply its
 * parser + search queries.
 */
export interface WorkspaceTargetDefinition {
  name: string;
  position: EditorPosition;
}

/**
 * A file-scoped target: a parsed definition plus the file it lives in. Exactly
 * `{ ...definition, path, relativePath }` - the shape every text-search
 * collector returned before this engine was extracted.
 */
export type WorkspaceFileTarget<Definition extends WorkspaceTargetDefinition> =
  Definition & { path: string; relativePath: string | null };

/**
 * The workspace primitives every collector needs. All I/O plus the active-root
 * ref are injected so the engine stays a pure, React-free unit: the isolation
 * skeleton (capture requested root, re-check after every await) lives here once
 * instead of being copy-pasted into every collector.
 */
export interface WorkspaceTargetCollectorDeps {
  currentWorkspaceRootRef: { readonly current: string | null };
  textSearch: Pick<TextSearchGateway, "searchText">;
  readFileContent: (path: string) => Promise<string>;
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
  joinWorkspacePath: (workspaceRoot: string, relativePath: string) => string;
  isPhpPath: (path: string) => boolean;
}

/**
 * Text-search collector: seed the current document, fan out one or more search
 * queries, read + parse every matched PHP file, dedup by
 * `path:line:column:name` and sort by name then path. Route / gate-ability /
 * middleware-alias collectors differ only in their parser + queries.
 */
export interface TextSearchTargetCollectorConfig<
  Definition extends WorkspaceTargetDefinition,
> {
  kind: "textSearch";
  isEnabled: () => boolean;
  queries: () => readonly string[];
  parseDefinitions: (source: string) => readonly Definition[];
}

/**
 * Known-files collector: probe a fixed, ordered list of workspace-relative
 * files; the first one that reads successfully wins and its parsed targets are
 * returned as-is (even if empty). A read failure falls through to the next
 * candidate. This is the `.env` / `.env.example` shape.
 */
export interface KnownFilesTargetCollectorConfig<Target> {
  kind: "knownFiles";
  isEnabled: () => boolean;
  relativePaths: readonly string[];
  parseTargets: (input: {
    content: string;
    path: string;
    relativePath: string;
  }) => Target[];
}

export interface TextSearchCollectRequest {
  workspaceRoot: string | null;
  currentDocument: { content: string; path: string };
}

export interface KnownFilesCollectRequest {
  workspaceRoot: string | null;
}

export type WorkspaceTargetCollectorConfig<
  Definition extends WorkspaceTargetDefinition,
  Target,
> =
  | TextSearchTargetCollectorConfig<Definition>
  | KnownFilesTargetCollectorConfig<Target>;

function createTextSearchCollector<Definition extends WorkspaceTargetDefinition>(
  deps: WorkspaceTargetCollectorDeps,
  config: TextSearchTargetCollectorConfig<Definition>,
): (request: TextSearchCollectRequest) => Promise<WorkspaceFileTarget<Definition>[]> {
  return async (request) => {
    // Capture the requested root up front, then re-check it after every await so
    // a tab switch mid-flight drops the whole result instead of leaking another
    // workspace's targets into the now-active tab.
    const requestedRoot = request.workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);

    if (!config.isEnabled() || !requestedRoot) {
      return [];
    }

    const targets = new Map<string, WorkspaceFileTarget<Definition>>();
    const addDefinitions = (
      path: string,
      relativePath: string | null,
      source: string,
    ) => {
      for (const definition of config.parseDefinitions(source)) {
        const key = `${path}:${definition.position.lineNumber}:${definition.position.column}:${definition.name.toLowerCase()}`;

        if (targets.has(key)) {
          continue;
        }

        targets.set(key, { ...definition, path, relativePath });
      }
    };

    addDefinitions(
      request.currentDocument.path,
      deps.relativeWorkspacePath(requestedRoot, request.currentDocument.path),
      request.currentDocument.content,
    );

    const searchResults = await Promise.all(
      config
        .queries()
        .map((query) =>
          deps.textSearch.searchText(
            requestedRoot,
            query,
            WORKSPACE_TARGET_SEARCH_LIMIT,
          ),
        ),
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    const visitedPaths = new Set([request.currentDocument.path]);

    for (const result of searchResults.flat()) {
      if (!isRequestedRootActive()) {
        return [];
      }

      if (visitedPaths.has(result.path) || !deps.isPhpPath(result.path)) {
        continue;
      }

      visitedPaths.add(result.path);

      try {
        const content = await deps.readFileContent(result.path);

        if (!isRequestedRootActive()) {
          return [];
        }

        addDefinitions(result.path, result.relativePath, content);
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

    return Array.from(targets.values()).sort((left, right) => {
      const nameOrder = left.name.localeCompare(right.name);

      if (nameOrder !== 0) {
        return nameOrder;
      }

      return left.path.localeCompare(right.path);
    });
  };
}

function createKnownFilesCollector<Target>(
  deps: WorkspaceTargetCollectorDeps,
  config: KnownFilesTargetCollectorConfig<Target>,
): (request: KnownFilesCollectRequest) => Promise<Target[]> {
  return async (request) => {
    const requestedRoot = request.workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);

    if (!config.isEnabled() || !requestedRoot) {
      return [];
    }

    for (const relativePath of config.relativePaths) {
      if (!isRequestedRootActive()) {
        return [];
      }

      const path = deps.joinWorkspacePath(requestedRoot, relativePath);

      try {
        const content = await deps.readFileContent(path);

        if (!isRequestedRootActive()) {
          return [];
        }

        // First readable file wins - its parsed targets are returned as-is, even
        // when the file parses to nothing. Only a read failure falls through.
        return config.parseTargets({ content, path, relativePath });
      } catch {
        if (!isRequestedRootActive()) {
          return [];
        }
      }
    }

    return [];
  };
}

/**
 * Builds an isolation-guarded workspace target collector from a declarative
 * config. The engine owns the copy-pasted skeleton every Laravel collector
 * shared - per-project isolation (capture root + re-check after every await),
 * the merge/dedup/sort of text-search results, the first-readable-file-wins of
 * known-file probes, and the bounded search limit - so a new collector is a few
 * lines of parser + queries (or parser + file list).
 */
export function createWorkspaceTargetCollector<
  Definition extends WorkspaceTargetDefinition,
>(
  deps: WorkspaceTargetCollectorDeps,
  config: TextSearchTargetCollectorConfig<Definition>,
): (request: TextSearchCollectRequest) => Promise<WorkspaceFileTarget<Definition>[]>;
export function createWorkspaceTargetCollector<Target>(
  deps: WorkspaceTargetCollectorDeps,
  config: KnownFilesTargetCollectorConfig<Target>,
): (request: KnownFilesCollectRequest) => Promise<Target[]>;
export function createWorkspaceTargetCollector(
  deps: WorkspaceTargetCollectorDeps,
  config:
    | TextSearchTargetCollectorConfig<WorkspaceTargetDefinition>
    | KnownFilesTargetCollectorConfig<unknown>,
): (request: never) => Promise<unknown[]> {
  if (config.kind === "knownFiles") {
    return createKnownFilesCollector(deps, config) as (
      request: never,
    ) => Promise<unknown[]>;
  }

  return createTextSearchCollector(deps, config) as (
    request: never,
  ) => Promise<unknown[]>;
}
