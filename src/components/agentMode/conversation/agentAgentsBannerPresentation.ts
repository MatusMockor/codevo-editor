import type { AgentRuntimeSubagents } from "../../../domain/agentRuntimeSubagent";

export const MAX_AGENTS_BANNER_NAMES = 3;

export interface AgentAgentsBannerModel {
  readonly label: string;
  readonly names: string;
}

export function agentAgentsBannerModel(
  groups: ReadonlyArray<{ readonly subagents: AgentRuntimeSubagents }>,
): AgentAgentsBannerModel | null {
  const working = groups
    .flatMap((group) => group.subagents.agents)
    .filter((agent) => agent.status === "working");
  if (working.length === 0) return null;
  const labels = [
    ...new Set(
      working.map((agent) => (agent.role ?? agent.title).trim()).filter((label) => label !== ""),
    ),
  ];
  const shown = labels.slice(0, MAX_AGENTS_BANNER_NAMES);
  const hidden = labels.length - shown.length;
  return {
    label: `${working.length} ${working.length === 1 ? "agent" : "agents"} running`,
    names: hidden > 0 ? `${shown.join(", ")} +${hidden}` : shown.join(", "),
  };
}
