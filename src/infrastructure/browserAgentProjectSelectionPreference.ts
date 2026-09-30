import type { AgentProjectSelectionPreferencePort } from "../application/agentProjectSelectionPreferencePort";
import {
  parseAgentProjectSelectionSnapshot,
  serializeAgentProjectSelectionSnapshot,
  type PersistedAgentProjectSelection,
} from "../domain/agentProjectSelectionSnapshot";
import type { KeyValueStorage } from "./browserSettingsGateway";

export const AGENT_PROJECT_SELECTION_STORAGE_KEY = "editor.agentNavigation.projectSelections.v1";

export class BrowserAgentProjectSelectionPreference implements AgentProjectSelectionPreferencePort {
  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {}

  load(): ReadonlyArray<PersistedAgentProjectSelection> {
    if (this.storage === null) return [];
    try {
      return parseAgentProjectSelectionSnapshot(
        this.storage.getItem(AGENT_PROJECT_SELECTION_STORAGE_KEY),
      );
    } catch {
      return [];
    }
  }

  save(selections: ReadonlyArray<PersistedAgentProjectSelection>): void {
    if (this.storage === null) return;
    try {
      if (selections.length === 0) {
        this.storage.removeItem(AGENT_PROJECT_SELECTION_STORAGE_KEY);
        return;
      }
      this.storage.setItem(
        AGENT_PROJECT_SELECTION_STORAGE_KEY,
        serializeAgentProjectSelectionSnapshot(selections),
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
