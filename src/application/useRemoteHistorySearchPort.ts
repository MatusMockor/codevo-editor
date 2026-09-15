import { useEffect, useMemo, useRef } from "react";
import type { RemoteRunnerGateway, RemoteRunnerServer } from "../domain/remoteRunner";
import type { AgentThreadSearchMatch, AgentThreadSearchResult } from "../domain/agentThreadSearch";
import type { AgentHistorySearchPort, AgentThreadView } from "./agentThreadPorts";
import { remoteAgentThreadKey } from "./remoteAgentProjection";

export const REMOTE_HISTORY_SEARCH_MAX_PAGES = 100;
export const REMOTE_HISTORY_SEARCH_MAX_RESULTS = 50;
interface Options {
  readonly gateway: Pick<RemoteRunnerGateway, "searchHistory"> | null;
  readonly servers: readonly RemoteRunnerServer[];
  readonly workspaceOwner: string | null;
  readonly views: readonly AgentThreadView[];
}

/** Each published port belongs to one exact workspace and connection generation. */
export function useRemoteHistorySearchPort(options: Options): AgentHistorySearchPort {
  const { gateway, workspaceOwner, views } = options;
  const configuration = JSON.stringify(options.servers);
  const revision = JSON.stringify(
    views
      .filter((view) => view.execution)
      .map((view) => [
        view.thread.threadId,
        view.thread.turns.map((turn) => [turn.turnId, turn.status.kind]),
      ]),
  );
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const owner = useRef({ gateway, workspaceOwner, configuration, revision });
  if (
    owner.current.gateway !== gateway ||
    owner.current.workspaceOwner !== workspaceOwner ||
    owner.current.configuration !== configuration ||
    owner.current.revision !== revision
  )
    owner.current = { gateway, workspaceOwner, configuration, revision };
  const captured = owner.current;
  const latestViews = useRef(views);
  latestViews.current = views;
  return useMemo(
    () => ({
      search: async (query, threadIds, signal) => {
        const valid = () => mounted.current && !signal.aborted && owner.current === captured;
        const servers: readonly RemoteRunnerServer[] = JSON.parse(configuration);
        return searchRemoteHistory(gateway, servers, latestViews.current, query, threadIds, valid);
      },
    }),
    [captured, configuration, gateway],
  );
}

export async function searchRemoteHistory(
  gateway: Pick<RemoteRunnerGateway, "searchHistory"> | null,
  servers: readonly RemoteRunnerServer[],
  views: readonly AgentThreadView[],
  query: string,
  threadIds: ReadonlySet<string>,
  valid: () => boolean,
): Promise<AgentThreadSearchResult> {
  const deadline = Date.now() + 15_000;
  const matches = new Map<string, AgentThreadSearchMatch>();
  const known = new Map(views.map((view) => [view.thread.threadId, view]));
  let incomplete = false;
  let truncated = false;
  const check = () => {
    if (!valid()) throw new Error("History search cancelled.");
  };
  for (const server of servers.slice(0, 16)) {
    check();
    if (matches.size >= REMOTE_HISTORY_SEARCH_MAX_RESULTS) {
      truncated = true;
      incomplete = true;
      break;
    }
    if (!server.connected || !gateway?.searchHistory) {
      incomplete = true;
      continue;
    }
    const execution = views.find((view) => view.execution?.serverId === server.id)?.execution;
    if (!execution) {
      incomplete = true;
      continue;
    }
    let after = 0;
    try {
      for (let pageIndex = 0; pageIndex < REMOTE_HISTORY_SEARCH_MAX_PAGES; pageIndex++) {
        check();
        if (Date.now() >= deadline) {
          incomplete = true;
          break;
        }
        const page = await boundedPage(
          gateway.searchHistory({ serverId: server.id, query, after }),
          Math.min(10_000, deadline - Date.now()),
        );
        check();
        incomplete ||= page.incomplete;
        for (const item of page.items) {
          const id = remoteAgentThreadKey(server.id, execution.runnerId, item.conversationId);
          const view = known.get(id);
          if (!view || !view.thread.turns.some((turn) => turn.turnId === item.taskId)) {
            incomplete = true;
            continue;
          }
          if (!threadIds.has(id) || matches.has(id)) continue;
          if (matches.size >= REMOTE_HISTORY_SEARCH_MAX_RESULTS) {
            truncated = true;
            continue;
          }
          const start = item.snippet.toLowerCase().indexOf(query);
          matches.set(id, {
            threadId: id,
            turnId: item.taskId,
            source: item.role,
            eventIndex: null,
            snippet: item.snippet,
            ranges:
              start < 0 || item.snippet.slice(start, start + query.length).toLowerCase() !== query
                ? []
                : [{ start, end: start + query.length }],
            segmentStart: 0,
            segmentEnd: query.length,
            score: 100,
            resolveQuery: true,
            resolveSource: item.role,
          });
        }
        if (matches.size >= REMOTE_HISTORY_SEARCH_MAX_RESULTS && page.nextCursor !== null) {
          truncated = true;
          incomplete = true;
          break;
        }
        if (page.nextCursor === null) break;
        if (page.nextCursor <= after) throw new Error("Invalid history cursor.");
        after = page.nextCursor;
        if (pageIndex === REMOTE_HISTORY_SEARCH_MAX_PAGES - 1) incomplete = true;
      }
    } catch {
      check();
      incomplete = true;
    }
  }
  check();
  return {
    query,
    matches: [...matches.values()],
    truncated,
    documentsTruncated: incomplete || servers.length > 16,
  };
}

async function boundedPage<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("History search timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
