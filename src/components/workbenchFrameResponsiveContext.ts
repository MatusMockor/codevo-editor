import { createContext } from "react";
import type { ResponsivePanelRestore } from "../domain/agentWorkbenchResponsiveLayout";

export const WorkbenchFrameResponsiveContext = createContext<ResponsivePanelRestore>("none");
