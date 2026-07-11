import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  measureLatency,
  type LatencyTracker,
} from "../domain/latencyTracker";
import type { RecentFileEntry } from "../domain/recentFiles";
import {
  mergeQuickOpenResults,
  QUICK_OPEN_RESULT_LIMIT,
} from "../domain/quickOpenRanking";
import type {
  FileSearchGateway,
  FileSearchResult,
} from "../domain/workspace";
import { workspaceRelativePath } from "../domain/workspace";

export interface WorkbenchQuickOpenDependencies {
  activePath: string | null;
  fileSearch: FileSearchGateway;
  latencyTrackerForRoot: (rootPath: string) => LatencyTracker;
  reportError: (source: string, error: unknown) => void;
  recentFiles: readonly RecentFileEntry[];
  setMessage: Dispatch<SetStateAction<string | null>>;
  workspaceRoot: string | null;
}

export interface WorkbenchQuickOpen {
  quickOpenOpen: boolean;
  quickOpenQuery: string;
  quickOpenLoading: boolean;
  quickOpenResults: FileSearchResult[];
  setQuickOpenOpen: (isOpen: boolean) => void;
  setQuickOpenQuery: Dispatch<SetStateAction<string>>;
}

export function useWorkbenchQuickOpen(
  dependencies: WorkbenchQuickOpenDependencies,
): WorkbenchQuickOpen {
  const {
    activePath,
    fileSearch,
    latencyTrackerForRoot,
    reportError,
    recentFiles,
    setMessage,
    workspaceRoot,
  } = dependencies;

  const [quickOpenOpen, setQuickOpenOpenState] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);
  const [backendResultSet, setBackendResultSet] = useState<{
    query: string;
    results: FileSearchResult[];
    rootPath: string | null;
  }>({ query: "", results: [], rootPath: null });

  const quickOpenResults = useMemo(() => {
    if (!quickOpenOpen || !workspaceRoot) {
      return [];
    }

    const recentResults = recentFiles.flatMap((entry) => {
      if (entry.path === activePath) {
        return [];
      }

      const relativePath = workspaceRelativePath(workspaceRoot, entry.path);
      if (!relativePath) {
        return [];
      }

      return [{ ...entry, relativePath }];
    });
    const backendResults =
      backendResultSet.rootPath === workspaceRoot &&
      backendResultSet.query === quickOpenQuery
        ? backendResultSet.results.filter(
            (entry) => quickOpenQuery.trim() !== "" || entry.path !== activePath,
          )
        : [];

    return mergeQuickOpenResults(recentResults, backendResults, quickOpenQuery);
  }, [
    activePath,
    backendResultSet,
    quickOpenOpen,
    quickOpenQuery,
    recentFiles,
    workspaceRoot,
  ]);

  const setQuickOpenOpen = useCallback(
    (isOpen: boolean) => {
      setQuickOpenQuery("");
      setBackendResultSet({ query: "", results: [], rootPath: null });
      setQuickOpenLoading(false);
      setQuickOpenOpenState(isOpen);

      if (!isOpen) {
        setMessage(null);
      }
    },
    [setMessage],
  );

  useEffect(() => {
    if (!quickOpenOpen || !workspaceRoot) {
      setBackendResultSet({ query: "", results: [], rootPath: null });
      setQuickOpenLoading(false);
      return;
    }

    let active = true;
    setQuickOpenLoading(true);

    const timeout = window.setTimeout(() => {
      measureLatency(latencyTrackerForRoot(workspaceRoot), "quickOpen", () =>
        fileSearch.searchFiles(
          workspaceRoot,
          quickOpenQuery,
          QUICK_OPEN_RESULT_LIMIT,
        ),
      )
        .then((results) => {
          if (!active) {
            return;
          }

          setBackendResultSet({
            query: quickOpenQuery,
            results,
            rootPath: workspaceRoot,
          });
          setMessage(null);
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          setBackendResultSet({
            query: quickOpenQuery,
            results: [],
            rootPath: workspaceRoot,
          });
          reportError("Quick Open", error);
        })
        .finally(() => {
          if (!active) {
            return;
          }

          setQuickOpenLoading(false);
        });
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    fileSearch,
    latencyTrackerForRoot,
    quickOpenOpen,
    quickOpenQuery,
    reportError,
    setMessage,
    workspaceRoot,
  ]);

  return {
    quickOpenOpen,
    quickOpenQuery,
    quickOpenLoading,
    quickOpenResults,
    setQuickOpenOpen,
    setQuickOpenQuery,
  };
}
