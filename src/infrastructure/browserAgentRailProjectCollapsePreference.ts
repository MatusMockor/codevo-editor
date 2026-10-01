import type { AgentRailProjectCollapsePreferencePort } from "../application/agentRailProjectCollapsePreferencePort";
import {
  NO_COLLAPSED_PROJECTS,
  parseAgentRailCollapsedProjects,
  serializeAgentRailCollapsedProjects,
  type AgentRailCollapsedProjects,
} from "../domain/agentRailProjectCollapse";
import type { KeyValueStorage } from "./browserSettingsGateway";

export const AGENT_RAIL_COLLAPSED_PROJECTS_STORAGE_KEY = "editor.agentSidebar.collapsedProjects.v1";
export const RETIRED_AGENT_RAIL_FILTER_STORAGE_KEY = "editor.agentSidebar.projectFilter.v1";

export class BrowserAgentRailProjectCollapsePreference implements AgentRailProjectCollapsePreferencePort {
  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {}

  load(): AgentRailCollapsedProjects {
    if (this.storage === null) return NO_COLLAPSED_PROJECTS;
    this.forgetRetiredFilter();
    try {
      return parseAgentRailCollapsedProjects(
        this.storage.getItem(AGENT_RAIL_COLLAPSED_PROJECTS_STORAGE_KEY),
      );
    } catch {
      return NO_COLLAPSED_PROJECTS;
    }
  }

  save(collapsed: AgentRailCollapsedProjects): void {
    if (this.storage === null) return;
    try {
      if (collapsed.length === 0) {
        this.storage.removeItem(AGENT_RAIL_COLLAPSED_PROJECTS_STORAGE_KEY);
        return;
      }
      this.storage.setItem(
        AGENT_RAIL_COLLAPSED_PROJECTS_STORAGE_KEY,
        serializeAgentRailCollapsedProjects(collapsed),
      );
    } catch {
      return;
    }
  }

  private forgetRetiredFilter(): void {
    try {
      this.storage?.removeItem(RETIRED_AGENT_RAIL_FILTER_STORAGE_KEY);
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
