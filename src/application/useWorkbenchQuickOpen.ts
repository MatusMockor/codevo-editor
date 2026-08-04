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

export const QUICK_OPEN_SEARCH_TIMEOUT_MS = 5_000;

interface QuickOpenDispatchRequest {
  generation: number;
  isEmptyWarmup: boolean;
  run: () => void;
}

interface QuickOpenDispatchSlot {
  active: Map<() => void, QuickOpenDispatchRequest>;
  pending: QuickOpenDispatchRequest | null;
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
  const dispatchSlotRef = useRef<QuickOpenDispatchSlot>({ active: new Map(), pending: null });
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
    const slot = dispatchSlotRef.current;

    if (!quickOpenOpen || !workspaceRoot || fileQuery === null) {
      slot.pending = null;
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
    let abandoned = false;
    const requestedGeneration = activeGeneration;
    const requestGeneration = `quick-open-${requestedGeneration}`;
    const ownsResult = () =>
      active && !abandoned && requestOwnerRef.current.generation === requestedGeneration;
    setQuickOpenLoading(true);

    const run = () => {
      const abandonRequest = () => {
        const owned = ownsResult();
        abandoned = true;

        if (releaseQuickOpenSlot(slot, run, requestOwnerRef.current.generation) || !owned) {
          return;
        }

        setBackendResultSet({
          generation: requestedGeneration,
          query: quickOpenQuery,
          response: { requestGeneration, results: [], truncated: false },
          rootPath: workspaceRoot,
        });
        setQuickOpenLoading(false);
        reportError("Quick Open", new Error("File search timed out."));
      };
      const watchdog = window.setTimeout(abandonRequest, QUICK_OPEN_SEARCH_TIMEOUT_MS);

      measureLatency(latencyTrackerForRoot(workspaceRoot), "quickOpen", async () => {
        const engineStartedAt = performance.now();
        const response = await searchFilesWithMetadata(
          fileSearch,
          workspaceRoot,
          fileQuery,
          QUICK_OPEN_RESULT_LIMIT,
          requestGeneration,
        );
        window.__codevoPerfProbe?.record("fileSearchEngine", {
          ms: performance.now() - engineStartedAt,
          resultCount: response.results.length,
          target: fileQuery,
        });
        return response;
      })
        .then((response) => {
          if (!ownsResult()) {
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
          if (!ownsResult()) {
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
          if (abandoned) {
            return;
          }

          window.clearTimeout(watchdog);

          if (ownsResult()) {
            setQuickOpenLoading(false);
          }

          releaseQuickOpenSlot(slot, run, requestOwnerRef.current.generation);
        });
    };

    submitQuickOpenRequest(slot, {
      generation: requestedGeneration,
      isEmptyWarmup: fileQuery === "",
      run,
    });

    return () => {
      active = false;
      discardQuickOpenRequest(slot, run);
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

function submitQuickOpenRequest(
  slot: QuickOpenDispatchSlot,
  request: QuickOpenDispatchRequest,
): void {
  if (!canDispatchQuickOpenRequest(slot, request)) {
    slot.pending = request;
    return;
  }

  startQuickOpenRequest(slot, request);
}

function canDispatchQuickOpenRequest(
  slot: QuickOpenDispatchSlot,
  request: QuickOpenDispatchRequest,
): boolean {
  if (request.isEmptyWarmup) {
    return slot.active.size === 0;
  }

  return !Array.from(slot.active.values()).some((active) => !active.isEmptyWarmup);
}

function startQuickOpenRequest(
  slot: QuickOpenDispatchSlot,
  request: QuickOpenDispatchRequest,
): void {
  slot.active.set(request.run, request);
  request.run();
}

function discardQuickOpenRequest(slot: QuickOpenDispatchSlot, run: () => void): void {
  if (slot.pending?.run !== run) {
    return;
  }

  slot.pending = null;
}

function releaseQuickOpenSlot(
  slot: QuickOpenDispatchSlot,
  run: () => void,
  currentGeneration: number,
): boolean {
  slot.active.delete(run);
  const pending = slot.pending;

  if (!pending || pending.generation !== currentGeneration) {
    slot.pending = null;
    return false;
  }

  if (!canDispatchQuickOpenRequest(slot, pending)) {
    return false;
  }

  slot.pending = null;
  startQuickOpenRequest(slot, pending);
  return true;
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
