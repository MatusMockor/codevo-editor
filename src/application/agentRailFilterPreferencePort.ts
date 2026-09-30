import type { AgentRailFilter } from "../domain/agentRailFilter";

export interface AgentRailFilterPreferencePort {
  load(): AgentRailFilter;
  save(filter: AgentRailFilter): void;
}
