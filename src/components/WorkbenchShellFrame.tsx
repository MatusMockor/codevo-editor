import { useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { WorkbenchFrameBootContext, useWorkbenchFrameBooted } from "./workbenchFrameBootContext";
import { WorkbenchFramePortalContext } from "./workbenchFramePortal";
import { WorkbenchFrameResponsiveContext } from "./workbenchFrameResponsiveContext";
import {
  WORKBENCH_FRAME_BOTTOM_PANEL_VARIABLE,
  WORKBENCH_FRAME_RAIL_VARIABLE,
  WORKBENCH_FRAME_RIGHT_PANEL_VARIABLE,
  responsiveWorkbenchShellPlacement,
  type WorkbenchShellPlacement,
} from "./workbenchShellPlacement";
import { useViewportWidth } from "./useViewportWidth";
import { useWorkbenchFrameHeight } from "./useWorkbenchFrameHeight";
import { useTerminalPanelFocusReturn } from "./useTerminalPanelFocusReturn";

export type WorkbenchShellSurface = "workbench" | "settings";

export interface WorkbenchShellFrameProps {
  readonly placement: WorkbenchShellPlacement;
  readonly agent: ReactNode;
  readonly bottom: ReactNode;
  readonly settings?: ReactNode;
  readonly settingsRef?: Ref<HTMLDivElement>;
  readonly surface?: WorkbenchShellSurface;
}

export function WorkbenchShellFrame({
  agent,
  bottom,
  placement,
  settings = null,
  settingsRef,
  surface = "workbench",
}: WorkbenchShellFrameProps) {
  const settingsSurface = surface === "settings";
  const frameBooted = useWorkbenchFrameBooted();
  const [workbenchElement, setWorkbenchElement] = useState<HTMLElement | null>(null);
  const viewportWidth = useViewportWidth(workbenchElement);
  const responsivePlacement = responsiveWorkbenchShellPlacement(placement, viewportWidth);
  const [frameElement, setFrameElement] = useState<HTMLDivElement | null>(null);
  const frameHeight = useWorkbenchFrameHeight(frameElement);
  useTerminalPanelFocusReturn(
    settingsSurface ? null : frameElement,
    placement.bottomPanelHeight > 0,
  );
  const style = {
    [WORKBENCH_FRAME_RIGHT_PANEL_VARIABLE]: `${responsivePlacement.rightPanelWidth}px`,
    [WORKBENCH_FRAME_BOTTOM_PANEL_VARIABLE]: `${responsivePlacement.bottomPanelHeight}px`,
    [WORKBENCH_FRAME_RAIL_VARIABLE]: `${responsivePlacement.railWidth}px`,
  } as CSSProperties;

  return (
    <section
      className="editor-workbench"
      data-layout="agent"
      ref={setWorkbenchElement}
      style={style}
    >
      <div
        className="workbench-frame"
        style={{ "--agent-bottom-panel-limit": `${frameHeight * 0.75}px` } as CSSProperties}
        data-layout="agent"
        data-rail={responsivePlacement.rail}
        data-right-panel={
          responsivePlacement.rightPanelMaximized
            ? "maximized"
            : responsivePlacement.rightPanelOverlay
              ? "overlay"
              : "docked"
        }
        data-surface={settingsSurface ? "settings" : undefined}
        ref={setFrameElement}
      >
        <WorkbenchFrameBootContext.Provider value={frameBooted}>
          <WorkbenchFramePortalContext.Provider value={frameElement}>
            <WorkbenchFrameResponsiveContext.Provider value={responsivePlacement.responsiveRestore}>
              {agent}
            </WorkbenchFrameResponsiveContext.Provider>
          </WorkbenchFramePortalContext.Provider>
          {settingsSurface ? (
            <div className="workbench-frame__settings" data-slot="settings" ref={settingsRef}>
              {settings}
            </div>
          ) : null}
          <div className="workbench-frame__bottom" data-slot="bottom" hidden={settingsSurface}>
            {bottom}
          </div>
        </WorkbenchFrameBootContext.Provider>
      </div>
    </section>
  );
}
