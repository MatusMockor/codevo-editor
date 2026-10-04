import type {
  AgentRailWorkingSectionPersistence,
  AgentRailWorkingSectionPreferencePort,
} from "../application/agentRailWorkingSectionPreferencePort";
import {
  WORKING_SECTION_OFF,
  parseAgentRailWorkingSection,
  type AgentRailWorkingSection,
} from "../domain/agentRailWorkingSection";
import type { KeyValueStorage } from "./browserSettingsGateway";

export const AGENT_RAIL_WORKING_SECTION_STORAGE_KEY = "editor.agentSidebar.workingSection.v1";

export class BrowserAgentRailWorkingSectionPreference implements AgentRailWorkingSectionPreferencePort {
  private readonly subscribers = new Set<() => void>();
  private memory: AgentRailWorkingSection | null = null;
  private unsaved = false;

  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {}

  load(): AgentRailWorkingSection {
    if (this.memory !== null && (this.unsaved || this.subscribers.size > 0)) return this.memory;
    this.memory = this.read();
    return this.memory;
  }

  persistence(): AgentRailWorkingSectionPersistence {
    return this.unsaved ? "sessionOnly" : "persisted";
  }

  save(workingSection: AgentRailWorkingSection): AgentRailWorkingSectionPersistence {
    this.memory = workingSection;
    this.unsaved = !this.write(workingSection);
    this.publish();
    return this.persistence();
  }

  subscribe(notify: () => void): () => void {
    if (this.subscribers.size === 0) this.listen();
    this.subscribers.add(notify);
    return () => {
      this.subscribers.delete(notify);
      if (this.subscribers.size === 0) browserWindow()?.removeEventListener("storage", this.reload);
    };
  }

  private readonly reload = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== AGENT_RAIL_WORKING_SECTION_STORAGE_KEY) return;
    this.memory = null;
    this.unsaved = false;
    this.publish();
  };

  private listen(): void {
    if (!this.unsaved) this.memory = null;
    browserWindow()?.addEventListener("storage", this.reload);
  }

  private read(): AgentRailWorkingSection {
    if (this.storage === null) return WORKING_SECTION_OFF;
    try {
      return parseAgentRailWorkingSection(
        this.storage.getItem(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY),
      );
    } catch {
      return WORKING_SECTION_OFF;
    }
  }

  private write(workingSection: AgentRailWorkingSection): boolean {
    if (this.storage === null) return false;
    try {
      this.store(this.storage, workingSection);
      return true;
    } catch {
      return false;
    }
  }

  private store(storage: KeyValueStorage, workingSection: AgentRailWorkingSection): void {
    if (workingSection === WORKING_SECTION_OFF) {
      storage.removeItem(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY);
      return;
    }
    storage.setItem(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY, workingSection);
  }

  private publish(): void {
    for (const notify of [...this.subscribers]) notify();
  }
}

function browserWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
