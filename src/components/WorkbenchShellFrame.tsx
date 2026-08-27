import { useState, type CSSProperties, type ReactNode } from "react";
import {
  DEFAULT_AGENT_APPEARANCE_VARIANT,
  type AgentAppearanceVariant,
} from "../domain/agentSettings";
import { WorkbenchFramePortalContext } from "./workbenchFramePortal";
import { WorkbenchFrameTreeContext } from "./workbenchFrameTreeReport";
import { WorkbenchEditorTabsPortalProvider } from "./workbenchEditorTabsPortal";
import { WorkbenchFrameResponsiveContext } from "./workbenchFrameResponsiveContext";
import {
  WORKBENCH_FRAME_BOTTOM_PANEL_VARIABLE,
  WORKBENCH_FRAME_RIGHT_PANEL_VARIABLE,
  responsiveWorkbenchShellPlacement,
  workbenchFrameTreeState,
  type WorkbenchShellPlacement,
} from "./workbenchShellPlacement";
import { useViewportWidth } from "./useViewportWidth";

export interface WorkbenchShellFrameProps {
  readonly placement: WorkbenchShellPlacement;
  readonly agentVariant?: AgentAppearanceVariant;
  readonly chrome: ReactNode;
  readonly agent: ReactNode;
  readonly editor: ReactNode;
  readonly bottom: ReactNode;
}

export function WorkbenchShellFrame({
  agent,
  agentVariant = DEFAULT_AGENT_APPEARANCE_VARIANT,
  bottom,
  chrome,
  editor,
  placement,
}: WorkbenchShellFrameProps) {
  const [workbenchElement, setWorkbenchElement] = useState<HTMLElement | null>(null);
  const viewportWidth = useViewportWidth(workbenchElement);
  const responsivePlacement = responsiveWorkbenchShellPlacement(placement, viewportWidth);
  const [treeReportedVisible, setTreeReportedVisible] = useState(false);
  const [frameElement, setFrameElement] = useState<HTMLDivElement | null>(null);
  const style = {
    [WORKBENCH_FRAME_RIGHT_PANEL_VARIABLE]: `${responsivePlacement.rightPanelWidth}px`,
    [WORKBENCH_FRAME_BOTTOM_PANEL_VARIABLE]: `${responsivePlacement.bottomPanelHeight}px`,
  } as CSSProperties;

  return (
    <section
      className="editor-workbench"
      data-layout={responsivePlacement.layout}
      ref={setWorkbenchElement}
      style={style}
    >
      {chrome}
      <div
        className="workbench-frame"
        data-agent-variant={agentVariant}
        data-layout={responsivePlacement.layout}
        data-rail={responsivePlacement.rail}
        data-right-panel={responsivePlacement.rightPanelMaximized ? "maximized" : "docked"}
        data-tree={workbenchFrameTreeState(responsivePlacement, treeReportedVisible)}
        ref={setFrameElement}
      >
        <WorkbenchEditorTabsPortalProvider>
          <WorkbenchFramePortalContext.Provider value={frameElement}>
            <WorkbenchFrameTreeContext.Provider value={setTreeReportedVisible}>
              <WorkbenchFrameResponsiveContext.Provider
                value={responsivePlacement.responsiveRestore}
              >
                {agent}
              </WorkbenchFrameResponsiveContext.Provider>
            </WorkbenchFrameTreeContext.Provider>
          </WorkbenchFramePortalContext.Provider>
          <div
            aria-hidden={responsivePlacement.editorHidden || undefined}
            className="editor-mode-surface"
            data-slot="editor"
            hidden={responsivePlacement.editorHidden}
          >
            {editor}
          </div>
          <div className="workbench-frame__bottom" data-slot="bottom">
            {bottom}
          </div>
        </WorkbenchEditorTabsPortalProvider>
      </div>
    </section>
  );
}
