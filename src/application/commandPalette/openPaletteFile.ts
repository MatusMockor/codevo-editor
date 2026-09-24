import type { QuickOpenLocation } from "../../domain/quickOpenQuery";
import type { FileSearchResult } from "../../domain/workspace";
import type { AgentWorkbenchLayoutSurface } from "../useAgentWorkbenchLayout";

export interface PaletteFileOpenPort extends AgentWorkbenchLayoutSurface {
  openSearchResult(result: FileSearchResult, location?: QuickOpenLocation): Promise<boolean>;
}

export async function openPaletteFile(
  current: () => PaletteFileOpenPort,
  result: FileSearchResult,
  location?: QuickOpenLocation,
): Promise<void> {
  const opened = await current().openSearchResult(result, location);
  if (!opened) return;
  const settled = current();
  if (!settled.agentModeActive || settled.agentWorkbench.effectiveLayout !== "agent") return;
  settled.agentWorkbench.dispatch({ kind: "openSurface", surface: "files" });
}
