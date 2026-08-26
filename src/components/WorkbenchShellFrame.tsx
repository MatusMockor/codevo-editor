import { useState, type CSSProperties, type ReactNode } from "react";
import {
  DEFAULT_AGENT_APPEARANCE_VARIANT,
  type AgentAppearanceVariant,
} from "../domain/agentSettings";
import { WorkbenchFramePortalContext } from "./workbenchFramePortal";
import { WorkbenchFrameTreeContext } from "./workbenchFrameTreeReport";
import { WorkbenchEditorTabsPortalProvider } from "./workbenchEditorTabsPortal";
import {
  WORKBENCH_FRAME_BOTTOM_PANEL_VARIABLE,
  WORKBENCH_FRAME_RIGHT_PANEL_VARIABLE,
  workbenchFrameTreeState,
  type WorkbenchShellPlacement,
} from "./workbenchShellPlacement";

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
  const [treeReportedVisible, setTreeReportedVisible] = useState(false);
  const [frameElement, setFrameElement] = useState<HTMLDivElement | null>(null);
  const style = {
    [WORKBENCH_FRAME_RIGHT_PANEL_VARIABLE]: `${placement.rightPanelWidth}px`,
    [WORKBENCH_FRAME_BOTTOM_PANEL_VARIABLE]: `${placement.bottomPanelHeight}px`,
  } as CSSProperties;

  return (
    <section className="editor-workbench" data-layout={placement.layout} style={style}>
      {chrome}
      <div
        className="workbench-frame"
        data-agent-variant={agentVariant}
        data-layout={placement.layout}
        data-rail={placement.rail}
        data-right-panel={placement.rightPanelMaximized ? "maximized" : "docked"}
        data-tree={workbenchFrameTreeState(placement, treeReportedVisible)}
        ref={setFrameElement}
      >
        <WorkbenchEditorTabsPortalProvider>
          <WorkbenchFramePortalContext.Provider value={frameElement}>
            <WorkbenchFrameTreeContext.Provider value={setTreeReportedVisible}>
              {agent}
            </WorkbenchFrameTreeContext.Provider>
          </WorkbenchFramePortalContext.Provider>
          <div
            aria-hidden={placement.editorHidden || undefined}
            className="editor-mode-surface"
            data-slot="editor"
            hidden={placement.editorHidden}
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
