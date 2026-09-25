import type { AgentSurfaceKind } from "../domain/agentWorkbenchLayout";
import type { AgentWorkbenchLayoutState } from "./useAgentWorkbenchLayout";

const GIT_STATUS_SURFACES: ReadonlyArray<AgentSurfaceKind> = ["diff", "files"];

export function agentGitStatusDemand(workbench: AgentWorkbenchLayoutState): boolean {
  const { layout } = workbench;
  const activeSurface = layout.activeSurface;
  if (activeSurface === null) return false;
  return (
    workbench.effectiveLayout === "agent" &&
    layout.rightPanel === "open" &&
    GIT_STATUS_SURFACES.includes(activeSurface) &&
    layout.openSurfaces.includes(activeSurface)
  );
}
