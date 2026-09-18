export type AgentFollowUpBehavior = "queue" | "steer";

export const DEFAULT_AGENT_FOLLOW_UP_BEHAVIOR: AgentFollowUpBehavior = "queue";

export function normalizeAgentFollowUpBehavior(value: unknown): AgentFollowUpBehavior {
  return value === "steer" ? "steer" : DEFAULT_AGENT_FOLLOW_UP_BEHAVIOR;
}
