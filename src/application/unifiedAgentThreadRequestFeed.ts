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
import type {
  RemoteAgentThreadRequestConfirmation,
  RemoteAgentThreadRequestDescribeOutcome,
  RemoteAgentThreadRequestDescription,
  RemoteAgentThreadRequestFeed,
  RemoteAgentThreadRequestRespondOutcome,
} from "./remoteAgentThreadRequestFeed";
import type { RemoteAgentThreadRequestResponse } from "./remoteAgentThreadRequestPorts";

export type RemoteAgentThreadRequestControl = Pick<
  RemoteAgentThreadRequestFeed,
  "describe" | "release" | "respond" | "reconnected" | "confirm"
>;

export type UnifiedAgentThreadRequestFeed = AgentThreadRequestFeed &
  RemoteAgentThreadRequestControl;

export interface UnifiedAgentThreadRequestFeeds {
  readonly local: AgentThreadRequestFeed;
  readonly remote: AgentThreadRequestFeed | RemoteAgentThreadRequestFeed;
}

const NOT_REMOTE: RemoteAgentThreadRequestDescribeOutcome = Object.freeze({
  kind: "refused",
  reason: "notRemote",
});
const UNCONFIRMED: RemoteAgentThreadRequestConfirmation = "unconfirmed";
const NOT_DESCRIBED: RemoteAgentThreadRequestRespondOutcome = Object.freeze({
  kind: "notSent",
  reason: "notDescribed",
});

export function createUnifiedAgentThreadRequestFeed(
  feeds: UnifiedAgentThreadRequestFeeds,
): UnifiedAgentThreadRequestFeed {
  return new RoutingAgentThreadRequestFeed(feeds);
}

export function remoteAgentThreadRequestControl(
  feed: AgentThreadRequestFeed | null,
): RemoteAgentThreadRequestControl | null {
  if (feed === null || !isRemoteAgentThreadRequestControl(feed)) return null;
  return feed;
}

function isRemoteAgentThreadRequestControl(feed: object): feed is RemoteAgentThreadRequestControl {
  const candidate = feed as Partial<RemoteAgentThreadRequestControl>;
  return (
    typeof candidate.describe === "function" &&
    typeof candidate.release === "function" &&
    typeof candidate.respond === "function" &&
    typeof candidate.reconnected === "function" &&
    typeof candidate.confirm === "function"
  );
}

class RoutingAgentThreadRequestFeed implements UnifiedAgentThreadRequestFeed {
  private readonly control: RemoteAgentThreadRequestControl | null;

  constructor(private readonly feeds: UnifiedAgentThreadRequestFeeds) {
    this.control = remoteAgentThreadRequestControl(feeds.remote);
  }

  describe(
    scope: AgentThreadRequestScope,
    description: RemoteAgentThreadRequestDescription,
  ): RemoteAgentThreadRequestDescribeOutcome {
    if (this.control === null) return NOT_REMOTE;
    return this.control.describe(scope, description);
  }

  release(scope: AgentThreadRequestScope): void {
    this.control?.release(scope);
  }

  respond(
    scope: AgentThreadRequestScope,
    turnId: string,
    requestId: string,
    response: RemoteAgentThreadRequestResponse,
  ): Promise<RemoteAgentThreadRequestRespondOutcome> {
    if (this.control === null) return Promise.resolve(NOT_DESCRIBED);
    return this.control.respond(scope, turnId, requestId, response);
  }

  reconnected(serverId: string): void {
    this.control?.reconnected(serverId);
  }

  confirm(
    scope: AgentThreadRequestScope,
    turnId: string,
    requestId: string,
  ): Promise<RemoteAgentThreadRequestConfirmation> {
    if (this.control === null) return Promise.resolve(UNCONFIRMED);
    return this.control.confirm(scope, turnId, requestId);
  }

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

  subscribeThreadRequestInvalidations(handler: (epoch: string) => void): Promise<() => void> {
    const { local } = this.feeds;
    if (local.subscribeThreadRequestInvalidations === undefined) return Promise.resolve(ignore);
    return local.subscribeThreadRequestInvalidations(handler);
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

function ignore(): void {
  return;
}

function safelyRelease(unsubscribe: () => void): void {
  try {
    unsubscribe();
  } catch {
    return;
  }
}
