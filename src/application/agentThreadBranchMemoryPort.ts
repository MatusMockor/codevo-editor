import type { AgentThreadBranchMemory } from "../domain/agentThreadBranchMemory";

export interface AgentThreadBranchMemoryPort {
  load(): AgentThreadBranchMemory;
  save(memory: AgentThreadBranchMemory): void;
}
