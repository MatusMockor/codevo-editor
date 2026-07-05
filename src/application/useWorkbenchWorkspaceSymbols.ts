import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";

export interface WorkbenchWorkspaceSymbolsDependencies {
  workspaceRoot: string | null;
  canSearchClassOpenSymbols: boolean;
  searchClassOpenSymbols: (
    query: string,
    limit: number,
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
  setWorkspaceSymbolsResults: Dispatch<
    SetStateAction<ProjectSymbolSearchResult[]>
  >;
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
  } = dependencies;

  const [workspaceSymbolsOpen, setWorkspaceSymbolsOpen] = useState(false);
  const [workspaceSymbolsQuery, setWorkspaceSymbolsQuery] = useState("");
  const [workspaceSymbolsLoading, setWorkspaceSymbolsLoading] = useState(false);
  const [workspaceSymbolsResults, setWorkspaceSymbolsResults] = useState<
    ProjectSymbolSearchResult[]
  >([]);

  useEffect(() => {
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
    setWorkspaceSymbolsLoading(true);

    const timeout = window.setTimeout(() => {
      searchClassOpenSymbols(workspaceSymbolsQuery, 120)
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
      window.clearTimeout(timeout);
    };
  }, [
    canSearchClassOpenSymbols,
    reportError,
    searchClassOpenSymbols,
    setMessage,
    workspaceRoot,
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
