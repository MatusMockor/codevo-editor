import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import { measureLatency, type LatencyTracker } from "../../domain/latencyTracker";
import type { FileEntry, WorkspaceFileGateway } from "../../domain/workspace";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { BoundedInFlightDirectoryLoads } from "./boundedInFlightDirectoryLoads";
import {
  useWorkspaceDirectoryLoader,
  type LoadWorkspaceDirectoryOptions,
} from "./useWorkspaceDirectoryLoader";

const MAX_CACHED_EXPANDED_DIRECTORIES_TO_REFRESH = 16;

interface WorkspaceDirectoryExplorerOptions {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly entriesByDirectory: Readonly<Record<string, readonly FileEntry[]>>;
  readonly expandedDirectories: ReadonlySet<string>;
  readonly inFlightLoadsRef: MutableRefObject<BoundedInFlightDirectoryLoads>;
  readonly latencyTrackerForRoot: (rootPath: string) => LatencyTracker;
  readonly openWorkspaceRequestTokenRef: MutableRefObject<number>;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setEntriesByDirectory: Dispatch<SetStateAction<Record<string, FileEntry[]>>>;
  readonly setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>;
  readonly setLoadingDirectories: Dispatch<SetStateAction<Set<string>>>;
  readonly setManuallyCollapsedDirectories: Dispatch<SetStateAction<Set<string>>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly workspaceRoot: string | null;
  readonly workspaceFiles: WorkspaceFileGateway;
}

interface CachedDirectoryProjection {
  readonly entriesByDirectory: Record<string, FileEntry[]>;
  readonly expandedDirectories: ReadonlySet<string>;
}

interface RefreshCachedDirectoriesRequest {
  readonly isMutationOwnerCurrent: () => boolean;
  readonly projection: CachedDirectoryProjection;
  readonly rootPath: string;
}

export function useWorkspaceDirectoryExplorer({
  currentWorkspaceRootRef,
  entriesByDirectory,
  expandedDirectories,
  inFlightLoadsRef,
  latencyTrackerForRoot,
  openWorkspaceRequestTokenRef,
  reportError,
  setEntriesByDirectory,
  setExpandedDirectories,
  setLoadingDirectories,
  setManuallyCollapsedDirectories,
  setMessage,
  workspaceRoot,
  workspaceFiles,
}: WorkspaceDirectoryExplorerOptions) {
  const [failedDirectories, setFailedDirectories] = useState(new Set<string>());
  const staleCachedDirectoriesRef = useRef(new Set<string>());
  const requestDirectory = useWorkspaceDirectoryLoader({
    currentWorkspaceRootRef,
    inFlightLoadsRef,
    openWorkspaceRequestTokenRef,
    reportError,
    setEntriesByDirectory,
    setFailedDirectories,
    setLoadingDirectories,
    setMessage,
    workspaceFiles,
  });

  const loadDirectory = useCallback(
    async (path: string, options?: LoadWorkspaceDirectoryOptions) => {
      const result = await requestDirectory(path, options);
      if (result) {
        staleCachedDirectoriesRef.current.delete(path);
      }
      return result;
    },
    [requestDirectory],
  );

  const retryDirectory = useCallback(
    (path: string) => {
      void loadDirectory(path, { clearMessage: false });
    },
    [loadDirectory],
  );

  const resetDirectoryExplorerLifecycle = useCallback(() => {
    setFailedDirectories(new Set());
    staleCachedDirectoriesRef.current.clear();
  }, []);

  const adoptCachedDirectoryProjection = useCallback(
    (rootPath: string, projection: CachedDirectoryProjection) => {
      staleCachedDirectoriesRef.current = new Set(
        Object.keys(projection.entriesByDirectory).filter(
          (directoryPath) => !workspaceRootKeysEqual(directoryPath, rootPath),
        ),
      );
      setFailedDirectories(new Set());
    },
    [],
  );

  const primeCachedDirectoryEntries = useCallback(
    (projection: CachedDirectoryProjection | null, replacingOwnerAtSameRoot: boolean) => {
      if (!projection || replacingOwnerAtSameRoot) {
        return;
      }
      flushSync(() => {
        setEntriesByDirectory((current) => ({
          ...current,
          ...projection.entriesByDirectory,
        }));
      });
    },
    [setEntriesByDirectory],
  );

  const cachedDirectoryNeedsRefresh = useCallback(
    (path: string) => staleCachedDirectoriesRef.current.has(path),
    [],
  );

  const toggleDirectory = useCallback(
    async (path: string) => {
      const isExpanded = expandedDirectories.has(path);
      setExpandedDirectories((current) => {
        const next = new Set(current);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
      setManuallyCollapsedDirectories((current) => {
        const next = new Set(current);
        if (isExpanded) {
          next.add(path);
        } else {
          next.delete(path);
        }
        return next;
      });

      if (isExpanded || (entriesByDirectory[path] && !cachedDirectoryNeedsRefresh(path))) {
        return;
      }
      if (!workspaceRoot) {
        await loadDirectory(path);
        return;
      }
      await measureLatency(latencyTrackerForRoot(workspaceRoot), "folderExpand", () =>
        loadDirectory(path),
      );
    },
    [
      cachedDirectoryNeedsRefresh,
      entriesByDirectory,
      expandedDirectories,
      latencyTrackerForRoot,
      loadDirectory,
      setExpandedDirectories,
      setManuallyCollapsedDirectories,
      workspaceRoot,
    ],
  );

  const refreshCachedExpandedDirectories = useCallback(
    ({ isMutationOwnerCurrent, projection, rootPath }: RefreshCachedDirectoriesRequest) => {
      const directories = [...projection.expandedDirectories]
        .filter(
          (directoryPath) =>
            !workspaceRootKeysEqual(directoryPath, rootPath) &&
            staleCachedDirectoriesRef.current.has(directoryPath),
        )
        .slice(0, MAX_CACHED_EXPANDED_DIRECTORIES_TO_REFRESH);

      void (async () => {
        for (const directoryPath of directories) {
          if (!isMutationOwnerCurrent()) {
            return;
          }
          await loadDirectory(directoryPath, {
            clearMessage: false,
            isMutationOwnerCurrent,
          });
        }
      })();
    },
    [loadDirectory],
  );

  return {
    adoptCachedDirectoryProjection,
    cachedDirectoryNeedsRefresh,
    failedDirectories,
    loadDirectory,
    primeCachedDirectoryEntries,
    refreshCachedExpandedDirectories,
    resetDirectoryExplorerLifecycle,
    retryDirectory,
    toggleDirectory,
  };
}
