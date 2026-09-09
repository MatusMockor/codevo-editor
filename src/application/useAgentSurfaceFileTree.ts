import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FileEntry, WorkspaceFileGateway } from "../domain/workspace";
import type {
  WorkspaceFileChangeEvent,
  WorkspaceFileChangeGateway,
} from "../domain/workspaceFileChange";

export const MAX_AGENT_SURFACE_TREE_ENTRIES = 4_000;
export const MAX_AGENT_SURFACE_TREE_DIRECTORIES = 200;
export const MAX_AGENT_SURFACE_TREE_DEPTH = 32;
export const AGENT_SURFACE_TREE_ROOT_ERROR = "This thread's checkout could not be read.";
export const AGENT_SURFACE_TREE_PROJECT_ROOT_ERROR = "The project's files could not be read.";

export interface AgentSurfaceThreadTreeTarget {
  readonly kind: "thread";
  readonly workspaceId: string;
  readonly threadId: string;
  readonly rootPath: string;
  readonly projectOwner?: { readonly ownerId: string; readonly generation: number };
}

export interface AgentSurfaceProjectTreeTarget {
  readonly kind: "project";
  readonly ownerId: string;
  readonly generation: number;
  readonly rootPath: string;
}

export type AgentSurfaceFileTreeTarget =
  AgentSurfaceThreadTreeTarget | AgentSurfaceProjectTreeTarget;

export interface AgentSurfaceFileTreeDependencies {
  readonly target: AgentSurfaceFileTreeTarget | null;
  readonly files: Pick<WorkspaceFileGateway, "readDirectory" | "readDirectoryBounded">;
  readonly fileChanges: Pick<WorkspaceFileChangeGateway, "subscribeFileChanges"> | null;
}

export interface AgentSurfaceFileTreeSurface {
  readonly rootPath: string | null;
  readonly entriesByDirectory: Record<string, FileEntry[]>;
  readonly expandedDirectories: Set<string>;
  readonly loadingDirectories: Set<string>;
  readonly failedDirectories: ReadonlySet<string>;
  readonly truncatedDirectories: ReadonlySet<string>;
  readonly rootError: string | null;
  toggleDirectory(path: string): void;
  retryDirectory(path: string): void;
  refresh(): void;
}

interface TreeState {
  readonly cache: ReadonlyMap<string, FileEntry[]>;
  readonly expanded: ReadonlySet<string>;
  readonly loading: ReadonlySet<string>;
  readonly failed: ReadonlySet<string>;
  readonly truncated: ReadonlySet<string>;
  readonly rootError: string | null;
}

const EMPTY_STATE: TreeState = Object.freeze({
  cache: new Map<string, FileEntry[]>(),
  expanded: new Set<string>(),
  loading: new Set<string>(),
  failed: new Set<string>(),
  truncated: new Set<string>(),
  rootError: null,
});

export function agentSurfaceTreeTargetKey(target: AgentSurfaceFileTreeTarget | null): string {
  if (target === null) return "";
  switch (target.kind) {
    case "thread":
      return JSON.stringify([
        target.kind,
        target.workspaceId,
        target.threadId,
        target.rootPath,
        ...(target.projectOwner === undefined
          ? []
          : [target.projectOwner.ownerId, target.projectOwner.generation]),
      ]);
    case "project":
      return JSON.stringify([target.kind, target.ownerId, target.generation, target.rootPath]);
  }
}

export function agentSurfaceChangeEventConcernsRoot(rootPath: string, eventRoot: string): boolean {
  if (isInsideAgentSurfaceRoot(rootPath, eventRoot)) return true;
  return isInsideAgentSurfaceRoot(eventRoot, rootPath);
}

export function agentSurfaceTreeRootError(target: AgentSurfaceFileTreeTarget | null): string {
  if (target?.kind === "project") return AGENT_SURFACE_TREE_PROJECT_ROOT_ERROR;
  return AGENT_SURFACE_TREE_ROOT_ERROR;
}

