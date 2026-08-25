import { useState, type CSSProperties, type ReactNode } from "react";
import { WorkbenchFrameTreeContext } from "./workbenchFrameTreeReport";
import {
  WORKBENCH_FRAME_BOTTOM_PANEL_VARIABLE,
  WORKBENCH_FRAME_RIGHT_PANEL_VARIABLE,
  workbenchFrameTreeState,
  type WorkbenchShellPlacement,
} from "./workbenchShellPlacement";

export interface WorkbenchShellFrameProps {
  readonly placement: WorkbenchShellPlacement;
  readonly chrome: ReactNode;
  readonly agent: ReactNode;
  readonly editor: ReactNode;
  readonly bottom: ReactNode;
}

export function WorkbenchShellFrame({
  agent,
  bottom,
  chrome,
  editor,
  placement,
}: WorkbenchShellFrameProps) {
  const [treeReportedVisible, setTreeReportedVisible] = useState(false);
  const style = {
    [WORKBENCH_FRAME_RIGHT_PANEL_VARIABLE]: `${placement.rightPanelWidth}px`,
    [WORKBENCH_FRAME_BOTTOM_PANEL_VARIABLE]: `${placement.bottomPanelHeight}px`,
  } as CSSProperties;

  return (
    <section className="editor-workbench" data-layout={placement.layout} style={style}>
      {chrome}
      <div
        className="workbench-frame"
        data-layout={placement.layout}
        data-tree={workbenchFrameTreeState(placement, treeReportedVisible)}
      >
        <WorkbenchFrameTreeContext.Provider value={setTreeReportedVisible}>
          {agent}
        </WorkbenchFrameTreeContext.Provider>
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
      </div>
    </section>
  );
}
