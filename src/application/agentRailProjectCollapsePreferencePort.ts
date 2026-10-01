import type { AgentRailCollapsedProjects } from "../domain/agentRailProjectCollapse";

export interface AgentRailProjectCollapsePreferencePort {
  load(): AgentRailCollapsedProjects;
  save(collapsed: AgentRailCollapsedProjects): void;
}
