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
  const workbench = current();
  if (workbench.agentModeActive && workbench.agentWorkbench.effectiveLayout === "agent") {
    workbench.agentWorkbench.dispatch({
      kind: "revealFile",
      path: result.path,
      line: location?.line ?? null,
    });
    return;
  }
  await workbench.openSearchResult(result, location);
}
