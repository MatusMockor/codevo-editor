import type { AgentRailProjectFocus } from "../domain/agentRailProjectFocus";

export interface AgentRailProjectFocusPreferencePort {
  load(): AgentRailProjectFocus;
  save(focus: AgentRailProjectFocus): void;
}
