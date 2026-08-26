import { createContext, useContext } from "react";

export interface WorkbenchEditorTabsPortalValue {
  readonly target: HTMLElement | null;
  claimTarget(target: HTMLElement): () => void;
}

export const WorkbenchEditorTabsPortalContext = createContext<WorkbenchEditorTabsPortalValue>({
  target: null,
  claimTarget: () => () => undefined,
});

export function useWorkbenchEditorTabsPortalTarget(): HTMLElement | null {
  return useContext(WorkbenchEditorTabsPortalContext).target;
}
