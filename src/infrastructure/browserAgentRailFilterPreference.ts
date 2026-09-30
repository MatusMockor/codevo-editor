import type { AgentRailFilterPreferencePort } from "../application/agentRailFilterPreferencePort";
import {
  ALL_PROJECTS_FILTER,
  parseAgentRailFilter,
  serializeAgentRailFilter,
  type AgentRailFilter,
} from "../domain/agentRailFilter";
import type { KeyValueStorage } from "./browserSettingsGateway";

export const AGENT_RAIL_FILTER_STORAGE_KEY = "editor.agentSidebar.projectFilter.v1";

export class BrowserAgentRailFilterPreference implements AgentRailFilterPreferencePort {
  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {}

  load(): AgentRailFilter {
    if (this.storage === null) return ALL_PROJECTS_FILTER;
    try {
      return parseAgentRailFilter(this.storage.getItem(AGENT_RAIL_FILTER_STORAGE_KEY));
    } catch {
      return ALL_PROJECTS_FILTER;
    }
  }

  save(filter: AgentRailFilter): void {
    if (this.storage === null) return;
    try {
      this.storage.setItem(AGENT_RAIL_FILTER_STORAGE_KEY, serializeAgentRailFilter(filter));
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
