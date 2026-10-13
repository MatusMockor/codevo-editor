import type { AgentInteractionSnapshot } from "../domain/agentInteractionSnapshot";

export interface AgentInteractionOwner {
  readonly workspaceId: string;
  readonly taskId: string;
}

export interface AgentInteractionFeed {
  currentInteractions(owner: AgentInteractionOwner): Promise<AgentInteractionSnapshot>;
  subscribeInteractions(handler: (snapshot: AgentInteractionSnapshot) => void): Promise<() => void>;
}

export function isAgentInteractionFeed(value: unknown): value is AgentInteractionFeed {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<AgentInteractionFeed>;
  return (
    typeof candidate.currentInteractions === "function" &&
    typeof candidate.subscribeInteractions === "function"
  );
}
