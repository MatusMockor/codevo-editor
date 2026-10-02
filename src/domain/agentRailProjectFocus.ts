export type AgentRailProjectFocus = "all" | "active";

export const ALL_PROJECTS_FOCUS: AgentRailProjectFocus = "all";

export function parseAgentRailProjectFocus(raw: string | null): AgentRailProjectFocus {
  if (raw === "active") return "active";
  return ALL_PROJECTS_FOCUS;
}
