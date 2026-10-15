import { useEffect, useMemo, useRef, useState } from "react";
import { parseQuickOpenQuery, type QuickOpenQuery } from "../../domain/quickOpenQuery";
import type { FileSearchGateway, FileSearchResult } from "../../domain/workspace";

export const AGENT_PALETTE_FILE_LIMIT = 100;
export const AGENT_PALETTE_FILE_DEBOUNCE_MS = 80;

export interface AgentPaletteFilesOptions {
  readonly active: boolean;
  readonly fileSearch: FileSearchGateway;
  readonly workspaceRoot: string | null;
}

interface FileSearchState {
  readonly key: string;
  readonly loading: boolean;
  readonly results: FileSearchResult[];
  readonly truncated: boolean;
}

const EMPTY_RESULTS: FileSearchResult[] = [];
const IDLE: FileSearchState = { key: "", loading: false, results: EMPTY_RESULTS, truncated: false };

export function useAgentPaletteFiles({
  active,
  fileSearch,
  workspaceRoot,
}: AgentPaletteFilesOptions) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<FileSearchState>(IDLE);
  const generationRef = useRef(0);
  const request = useMemo(() => parseQuickOpenQuery(query), [query]);
  const text = searchTextFor(request);
  const key = JSON.stringify([workspaceRoot, text]);

  useEffect(() => {
    if (active) return;
    setQuery("");
  }, [active]);

  useEffect(() => {
    setQuery("");
  }, [workspaceRoot]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    if (!active || workspaceRoot === null || text === "") return undefined;
    const root = workspaceRoot;
    setState({ key, loading: true, results: EMPTY_RESULTS, truncated: false });
    const timer = setTimeout(() => {
      void searchFiles(fileSearch, root, text, generation).then(
        (outcome) => {
          if (generationRef.current !== generation) return;
          setState({ key, loading: false, ...outcome });
        },
        () => {
          if (generationRef.current !== generation) return;
          setState({ key, loading: false, results: EMPTY_RESULTS, truncated: false });
        },
      );
    }, AGENT_PALETTE_FILE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [active, fileSearch, key, text, workspaceRoot]);

  const current = state.key === key ? state : IDLE;
  return {
    isLoading: current.loading,
    isTruncated: current.truncated,
    onChangeQuery: setQuery,
    query,
    request,
    results: current.results,
  };
}

function searchTextFor(request: QuickOpenQuery): string {
  switch (request.kind) {
    case "files":
      return request.query.trim();
    case "fileLocation":
      return request.pathQuery.trim();
    default: {
      const unsupported: never = request;
      return unsupported;
    }
  }
}

async function searchFiles(
  gateway: FileSearchGateway,
  root: string,
  text: string,
  generation: number,
): Promise<{ readonly results: FileSearchResult[]; readonly truncated: boolean }> {
  if (gateway.searchFilesWithMetadata === undefined) {
    const results = await gateway.searchFiles(root, text, AGENT_PALETTE_FILE_LIMIT);
    return { results, truncated: results.length >= AGENT_PALETTE_FILE_LIMIT };
  }
  const response = await gateway.searchFilesWithMetadata(
    root,
    text,
    AGENT_PALETTE_FILE_LIMIT,
    `agent-palette-${generation}`,
  );
  return { results: [...response.results], truncated: response.truncated };
}