export function isInsideAgentSurfaceRoot(rootPath: string, path: string): boolean {
  if (path === rootPath) return true;
  if (!path.startsWith(`${rootPath}/`)) return false;
  return !path.split("/").includes("..");
}

export function agentSurfaceTreeDepth(rootPath: string, path: string): number {
  if (path === rootPath) return 0;
  return path.slice(rootPath.length + 1).split("/").length;
}

export function orderAgentSurfaceEntries(entries: ReadonlyArray<FileEntry>): FileEntry[] {
  return [...entries].sort(compareEntries);
}

function compareEntries(left: FileEntry, right: FileEntry): number {
  const leftDirectory = left.kind === "directory" ? 0 : 1;
  const rightDirectory = right.kind === "directory" ? 0 : 1;
  if (leftDirectory !== rightDirectory) return leftDirectory - rightDirectory;
  const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  if (byName !== 0) return byName;
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

function parentDirectory(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) return "/";
  return path.slice(0, index);
}

function withoutValue(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  if (!set.has(value)) return set;
  const next = new Set(set);
  next.delete(value);
  return next;
}

function withValue(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  if (set.has(value)) return set;
  return new Set(set).add(value);
}

function evictionOrder(state: TreeState, keep: string, root: string): string[] {
  const candidates = [...state.cache.keys()].filter((path) => path !== keep && path !== root);
  const collapsed = candidates.filter((path) => !state.expanded.has(path));
  const expanded = candidates.filter((path) => state.expanded.has(path));
  return [...collapsed, ...expanded];
}

function evictOverflow(state: TreeState, keep: string, root: string): TreeState {
  if (state.cache.size <= MAX_AGENT_SURFACE_TREE_DIRECTORIES) return state;
  const cache = new Map(state.cache);
  let expanded = state.expanded;
  let truncated = state.truncated;
  for (const path of evictionOrder(state, keep, root)) {
    if (cache.size <= MAX_AGENT_SURFACE_TREE_DIRECTORIES) break;
    cache.delete(path);
    expanded = withoutValue(expanded, path);
    truncated = withoutValue(truncated, path);
  }
  return { ...state, cache, expanded, truncated };
}

function storeDirectory(
  state: TreeState,
  root: string,
  path: string,
  entries: FileEntry[],
  truncated: boolean,
): TreeState {
  let child = path;
  while (child !== root) {
    const parent = parentDirectory(child);
    const siblings = state.cache.get(parent);
    if (siblings !== undefined && !state.truncated.has(parent)) {
      if (!siblings.some((entry) => entry.path === child && entry.kind === "directory")) {
        return dropDirectory(state, path);
      }
    }
    child = parent;
  }
  let retained = state;
  if (!truncated) {
    const children = new Set(
      entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path),
    );
    for (const cached of state.cache.keys()) {
      if (parentDirectory(cached) === path && !children.has(cached)) {
        retained = dropDirectory(retained, cached);
      }
    }
  }
  const cache = new Map(retained.cache);
  cache.delete(path);
  cache.set(path, entries);
  const next: TreeState = {
    ...retained,
    cache,
    loading: withoutValue(retained.loading, path),
    failed: withoutValue(retained.failed, path),
    truncated: truncated
      ? withValue(retained.truncated, path)
      : withoutValue(retained.truncated, path),
  };
  return evictOverflow(next, path, root);
}

function dropDirectory(state: TreeState, path: string): TreeState {
  const cache = new Map(state.cache);
  for (const cached of cache.keys()) {
    if (isInsideAgentSurfaceRoot(path, cached)) cache.delete(cached);
  }
  const retain = (values: ReadonlySet<string>) =>
    new Set([...values].filter((value) => !isInsideAgentSurfaceRoot(path, value)));
  return {
    ...state,
    cache,
    expanded: retain(state.expanded),
    loading: retain(state.loading),
    failed: retain(state.failed),
    truncated: retain(state.truncated),
  };
}

