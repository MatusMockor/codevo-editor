import type { EditorPosition } from "../domain/languageServerFeatures";
import type { FileEntry, TextSearchGateway } from "../domain/workspace";
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
  readWorkspaceDirectory: (path: string) => Promise<FileEntry[]>;
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
  joinWorkspacePath: (workspaceRoot: string, relativePath: string) => string;
  isPhpPath: (path: string) => boolean;
}

/**
 * A short-lived per-workspace-root memo the directory-scan collector consults
 * before walking the tree and populates after. Both hooks are keyed by the
 * requested workspace root; the caller is expected to enforce per-project
 * isolation and TTL inside `read`/`write` (a stale root must never be served or
 * populated). `read` returns `null` on a miss and the cached targets (even an
 * empty array) on a hit.
 */
export interface WorkspaceTargetCache<Target> {
  read: (workspaceRoot: string) => Target[] | null;
  write: (workspaceRoot: string, targets: Target[]) => void;
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

/**
 * Directory-scan collector: walk one or more workspace-relative directories
 * (optionally recursively), parse every file entry, dedup and sort the parsed
 * targets, and optionally memoize the result per workspace root. This is the
 * `resources/views` / `config` / translation-file shape.
 *
 * Two-pass parsing lets a collector record a target that must survive a read
 * failure. `parseEntry` is always run once with `content` undefined (the
 * metadata pass). When `readsContent` is set and that metadata pass produced at
 * least one target, the engine reads the file and runs `parseEntry` again with
 * the content (the content pass); a read failure leaves only the metadata-pass
 * targets. Files the metadata pass does not recognize (it returns no targets)
 * are never read, so unrelated files in the directory are skipped.
 */
export interface DirectoryScanTargetCollectorConfig<Target> {
  kind: "directoryScan";
  isEnabled: () => boolean;
  /** Workspace-relative directories to scan, in order. */
  roots: readonly string[];
  /** Descend into subdirectories. Defaults to false (flat scan). */
  recursive?: boolean;
  /** Read each recognized file and run the content pass. Defaults to false. */
  readsContent?: boolean;
  /**
   * When a scanned directory cannot be read the collector yields an empty
   * result. By default that empty result is memoized like any other (matching
   * the recursive view scan, which treats a missing directory as "no views").
   * Set this to abort the scan and skip the cache write on a directory-read
   * failure so the next call re-attempts the scan (matching the flat config
   * scan, which never memoizes an unreadable `config/`).
   */
  rescanAfterDirectoryReadFailure?: boolean;
  parseEntry: (input: {
    path: string;
    relativePath: string;
    content?: string;
  }) => Target[];
  dedupKey: (target: Target) => string;
  compareTargets: (left: Target, right: Target) => number;
  cache?: WorkspaceTargetCache<Target>;
}

export interface TextSearchCollectRequest {
  workspaceRoot: string | null;
  currentDocument: { content: string; path: string };
}

export interface KnownFilesCollectRequest {
  workspaceRoot: string | null;
}

export interface DirectoryScanCollectRequest {
  workspaceRoot: string | null;
}

export type WorkspaceTargetCollectorConfig<
  Definition extends WorkspaceTargetDefinition,
  Target,
> =
  | TextSearchTargetCollectorConfig<Definition>
  | KnownFilesTargetCollectorConfig<Target>
  | DirectoryScanTargetCollectorConfig<Target>;

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

function createDirectoryScanCollector<Target>(
  deps: WorkspaceTargetCollectorDeps,
  config: DirectoryScanTargetCollectorConfig<Target>,
): (request: DirectoryScanCollectRequest) => Promise<Target[]> {
  return async (request) => {
    const requestedRoot = request.workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);

    if (!config.isEnabled() || !requestedRoot) {
      return [];
    }

    const cached = config.cache?.read(requestedRoot);

    if (cached) {
      return cached;
    }

    const targets = new Map<string, Target>();
    const remember = (target: Target) => {
      const key = config.dedupKey(target);

      if (targets.has(key)) {
        return;
      }

      targets.set(key, target);
    };

    // Set when a directory read fails and the collector is configured to
    // re-attempt the scan on the next call instead of memoizing the empty
    // result; the scan is aborted and the cache write is skipped.
    let abortWithoutCaching = false;

    const visit = async (directory: string): Promise<void> => {
      let entries: FileEntry[];

      try {
        entries = await deps.readWorkspaceDirectory(directory);
      } catch {
        if (config.rescanAfterDirectoryReadFailure) {
          abortWithoutCaching = true;
        }

        return;
      }

      if (!isRequestedRootActive()) {
        return;
      }

      for (const entry of entries) {
        if (!isRequestedRootActive() || abortWithoutCaching) {
          return;
        }

        if (entry.kind === "directory") {
          if (config.recursive) {
            await visit(entry.path);
          }

          continue;
        }

        const relativePath = deps.relativeWorkspacePath(requestedRoot, entry.path);
        const metadataTargets = config.parseEntry({
          path: entry.path,
          relativePath,
        });

        for (const target of metadataTargets) {
          remember(target);
        }

        // Only read files the metadata pass recognized; unrelated files never
        // get read.
        if (!config.readsContent || metadataTargets.length === 0) {
          continue;
        }

        try {
          const content = await deps.readFileContent(entry.path);

          if (!isRequestedRootActive()) {
            return;
          }

          for (const target of config.parseEntry({
            path: entry.path,
            relativePath,
            content,
          })) {
            remember(target);
          }
        } catch {
          if (!isRequestedRootActive()) {
            return;
          }

          // The metadata-pass targets recorded above survive the read failure.
        }
      }
    };

    for (const root of config.roots) {
      if (!isRequestedRootActive()) {
        return [];
      }

      await visit(deps.joinWorkspacePath(requestedRoot, root));

      if (!isRequestedRootActive()) {
        return [];
      }

      if (abortWithoutCaching) {
        return [];
      }
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    const result = Array.from(targets.values()).sort(config.compareTargets);

    config.cache?.write(requestedRoot, result);

    return result;
  };
}

/**
 * Builds an isolation-guarded workspace target collector from a declarative
 * config. The engine owns the copy-pasted skeleton every Laravel collector
 * shared - per-project isolation (capture root + re-check after every await),
 * the merge/dedup/sort of text-search results, the first-readable-file-wins of
 * known-file probes, the recursive/flat directory walk with optional per-root
 * memoization, and the bounded search limit - so a new collector is a few lines
 * of parser + queries (or parser + file list, or parser + roots).
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
export function createWorkspaceTargetCollector<Target>(
  deps: WorkspaceTargetCollectorDeps,
  config: DirectoryScanTargetCollectorConfig<Target>,
): (request: DirectoryScanCollectRequest) => Promise<Target[]>;
export function createWorkspaceTargetCollector(
  deps: WorkspaceTargetCollectorDeps,
  config:
    | TextSearchTargetCollectorConfig<WorkspaceTargetDefinition>
    | KnownFilesTargetCollectorConfig<unknown>
    | DirectoryScanTargetCollectorConfig<unknown>,
): (request: never) => Promise<unknown[]> {
  if (config.kind === "knownFiles") {
    return createKnownFilesCollector(deps, config) as (
      request: never,
    ) => Promise<unknown[]>;
  }

  if (config.kind === "directoryScan") {
    return createDirectoryScanCollector(deps, config) as (
      request: never,
    ) => Promise<unknown[]>;
  }

  return createTextSearchCollector(deps, config) as (
    request: never,
  ) => Promise<unknown[]>;
}
