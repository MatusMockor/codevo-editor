import type { AgentWorkbenchLayoutState } from "./useAgentWorkbenchLayout";

export function agentDiffStatusDemand(workbench: AgentWorkbenchLayoutState): boolean {
  return (
    workbench.effectiveLayout === "agent" &&
    workbench.layout.rightPanel === "open" &&
    workbench.layout.activeSurface === "diff" &&
    workbench.layout.openSurfaces.includes("diff")
  );
}
