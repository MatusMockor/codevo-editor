import type { AgentThreadRequests } from "../domain/agentRuntimeRequest";

export const MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL = 32;
export const AGENT_THREAD_REQUESTS_CURSOR_STALE_MESSAGE =
  "Agent thread request cursor is no longer valid.";

export class AgentThreadRequestsCursorStaleError extends Error {
  constructor() {
    super(AGENT_THREAD_REQUESTS_CURSOR_STALE_MESSAGE);
    this.name = "AgentThreadRequestsCursorStaleError";
  }
}

export interface AgentThreadRequestScope {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly threadId: string;
  readonly workspaceId: string | null;
}

export interface AgentThreadRequestsPage {
  readonly message: AgentThreadRequests;
  readonly nextCursor: string | null;
}

export interface AgentThreadRequestFeed {
  currentThreadRequests(
    scope: AgentThreadRequestScope,
    turnIds: readonly string[],
    cursor: string | null,
  ): Promise<AgentThreadRequestsPage>;
  subscribeThreadRequests(handler: (message: AgentThreadRequests) => void): Promise<() => void>;
  subscribeThreadRequestInvalidations?(handler: (epoch: string) => void): Promise<() => void>;
}

export function isAgentThreadRequestFeed(value: unknown): value is AgentThreadRequestFeed {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<AgentThreadRequestFeed>;
  return (
    typeof candidate.currentThreadRequests === "function" &&
    typeof candidate.subscribeThreadRequests === "function"
  );
}
