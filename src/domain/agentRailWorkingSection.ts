export type AgentRailWorkingSection = "off" | "on";

export const WORKING_SECTION_OFF: AgentRailWorkingSection = "off";

export function parseAgentRailWorkingSection(raw: string | null): AgentRailWorkingSection {
  if (raw === "on") return "on";
  return WORKING_SECTION_OFF;
}
