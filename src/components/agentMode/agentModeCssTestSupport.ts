import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

export function readAgentModeStyles(): string {
  return AGENT_MODE_STYLE_SHEETS.map((sheet) =>
    readFileSync(resolve(import.meta.dirname, sheet), "utf8"),
  ).join("");
}
