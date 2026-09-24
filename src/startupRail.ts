import { isAgentRailState, type AgentRailState } from "./domain/agentWorkbenchLayout";
import { AGENT_SIDEBAR_RAIL_STORAGE_KEY } from "./infrastructure/browserAgentSidebarRailPreference";

export const STARTUP_RAIL_ATTRIBUTE = "data-startup-rail";

export interface StartupRailEnvironment {
  readonly readSetting: (key: string) => string | null;
  readonly setDocumentAttribute: (name: string, value: string) => void;
}

export function applyStartupRail(environment: StartupRailEnvironment): AgentRailState {
  const rail = readRailSafely(environment);
  environment.setDocumentAttribute(STARTUP_RAIL_ATTRIBUTE, rail);
  return rail;
}

export function applyBrowserStartupRail(): void {
  try {
    applyStartupRail({
      readSetting: (key) => localStorage.getItem(key),
      setDocumentAttribute: (name, value) => document.documentElement.setAttribute(name, value),
    });
  } catch {
    return;
  }
}

function readRailSafely(environment: StartupRailEnvironment): AgentRailState {
  try {
    const stored = environment.readSetting(AGENT_SIDEBAR_RAIL_STORAGE_KEY);
    return isAgentRailState(stored) ? stored : "expanded";
  } catch {
    return "expanded";
  }
}
