import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";

export interface WorkbenchWorkspaceSymbolsDependencies {
  workspaceRoot: string | null;
  workspaceOwner: WorkspaceRuntimeOwner | null;
  canSearchClassOpenSymbols: boolean;
  searchClassOpenSymbols: (
    query: string,
    limit: number,
    signal?: AbortSignal,
  ) => Promise<ProjectSymbolSearchResult[]>;
  reportError: (source: string, error: unknown) => void;
  setMessage: Dispatch<SetStateAction<string | null>>;
}

export interface WorkbenchWorkspaceSymbols {
  workspaceSymbolsOpen: boolean;
  workspaceSymbolsQuery: string;
  workspaceSymbolsLoading: boolean;
  workspaceSymbolsResults: ProjectSymbolSearchResult[];
  setWorkspaceSymbolsOpen: Dispatch<SetStateAction<boolean>>;
  setWorkspaceSymbolsQuery: Dispatch<SetStateAction<string>>;
  setWorkspaceSymbolsLoading: Dispatch<SetStateAction<boolean>>;
  setWorkspaceSymbolsResults: Dispatch<SetStateAction<ProjectSymbolSearchResult[]>>;
}

export function useWorkbenchWorkspaceSymbols(
  dependencies: WorkbenchWorkspaceSymbolsDependencies,
): WorkbenchWorkspaceSymbols {
  const {
    workspaceRoot,
    canSearchClassOpenSymbols,
    searchClassOpenSymbols,
    reportError,
    setMessage,
    workspaceOwner,
  } = dependencies;

  const [workspaceSymbolsOpen, setWorkspaceSymbolsOpenState] = useState(false);
  const [workspaceSymbolsQuery, setWorkspaceSymbolsQuery] = useState("");
  const [workspaceSymbolsLoading, setWorkspaceSymbolsLoading] = useState(false);
  const surfaceGenerationRef = useRef(0);
  const [resultSnapshot, setResultSnapshot] = useState<{
    generation: number;
    owner: WorkspaceRuntimeOwner | null;
    query: string;
    results: ProjectSymbolSearchResult[];
    root: string | null;
  } | null>(null);
  const setWorkspaceSymbolsOpen = useCallback<Dispatch<SetStateAction<boolean>>>((next) => {
    setWorkspaceSymbolsOpenState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      if (resolved !== current) surfaceGenerationRef.current += 1;
      return resolved;
    });
  }, []);
  const setWorkspaceSymbolsResults = useCallback<
    Dispatch<SetStateAction<ProjectSymbolSearchResult[]>>
  >(
    (next) => {
      setResultSnapshot((current) => {
        const currentResults =
          current?.generation === surfaceGenerationRef.current &&
          current.owner === workspaceOwner &&
          current.query === workspaceSymbolsQuery &&
          current.root === workspaceRoot
            ? current.results
            : [];
        return {
          generation: surfaceGenerationRef.current,
          owner: workspaceOwner,
          query: workspaceSymbolsQuery,
          results: typeof next === "function" ? next(currentResults) : next,
          root: workspaceRoot,
        };
      });
    },
    [workspaceOwner, workspaceRoot, workspaceSymbolsQuery],
  );
  const workspaceSymbolsResults =
    workspaceSymbolsOpen &&
    resultSnapshot?.generation === surfaceGenerationRef.current &&
    resultSnapshot.owner === workspaceOwner &&
    resultSnapshot.query === workspaceSymbolsQuery &&
    resultSnapshot.root === workspaceRoot
      ? resultSnapshot.results
      : [];

  useLayoutEffect(() => {
    if (
      !workspaceSymbolsOpen ||
      !workspaceRoot ||
      !workspaceSymbolsQuery.trim() ||
      !canSearchClassOpenSymbols
    ) {
      setWorkspaceSymbolsResults([]);
      setWorkspaceSymbolsLoading(false);
      return;
    }

    let active = true;
    const abort = new AbortController();
    setWorkspaceSymbolsResults([]);
    setWorkspaceSymbolsLoading(true);

    const timeout = window.setTimeout(() => {
      searchClassOpenSymbols(workspaceSymbolsQuery, 120, abort.signal)
        .then((results) => {
          if (!active) {
            return;
          }

          setWorkspaceSymbolsResults(results.slice(0, 80));
          setMessage(null);
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          setWorkspaceSymbolsResults([]);
          reportError("Go to Symbol in Workspace", error);
        })
        .finally(() => {
          if (!active) {
            return;
          }

          setWorkspaceSymbolsLoading(false);
        });
    }, 120);

    return () => {
      active = false;
      abort.abort();
      window.clearTimeout(timeout);
    };
  }, [
    canSearchClassOpenSymbols,
    reportError,
    searchClassOpenSymbols,
    setMessage,
    setWorkspaceSymbolsResults,
    workspaceRoot,
    workspaceOwner,
    workspaceSymbolsOpen,
    workspaceSymbolsQuery,
  ]);

  return {
    workspaceSymbolsOpen,
    workspaceSymbolsQuery,
    workspaceSymbolsLoading,
    workspaceSymbolsResults,
    setWorkspaceSymbolsOpen,
    setWorkspaceSymbolsQuery,
    setWorkspaceSymbolsLoading,
    setWorkspaceSymbolsResults,
  };
}