export function useAgentSurfaceFileTree(
  dependencies: AgentSurfaceFileTreeDependencies,
): AgentSurfaceFileTreeSurface {
  const { target, files, fileChanges } = dependencies;
  const targetKey = agentSurfaceTreeTargetKey(target);
  const rootPath = target?.rootPath ?? null;
  const owner = useMemo(() => ({ targetKey }), [targetKey]);
  const ownerRef = useRef(owner);
  const rootErrorMessage = agentSurfaceTreeRootError(target);
  const [state, setState] = useState<TreeState>(EMPTY_STATE);
  const generationRef = useRef(0);
  const stateRef = useRef(state);
  const filesRef = useRef(files);
  const requestsRef = useRef(new Map<string, { dirty: boolean }>());

  useLayoutEffect(() => {
    ownerRef.current = owner;
    stateRef.current = state;
    filesRef.current = files;
  });

  const readDirectory = useCallback(
    async (path: string): Promise<{ entries: FileEntry[]; truncated: boolean }> => {
      const gateway = filesRef.current;
      if (gateway.readDirectoryBounded !== undefined) {
        const result = await gateway.readDirectoryBounded(path, MAX_AGENT_SURFACE_TREE_ENTRIES);
        return { entries: orderAgentSurfaceEntries(result.entries), truncated: result.truncated };
      }
      const entries = await gateway.readDirectory(path);
      const truncated = entries.length > MAX_AGENT_SURFACE_TREE_ENTRIES;
      return {
        entries: orderAgentSurfaceEntries(entries.slice(0, MAX_AGENT_SURFACE_TREE_ENTRIES)),
        truncated,
      };
    },
    [],
  );

  const loadDirectory = useCallback(
    async (root: string, path: string): Promise<void> => {
      if (ownerRef.current !== owner) return;
      if (!isInsideAgentSurfaceRoot(root, path)) return;
      if (agentSurfaceTreeDepth(root, path) > MAX_AGENT_SURFACE_TREE_DEPTH) return;
      const requests = requestsRef.current;
      const pending = requests.get(path);
      if (pending !== undefined) {
        pending.dirty = true;
        return;
      }
      if (path !== root && requests.size >= MAX_AGENT_SURFACE_TREE_DIRECTORIES) return;
      const request = { dirty: false };
      requests.set(path, request);
      const generation = generationRef.current;
      const ownsRequest = () =>
        generation === generationRef.current && requests.get(path) === request;
      setState((current) => ({
        ...current,
        loading: withValue(current.loading, path),
        failed: withoutValue(current.failed, path),
      }));
      do {
        request.dirty = false;
        try {
          const result = await readDirectory(path);
          if (!ownsRequest()) return;
          if (request.dirty) continue;
          setState((current) => {
            if (generation !== generationRef.current) return current;
            return {
              ...storeDirectory(current, root, path, result.entries, result.truncated),
              rootError: path === root ? null : current.rootError,
            };
          });
        } catch {
          if (!ownsRequest()) return;
          if (request.dirty) continue;
          setState((current) => {
            if (generation !== generationRef.current) return current;
            return {
              ...dropDirectory(current, path),
              loading: withoutValue(current.loading, path),
              failed: withValue(current.failed, path),
              rootError: path === root ? rootErrorMessage : current.rootError,
            };
          });
        }
      } while (request.dirty && ownsRequest());
      requests.delete(path);
    },
    [owner, readDirectory, rootErrorMessage],
  );

  useLayoutEffect(() => {
    generationRef.current += 1;
    requestsRef.current = new Map();
    setState(EMPTY_STATE);
    if (rootPath === null) return;
    void loadDirectory(rootPath, rootPath);
    return () => {
      generationRef.current += 1;
    };
  }, [loadDirectory, rootPath, targetKey]);

  const refresh = useCallback((): void => {
    if (rootPath === null || ownerRef.current !== owner) return;
    const current = stateRef.current;
    for (const path of requestsRef.current.keys()) {
      if (path !== rootPath && !current.expanded.has(path)) requestsRef.current.delete(path);
    }
    setState((previous) => ({
      ...previous,
      cache: new Map(),
      truncated: new Set(),
      loading: new Set(requestsRef.current.keys()),
    }));
    void loadDirectory(rootPath, rootPath);
    for (const path of current.expanded) {
      void loadDirectory(rootPath, path);
    }
  }, [loadDirectory, owner, rootPath]);

  const toggleDirectory = useCallback(
    (path: string): void => {
      if (rootPath === null || ownerRef.current !== owner) return;
      if (!isInsideAgentSurfaceRoot(rootPath, path)) return;
      if (agentSurfaceTreeDepth(rootPath, path) > MAX_AGENT_SURFACE_TREE_DEPTH) return;
      const current = stateRef.current;
      if (current.expanded.has(path)) {
        setState((previous) => ({ ...previous, expanded: withoutValue(previous.expanded, path) }));
        return;
      }
      setState((previous) => ({ ...previous, expanded: withValue(previous.expanded, path) }));
      if (current.cache.has(path) || current.loading.has(path)) return;
      void loadDirectory(rootPath, path);
    },
    [loadDirectory, owner, rootPath],
  );

  const retryDirectory = useCallback(
    (path: string): void => {
      if (rootPath === null || ownerRef.current !== owner) return;
      void loadDirectory(rootPath, path);
    },
    [loadDirectory, owner, rootPath],
  );

  useEffect(() => {
    if (rootPath === null || fileChanges === null) return;
    const generation = generationRef.current;
    let unsubscribe: (() => void) | null = null;
    let disposed = false;
    const onEvent = (event: WorkspaceFileChangeEvent): void => {
      if (disposed || generation !== generationRef.current) return;
      if (!agentSurfaceChangeEventConcernsRoot(rootPath, event.rootPath)) return;
      if (event.kind === "rescanRequired") {
        refresh();
        return;
      }
      const touched = [event.path, event.previousPath ?? null]
        .filter((path): path is string => path !== null)
        .map(parentDirectory)
        .filter((directory) => isInsideAgentSurfaceRoot(rootPath, directory));
      for (const directory of new Set(touched)) {
        const current = stateRef.current;
        if (!current.cache.has(directory) && !requestsRef.current.has(directory)) continue;
        if (current.expanded.has(directory) || directory === rootPath) {
          void loadDirectory(rootPath, directory);
          continue;
        }
        setState((previous) => dropDirectory(previous, directory));
      }
    };
    void fileChanges.subscribeFileChanges(onEvent).then((release) => {
      if (disposed) {
        release();
        return;
      }
      unsubscribe = release;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [fileChanges, loadDirectory, refresh, rootPath, targetKey]);

  const entriesByDirectory = useMemo((): Record<string, FileEntry[]> => {
    const record: Record<string, FileEntry[]> = {};
    for (const [path, entries] of state.cache) record[path] = entries;
    return record;
  }, [state.cache]);

  const expandedDirectories = useMemo(() => new Set(state.expanded), [state.expanded]);
  const loadingDirectories = useMemo(() => new Set(state.loading), [state.loading]);

  return useMemo(
    () => ({
      rootPath,
      entriesByDirectory,
      expandedDirectories,
      loadingDirectories,
      failedDirectories: state.failed,
      truncatedDirectories: state.truncated,
      rootError: state.rootError,
      toggleDirectory,
      retryDirectory,
      refresh,
    }),
    [
      entriesByDirectory,
      expandedDirectories,
      loadingDirectories,
      refresh,
      retryDirectory,
      rootPath,
      state.failed,
      state.rootError,
      state.truncated,
      toggleDirectory,
    ],
  );
}
