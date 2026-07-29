import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { measureLatency, type LatencyTracker } from "../domain/latencyTracker";
import type { RecentFileEntry } from "../domain/recentFiles";
import { parseQuickOpenQuery, type QuickOpenQuery } from "../domain/quickOpenQuery";
import { mergeQuickOpenResults, QUICK_OPEN_RESULT_LIMIT } from "../domain/quickOpenRanking";
import type { FileSearchGateway, FileSearchResponse, FileSearchResult } from "../domain/workspace";
import { workspaceRelativePath } from "../domain/workspace";

export interface WorkbenchQuickOpenDependencies {
  activePath: string | null;
  fileSearch: FileSearchGateway;
  latencyTrackerForRoot: (rootPath: string) => LatencyTracker;
  reportError: (source: string, error: unknown) => void;
  recentFiles: readonly RecentFileEntry[];
  setMessage: Dispatch<SetStateAction<string | null>>;
  workspaceRoot: string | null;
  openCommands?: (query: string) => void;
  openCurrentFileSymbols?: (query: string) => void;
  openWorkspaceSymbols?: (query: string) => void;
}

export interface WorkbenchQuickOpen {
  quickOpenOpen: boolean;
  quickOpenQuery: string;
  quickOpenLoading: boolean;
  quickOpenRequest: QuickOpenQuery;
  quickOpenResults: FileSearchResult[];
  quickOpenTruncated: boolean;
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
    openCommands,
    openCurrentFileSymbols,
    openWorkspaceSymbols,
  } = dependencies;

  const [quickOpenOpen, setQuickOpenOpenState] = useState(false);
  const [quickOpenQuery, setQuickOpenQueryState] = useState("");
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);
  const [backendResultSet, setBackendResultSet] = useState<{
    generation: number;
    query: string;
    response: FileSearchResponse;
    rootPath: string | null;
  }>({
    generation: 0,
    query: "",
    response: { requestGeneration: "", results: [], truncated: false },
    rootPath: null,
  });
  const quickOpenRequest = useMemo(() => parseQuickOpenQuery(quickOpenQuery), [quickOpenQuery]);
  const fileQuery = fileQueryForRequest(quickOpenRequest);
  const requestOwnerRef = useRef({ criteria: "", generation: 0 });
  const requestCriteria = JSON.stringify([quickOpenOpen, workspaceRoot, quickOpenQuery, fileQuery]);
  if (requestOwnerRef.current.criteria !== requestCriteria) {
    requestOwnerRef.current = {
      criteria: requestCriteria,
      generation: requestOwnerRef.current.generation + 1,
    };
  }
  const activeGeneration = requestOwnerRef.current.generation;
  const queryRef = useRef(quickOpenQuery);
  queryRef.current = quickOpenQuery;
  const invalidateRequestOwner = useCallback(() => {
    requestOwnerRef.current = {
      criteria: requestOwnerRef.current.criteria,
      generation: requestOwnerRef.current.generation + 1,
    };
  }, []);
  const setQuickOpenQuery = useCallback<Dispatch<SetStateAction<string>>>(
    (update) => {
      const current = queryRef.current;
      const next = typeof update === "function" ? update(current) : update;
      if (next !== current) {
        invalidateRequestOwner();
        queryRef.current = next;
      }
      setQuickOpenQueryState(next);
    },
    [invalidateRequestOwner],
  );

  const quickOpenResults = useMemo(() => {
    if (!quickOpenOpen || !workspaceRoot || fileQuery === null) {
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
      backendResultSet.generation === activeGeneration &&
      backendResultSet.rootPath === workspaceRoot &&
      backendResultSet.query === quickOpenQuery
        ? backendResultSet.response.results.filter(
            (entry) => quickOpenQuery.trim() !== "" || entry.path !== activePath,
          )
        : [];

    return mergeQuickOpenResults(recentResults, backendResults, fileQuery);
  }, [
    activePath,
    activeGeneration,
    backendResultSet,
    quickOpenOpen,
    quickOpenQuery,
    recentFiles,
    workspaceRoot,
    fileQuery,
  ]);
  const quickOpenTruncated =
    backendResultSet.generation === activeGeneration &&
    backendResultSet.rootPath === workspaceRoot &&
    backendResultSet.query === quickOpenQuery &&
    backendResultSet.response.truncated;

  const setQuickOpenOpen = useCallback(
    (isOpen: boolean) => {
      invalidateRequestOwner();
      queryRef.current = "";
      setQuickOpenQueryState("");
      setBackendResultSet({
        generation: 0,
        query: "",
        response: { requestGeneration: "", results: [], truncated: false },
        rootPath: null,
      });
      setQuickOpenLoading(false);
      setQuickOpenOpenState(isOpen);

      if (!isOpen) {
        setMessage(null);
      }
    },
    [invalidateRequestOwner, setMessage],
  );

  useEffect(() => {
    if (!quickOpenOpen) {
      return;
    }

    if (quickOpenRequest.kind === "currentFileSymbols" && openCurrentFileSymbols) {
      setQuickOpenOpen(false);
      openCurrentFileSymbols(quickOpenRequest.query);
      return;
    }

    if (quickOpenRequest.kind === "workspaceSymbols" && openWorkspaceSymbols) {
      setQuickOpenOpen(false);
      openWorkspaceSymbols(quickOpenRequest.query);
      return;
    }

    if (quickOpenRequest.kind === "commands" && openCommands) {
      setQuickOpenOpen(false);
      openCommands(quickOpenRequest.query);
      return;
    }
  }, [
    openCommands,
    openCurrentFileSymbols,
    openWorkspaceSymbols,
    quickOpenOpen,
    quickOpenRequest,
    setQuickOpenOpen,
  ]);

  useEffect(() => {
    if (!quickOpenOpen || !workspaceRoot || fileQuery === null) {
      setBackendResultSet({
        generation: 0,
        query: "",
        response: { requestGeneration: "", results: [], truncated: false },
        rootPath: null,
      });
      setQuickOpenLoading(false);
      return;
    }

    let active = true;
    const requestedGeneration = activeGeneration;
    const requestGeneration = `quick-open-${requestedGeneration}`;
    setQuickOpenLoading(true);

    const timeout = window.setTimeout(() => {
      measureLatency(latencyTrackerForRoot(workspaceRoot), "quickOpen", () =>
        searchFilesWithMetadata(
          fileSearch,
          workspaceRoot,
          fileQuery,
          QUICK_OPEN_RESULT_LIMIT,
          requestGeneration,
        ),
      )
        .then((response) => {
          if (!active || requestOwnerRef.current.generation !== requestedGeneration) {
            return;
          }
          if (response.requestGeneration !== requestGeneration) {
            throw new Error("File search returned a mismatched request generation.");
          }

          setBackendResultSet({
            generation: requestedGeneration,
            query: quickOpenQuery,
            response,
            rootPath: workspaceRoot,
          });
          setMessage(null);
        })
        .catch((error) => {
          if (!active || requestOwnerRef.current.generation !== requestedGeneration) {
            return;
          }

          setBackendResultSet({
            generation: requestedGeneration,
            query: quickOpenQuery,
            response: { requestGeneration, results: [], truncated: false },
            rootPath: workspaceRoot,
          });
          reportError("Quick Open", error);
        })
        .finally(() => {
          if (!active || requestOwnerRef.current.generation !== requestedGeneration) {
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
    fileQuery,
    activeGeneration,
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
    quickOpenRequest,
    quickOpenResults,
    quickOpenTruncated,
    setQuickOpenOpen,
    setQuickOpenQuery,
  };
}

function searchFilesWithMetadata(
  fileSearch: FileSearchGateway,
  root: string,
  query: string,
  limit: number,
  requestGeneration: string,
): Promise<FileSearchResponse> {
  if (fileSearch.searchFilesWithMetadata) {
    return fileSearch.searchFilesWithMetadata(root, query, limit, requestGeneration);
  }

  return fileSearch.searchFiles(root, query, limit).then((results) => ({
    requestGeneration,
    results,
    truncated: false,
  }));
}

function fileQueryForRequest(request: QuickOpenQuery): string | null {
  if (request.kind === "files") {
    return request.query;
  }

  if (request.kind === "fileLocation") {
    return request.pathQuery;
  }

  return null;
}
