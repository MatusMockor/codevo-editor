import { readStyleSheet } from "../cssContractTestSupport";

export const AGENT_MODE_STYLE_SHEETS = [
  "agentModeTokens.css",
  "agentModeVariants.css",
  "agentMode.css",
  "agentRail.css",
  "agentThread.css",
  "agentComposer.css",
  "agentSurface.css",
  "agentUsage.css",
  "agentStatusBar.css",
] as const;

export function agentModeSheetPath(sheet: (typeof AGENT_MODE_STYLE_SHEETS)[number]): string {
  return `components/agentMode/${sheet}`;
}

export function readAgentModeStyles(): string {
  return AGENT_MODE_STYLE_SHEETS.map(
    (sheet) => readStyleSheet(agentModeSheetPath(sheet)).source,
  ).join("");
}
