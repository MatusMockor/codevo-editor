import { useContext } from "react";
import type { ResponsivePanelRestore } from "../domain/agentWorkbenchResponsiveLayout";
import { WorkbenchFrameResponsiveContext } from "./workbenchFrameResponsiveContext";

export function useWorkbenchFrameResponsiveRestore(): ResponsivePanelRestore {
  return useContext(WorkbenchFrameResponsiveContext);
}
