import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  measureLatency,
  type LatencyTracker,
} from "../domain/latencyTracker";
import type {
  FileSearchGateway,
  FileSearchResult,
} from "../domain/workspace";

export interface WorkbenchQuickOpenDependencies {
  fileSearch: FileSearchGateway;
  latencyTrackerForRoot: (rootPath: string) => LatencyTracker;
  reportError: (source: string, error: unknown) => void;
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
    fileSearch,
    latencyTrackerForRoot,
    reportError,
    setMessage,
    workspaceRoot,
  } = dependencies;

  const [quickOpenOpen, setQuickOpenOpenState] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);
  const [quickOpenResults, setQuickOpenResults] = useState<FileSearchResult[]>(
    [],
  );

  const setQuickOpenOpen = useCallback((isOpen: boolean) => {
    setQuickOpenQuery("");
    setQuickOpenResults([]);
    setQuickOpenLoading(false);
    setQuickOpenOpenState(isOpen);
  }, []);

  useEffect(() => {
    if (!quickOpenOpen || !workspaceRoot) {
      setQuickOpenResults([]);
      setQuickOpenLoading(false);
      return;
    }

    let active = true;
    setQuickOpenLoading(true);

    const timeout = window.setTimeout(() => {
      measureLatency(latencyTrackerForRoot(workspaceRoot), "quickOpen", () =>
        fileSearch.searchFiles(workspaceRoot, quickOpenQuery, 80),
      )
        .then((results) => {
          if (!active) {
            return;
          }

          setQuickOpenResults(results);
          setMessage(null);
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          setQuickOpenResults([]);
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
