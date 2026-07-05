import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Command, CommandContext } from "./commandRegistry";
import {
  measureLatency,
  type LatencyTracker,
} from "../domain/latencyTracker";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import {
  buildSearchEverywhereModel,
  type SearchEverywhereModel,
} from "../domain/searchEverywhere";
import type {
  FileSearchGateway,
  FileSearchResult,
} from "../domain/workspace";

export interface WorkbenchSearchEverywhereDependencies {
  canSearchClassOpenSymbols: boolean;
  fileSearch: FileSearchGateway;
  latencyTrackerForRoot: (rootPath: string) => LatencyTracker;
  reportError: (source: string, error: unknown) => void;
  searchClassOpenSymbols: (
    query: string,
    limit: number,
  ) => Promise<ProjectSymbolSearchResult[]>;
  workspaceRoot: string | null;
}

export interface WorkbenchSearchEverywhere {
  searchEverywhereOpen: boolean;
  searchEverywhereQuery: string;
  searchEverywhereLoading: boolean;
  setSearchEverywhereOpen: Dispatch<SetStateAction<boolean>>;
  setSearchEverywhereQuery: Dispatch<SetStateAction<string>>;
  resetSearchEverywhere: () => void;
  searchEverywhereModelFor: (
    commands: Command[],
    context: CommandContext,
  ) => SearchEverywhereModel;
}

export function useWorkbenchSearchEverywhere(
  dependencies: WorkbenchSearchEverywhereDependencies,
): WorkbenchSearchEverywhere {
  const {
    canSearchClassOpenSymbols,
    fileSearch,
    latencyTrackerForRoot,
    reportError,
    searchClassOpenSymbols,
    workspaceRoot,
  } = dependencies;

  const [searchEverywhereOpen, setSearchEverywhereOpen] = useState(false);
  const [searchEverywhereQuery, setSearchEverywhereQuery] = useState("");
  const [searchEverywhereLoading, setSearchEverywhereLoading] = useState(false);
  const [searchEverywhereFiles, setSearchEverywhereFiles] = useState<
    FileSearchResult[]
  >([]);
  const [searchEverywhereSymbols, setSearchEverywhereSymbols] = useState<
    ProjectSymbolSearchResult[]
  >([]);

  const resetSearchEverywhere = useCallback(() => {
    setSearchEverywhereOpen(false);
    setSearchEverywhereQuery("");
    setSearchEverywhereLoading(false);
    setSearchEverywhereFiles([]);
    setSearchEverywhereSymbols([]);
  }, []);

  const searchEverywhereModelFor = useCallback(
    (commands: Command[], context: CommandContext) =>
      buildSearchEverywhereModel({
        query: searchEverywhereQuery,
        files: searchEverywhereFiles,
        symbols: searchEverywhereSymbols,
        commands,
        context,
      }),
    [searchEverywhereFiles, searchEverywhereQuery, searchEverywhereSymbols],
  );

  // Search Everywhere unified file + symbol search. Reuses the exact same
  // gateways as Quick Open (files) and Go to Symbol (symbols) - this effect only
  // fans the one query out to both and stores the raw per-source results. The
  // command/action source needs no async search (the registry is already in
  // memory) so it is filtered synchronously in the render-time model.
  //
  // Isolation: the requested root is captured up front and the `active` flag
  // (reset by cleanup on any dependency change, including a workspace tab
  // switch) drops stale results so a slow search from a previous root can never
  // overwrite the current tab's results. `searchClassOpenSymbols` additionally
  // re-checks `currentWorkspaceRootRef` after its awaits.
  useEffect(() => {
    if (!searchEverywhereOpen || !workspaceRoot) {
      setSearchEverywhereFiles([]);
      setSearchEverywhereSymbols([]);
      setSearchEverywhereLoading(false);
      return;
    }

    const trimmedQuery = searchEverywhereQuery.trim();

    if (!trimmedQuery) {
      setSearchEverywhereFiles([]);
      setSearchEverywhereSymbols([]);
      setSearchEverywhereLoading(false);
      return;
    }

    const requestedRoot = workspaceRoot;
    let active = true;
    setSearchEverywhereLoading(true);

    const timeout = window.setTimeout(() => {
      const fileSearchPromise = measureLatency(
        latencyTrackerForRoot(requestedRoot),
        "searchEverywhere",
        () => fileSearch.searchFiles(requestedRoot, searchEverywhereQuery, 40),
      )
        .then((results) => {
          if (!active) {
            return;
          }

          setSearchEverywhereFiles(results);
        })
        .catch((error) => {
          if (!active) {
            return;
          }

          setSearchEverywhereFiles([]);
          reportError("Search Everywhere", error);
        });

      if (!canSearchClassOpenSymbols) {
        setSearchEverywhereSymbols([]);
      }

      const symbolSearchPromise = canSearchClassOpenSymbols
        ? searchClassOpenSymbols(searchEverywhereQuery, 40)
            .then((results) => {
              if (!active) {
                return;
              }

              setSearchEverywhereSymbols(results);
            })
            .catch((error) => {
              if (!active) {
                return;
              }

              setSearchEverywhereSymbols([]);
              reportError("Search Everywhere", error);
            })
        : Promise.resolve();

      void Promise.all([fileSearchPromise, symbolSearchPromise]).finally(() => {
        if (!active) {
          return;
        }

        setSearchEverywhereLoading(false);
      });
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    canSearchClassOpenSymbols,
    fileSearch,
    latencyTrackerForRoot,
    reportError,
    searchClassOpenSymbols,
    searchEverywhereOpen,
    searchEverywhereQuery,
    workspaceRoot,
  ]);

  return {
    searchEverywhereOpen,
    searchEverywhereQuery,
    searchEverywhereLoading,
    setSearchEverywhereOpen,
    setSearchEverywhereQuery,
    resetSearchEverywhere,
    searchEverywhereModelFor,
  };
}
