import { useEffect, useMemo, useRef, useState } from "react";
import type { FileSearchGateway, FileSearchResult } from "../../domain/workspace";

export const FILES_SEARCH_DEBOUNCE_MS = 150;
export const MAX_FILES_SEARCH_RESULTS = 200;

export type AgentFilesSearchStatus = "idle" | "searching" | "ready" | "failed";

export interface AgentFilesSearch {
  readonly status: AgentFilesSearchStatus;
  readonly results: ReadonlyArray<FileSearchResult>;
  readonly truncated: boolean;
  readonly message: string | null;
}

export interface UseAgentFilesSearchOptions {
  readonly gateway: FileSearchGateway | null;
  readonly root: string | null;
  readonly query: string;
}

interface OwnedSearch {
  readonly root: string | null;
  readonly search: AgentFilesSearch;
}

const EMPTY_RESULTS: ReadonlyArray<FileSearchResult> = Object.freeze([]);
const IDLE: AgentFilesSearch = Object.freeze({
  status: "idle",
  results: EMPTY_RESULTS,
  truncated: false,
  message: null,
});
const SEARCHING: AgentFilesSearch = Object.freeze({ ...IDLE, status: "searching" });
const FALLBACK_FAILURE = "File search is unavailable.";

export function useAgentFilesSearch({
  gateway,
  query,
  root,
}: UseAgentFilesSearchOptions): AgentFilesSearch {
  const trimmedQuery = query.trim();
  const enabled = gateway !== null && root !== null && trimmedQuery !== "";
  const [state, setState] = useState<OwnedSearch>({ root: null, search: IDLE });
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    if (gateway === null || root === null || trimmedQuery === "") {
      setState({ root, search: IDLE });
      return;
    }
    setState((previous) => ({ root, search: searchingFrom(previous, root) }));
    const isCurrent = () => generation.current === current;
    const timer = setTimeout(() => {
      gateway.searchFiles(root, trimmedQuery, MAX_FILES_SEARCH_RESULTS + 1).then(
        (found) => {
          if (!isCurrent()) return;
          setState({ root, search: readySearch(found) });
        },
        (error: unknown) => {
          if (!isCurrent()) return;
          setState({ root, search: failedSearch(error) });
        },
      );
    }, FILES_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
  }, [gateway, root, trimmedQuery]);

  return useMemo(() => {
    if (!enabled) return IDLE;
    if (state.root !== root) return SEARCHING;
    return state.search;
  }, [enabled, root, state]);
}

function searchingFrom(previous: OwnedSearch, root: string): AgentFilesSearch {
  if (previous.root !== root) return SEARCHING;
  return { ...previous.search, status: "searching", message: null };
}

function readySearch(found: ReadonlyArray<FileSearchResult>): AgentFilesSearch {
  return {
    status: "ready",
    results: found.slice(0, MAX_FILES_SEARCH_RESULTS),
    truncated: found.length > MAX_FILES_SEARCH_RESULTS,
    message: null,
  };
}

function failedSearch(error: unknown): AgentFilesSearch {
  return {
    status: "failed",
    results: EMPTY_RESULTS,
    truncated: false,
    message: error instanceof Error && error.message !== "" ? error.message : FALLBACK_FAILURE,
  };
}
