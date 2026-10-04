import type { AgentRailWorkingSection } from "../domain/agentRailWorkingSection";

export type AgentRailWorkingSectionPersistence = "persisted" | "sessionOnly";

export interface AgentRailWorkingSectionPreferencePort {
  load(): AgentRailWorkingSection;
  persistence(): AgentRailWorkingSectionPersistence;
  save(workingSection: AgentRailWorkingSection): AgentRailWorkingSectionPersistence;
  subscribe(notify: () => void): () => void;
}
