import type { AgentThreadBranchMemoryPort } from "../application/agentThreadBranchMemoryPort";
import {
  EMPTY_AGENT_THREAD_BRANCH_MEMORY,
  parseAgentThreadBranchMemory,
  serializeAgentThreadBranchMemory,
  type AgentThreadBranchMemory,
} from "../domain/agentThreadBranchMemory";
import type { KeyValueStorage } from "./browserSettingsGateway";

export const AGENT_THREAD_BRANCH_MEMORY_STORAGE_KEY = "editor.agentThreads.lastRunBranch.v1";

export class BrowserAgentThreadBranchMemory implements AgentThreadBranchMemoryPort {
  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {}

  load(): AgentThreadBranchMemory {
    if (this.storage === null) return EMPTY_AGENT_THREAD_BRANCH_MEMORY;
    try {
      return parseAgentThreadBranchMemory(
        this.storage.getItem(AGENT_THREAD_BRANCH_MEMORY_STORAGE_KEY),
      );
    } catch {
      return EMPTY_AGENT_THREAD_BRANCH_MEMORY;
    }
  }

  save(memory: AgentThreadBranchMemory): void {
    if (this.storage === null) return;
    try {
      this.storage.setItem(
        AGENT_THREAD_BRANCH_MEMORY_STORAGE_KEY,
        serializeAgentThreadBranchMemory(memory),
      );
    } catch {
      return;
    }
  }
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
