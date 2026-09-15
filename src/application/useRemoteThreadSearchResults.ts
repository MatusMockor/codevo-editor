import { useEffect, useRef, useState } from "react";
import type { AgentThreadSearchResult } from "../domain/agentThreadSearch";
import type { AgentHistorySearchPort, AgentThreadView } from "./agentThreadPorts";

export function useRemoteThreadSearchResults(
  port: AgentHistorySearchPort | undefined,
  query: string | null,
  views: readonly AgentThreadView[],
  debounceMs: number,
) {
  const identity = JSON.stringify(views.map((view) => view.thread.threadId).sort());
  const authority = useRef({ port, query, identity });
  if (
    authority.current.port !== port ||
    authority.current.query !== query ||
    authority.current.identity !== identity
  )
    authority.current = { port, query, identity };
  const owner = authority.current;
  const [published, setPublished] = useState<{
    owner: object;
    result: AgentThreadSearchResult;
  } | null>(null);
  useEffect(() => {
    if (!port || query === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void port
        .search(query, new Set<string>(JSON.parse(identity)), controller.signal)
        .then((result) => {
          if (!controller.signal.aborted && authority.current === owner)
            setPublished({ owner, result });
        })
        .catch(() => {
          if (!controller.signal.aborted && authority.current === owner)
            setPublished({
              owner,
              result: { query, matches: [], truncated: false, documentsTruncated: true },
            });
        });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [debounceMs, identity, owner, port, query]);
  return {
    result: published?.owner === owner ? published.result : null,
    pending: port !== undefined && query !== null && published?.owner !== owner,
  };
}
