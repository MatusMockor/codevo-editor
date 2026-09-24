import { useCallback } from "react";
import type { ResponsivePanelRestore } from "../../domain/agentWorkbenchResponsiveLayout";
import { useWorkbenchFrameResponsiveRestore } from "../useWorkbenchFrameResponsiveRestore";

export interface ResponsivePanelToggleOptions {
  readonly rightPanelMaximized: boolean;
  toggleMaximized(): void;
  toggleRail(): void;
  toggleRightPanel(): void;
}

export interface ResponsivePanelToggle {
  readonly restore: ResponsivePanelRestore;
  toggle(): void;
}

export function useResponsivePanelToggle({
  rightPanelMaximized,
  toggleMaximized,
  toggleRail,
  toggleRightPanel,
}: ResponsivePanelToggleOptions): ResponsivePanelToggle {
  const restore = useWorkbenchFrameResponsiveRestore();
  const toggle = useCallback(() => {
    switch (restore) {
      case "none":
        toggleMaximized();
        return;
      case "collapseRail":
        if (rightPanelMaximized) toggleMaximized();
        toggleRail();
        return;
      case "closePanel":
        if (rightPanelMaximized) toggleMaximized();
        toggleRightPanel();
        return;
      default:
        restore satisfies never;
    }
  }, [restore, rightPanelMaximized, toggleMaximized, toggleRail, toggleRightPanel]);
  return { restore, toggle };
}
