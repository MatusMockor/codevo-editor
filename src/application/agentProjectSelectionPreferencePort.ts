import type { PersistedAgentProjectSelection } from "../domain/agentProjectSelectionSnapshot";

export interface AgentProjectSelectionPreferencePort {
  load(): ReadonlyArray<PersistedAgentProjectSelection>;
  save(selections: ReadonlyArray<PersistedAgentProjectSelection>): void;
}
