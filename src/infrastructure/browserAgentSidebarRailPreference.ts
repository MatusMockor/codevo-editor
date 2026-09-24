import type { AgentSidebarRailPreferencePort } from "../application/useAgentWorkbenchLayout";
import { isAgentRailState, type AgentRailState } from "../domain/agentWorkbenchLayout";
import type { KeyValueStorage } from "./browserSettingsGateway";

export const AGENT_SIDEBAR_RAIL_STORAGE_KEY = "editor.agentSidebar.rail.v1";

export class BrowserAgentSidebarRailPreference implements AgentSidebarRailPreferencePort {
  constructor(private readonly storage: KeyValueStorage = localStorage) {}

  read(): AgentRailState | null {
    const stored = this.storage.getItem(AGENT_SIDEBAR_RAIL_STORAGE_KEY);
    return isAgentRailState(stored) ? stored : null;
  }

  write(rail: AgentRailState): void {
    this.storage.setItem(AGENT_SIDEBAR_RAIL_STORAGE_KEY, rail);
  }
}
