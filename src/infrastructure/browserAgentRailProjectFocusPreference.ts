import type { AgentRailProjectFocusPreferencePort } from "../application/agentRailProjectFocusPreferencePort";
import {
  ALL_PROJECTS_FOCUS,
  parseAgentRailProjectFocus,
  type AgentRailProjectFocus,
} from "../domain/agentRailProjectFocus";
import type { KeyValueStorage } from "./browserSettingsGateway";

export const AGENT_RAIL_PROJECT_FOCUS_STORAGE_KEY = "editor.agentSidebar.projectFocus.v1";

export class BrowserAgentRailProjectFocusPreference implements AgentRailProjectFocusPreferencePort {
  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {}

  load(): AgentRailProjectFocus {
    if (this.storage === null) return ALL_PROJECTS_FOCUS;
    try {
      return parseAgentRailProjectFocus(this.storage.getItem(AGENT_RAIL_PROJECT_FOCUS_STORAGE_KEY));
    } catch {
      return ALL_PROJECTS_FOCUS;
    }
  }

  save(focus: AgentRailProjectFocus): void {
    if (this.storage === null) return;
    try {
      if (focus === ALL_PROJECTS_FOCUS) {
        this.storage.removeItem(AGENT_RAIL_PROJECT_FOCUS_STORAGE_KEY);
        return;
      }
      this.storage.setItem(AGENT_RAIL_PROJECT_FOCUS_STORAGE_KEY, focus);
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
