import type { AgentThreadRequests } from "../domain/agentRuntimeRequest";
import {
  agentThreadRequestScopeRoute,
  type AgentThreadRequestScopeRoute,
} from "../domain/remoteAgentThreadRequestScope";
import type {
  AgentThreadRequestFeed,
  AgentThreadRequestScope,
  AgentThreadRequestsPage,
} from "./agentThreadRequestPorts";

export interface UnifiedAgentThreadRequestFeeds {
  readonly local: AgentThreadRequestFeed;
  readonly remote: AgentThreadRequestFeed;
}

export function createUnifiedAgentThreadRequestFeed(
  feeds: UnifiedAgentThreadRequestFeeds,
): AgentThreadRequestFeed {
  return new UnifiedAgentThreadRequestFeed(feeds);
}

class UnifiedAgentThreadRequestFeed implements AgentThreadRequestFeed {
  constructor(private readonly feeds: UnifiedAgentThreadRequestFeeds) {}

  currentThreadRequests(
    scope: AgentThreadRequestScope,
    turnIds: readonly string[],
    cursor: string | null,
  ): Promise<AgentThreadRequestsPage> {
    return this.feedOf(agentThreadRequestScopeRoute(scope)).currentThreadRequests(
      scope,
      turnIds,
      cursor,
    );
  }

  async subscribeThreadRequests(
    handler: (message: AgentThreadRequests) => void,
  ): Promise<() => void> {
    const open = async (feed: AgentThreadRequestFeed): Promise<() => void> =>
      feed.subscribeThreadRequests(handler);
    const opened = await Promise.allSettled([open(this.feeds.local), open(this.feeds.remote)]);
    const releases = opened.flatMap((source) =>
      source.status === "fulfilled" ? [source.value] : [],
    );
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      releases.forEach(safelyRelease);
    };
    if (releases.length === opened.length) return release;
    release();
    throw new Error("Agent thread requests are unavailable.");
  }

  private feedOf(route: AgentThreadRequestScopeRoute): AgentThreadRequestFeed {
    switch (route) {
      case "local":
        return this.feeds.local;
      case "remote":
        return this.feeds.remote;
      default: {
        const exhaustive: never = route;
        return exhaustive;
      }
    }
  }
}

function safelyRelease(unsubscribe: () => void): void {
  try {
    unsubscribe();
  } catch {
    return;
  }
}
