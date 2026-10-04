import type { AgentRailWorkingSectionPreferencePort } from "../../application/agentRailWorkingSectionPreferencePort";
import { BrowserAgentRailWorkingSectionPreference } from "../../infrastructure/browserAgentRailWorkingSectionPreference";

export const SHARED_AGENT_RAIL_WORKING_SECTION_PREFERENCE: AgentRailWorkingSectionPreferencePort =
  new BrowserAgentRailWorkingSectionPreference();
