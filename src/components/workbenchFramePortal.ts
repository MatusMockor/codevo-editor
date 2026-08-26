import { createContext, useContext } from "react";

export const WorkbenchFramePortalContext = createContext<HTMLElement | null>(null);

export function useWorkbenchFramePortalTarget(): HTMLElement {
  return useContext(WorkbenchFramePortalContext) ?? document.body;
}
