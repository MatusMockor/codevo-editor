import { useCallback, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { WorkbenchFrameBootContext, useWorkbenchFrameBooted } from "./workbenchFrameBootContext";
import { WorkbenchFramePortalContext } from "./workbenchFramePortal";
import {
  EMPTY_WORKBENCH_FRAME_EDITOR_REPORTS,
  WorkbenchFrameEditorContext,
  WorkbenchFrameEditorStateContext,
  nextWorkbenchFrameEditorReports,
  workbenchFrameEditorState,
  type WorkbenchFrameEditorReporter,
  type WorkbenchFrameEditorReports,
} from "./workbenchFrameEditorReport";
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
  readonly chrome: ReactNode;
  readonly agent: ReactNode;
  readonly editor: ReactNode;
  readonly bottom: ReactNode;
  readonly settings?: ReactNode;
  readonly settingsRef?: Ref<HTMLDivElement>;
  readonly surface?: WorkbenchShellSurface;
}

export function WorkbenchShellFrame({
  agent,
  bottom,
  chrome,
  editor,
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
  const [editorReports, setEditorReports] = useState<WorkbenchFrameEditorReports>(
    EMPTY_WORKBENCH_FRAME_EDITOR_REPORTS,
  );
  const reportEditor = useCallback<WorkbenchFrameEditorReporter>((key, state) => {
    setEditorReports((current) => nextWorkbenchFrameEditorReports(current, key, state));
  }, []);
  const [frameElement, setFrameElement] = useState<HTMLDivElement | null>(null);
  const frameHeight = useWorkbenchFrameHeight(frameElement);
  useTerminalPanelFocusReturn(
    settingsSurface ? null : frameElement,
    placement.bottomPanelHeight > 0,
  );
  const editorState = workbenchFrameEditorState(editorReports);
  const editorHidden = responsivePlacement.editorHidden || settingsSurface;
  const style = {
    [WORKBENCH_FRAME_RIGHT_PANEL_VARIABLE]: `${responsivePlacement.rightPanelWidth}px`,
    [WORKBENCH_FRAME_BOTTOM_PANEL_VARIABLE]: `${responsivePlacement.bottomPanelHeight}px`,
    [WORKBENCH_FRAME_RAIL_VARIABLE]: `${responsivePlacement.railWidth}px`,
  } as CSSProperties;

  return (
    <section
      className="editor-workbench"
      data-layout={responsivePlacement.layout}
      ref={setWorkbenchElement}
      style={style}
    >
      <div className="workbench-frame__chrome" data-slot="chrome" hidden={settingsSurface}>
        {chrome}
      </div>
      <div
        className="workbench-frame"
        style={{ "--agent-bottom-panel-limit": `${frameHeight * 0.75}px` } as CSSProperties}
        data-editor={editorState}
        data-layout={responsivePlacement.layout}
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
          <WorkbenchFrameEditorContext.Provider value={reportEditor}>
            <WorkbenchFramePortalContext.Provider value={frameElement}>
              <WorkbenchFrameEditorStateContext.Provider value={editorState}>
                <WorkbenchFrameResponsiveContext.Provider
                  value={responsivePlacement.responsiveRestore}
                >
                  {agent}
                </WorkbenchFrameResponsiveContext.Provider>
              </WorkbenchFrameEditorStateContext.Provider>
            </WorkbenchFramePortalContext.Provider>
            {settingsSurface ? (
              <div className="workbench-frame__settings" data-slot="settings" ref={settingsRef}>
                {settings}
              </div>
            ) : null}
            <div
              aria-hidden={editorHidden || undefined}
              className="editor-mode-surface"
              data-slot="editor"
              hidden={editorHidden}
            >
              {editor}
            </div>
            <div className="workbench-frame__bottom" data-slot="bottom" hidden={settingsSurface}>
              {bottom}
            </div>
          </WorkbenchFrameEditorContext.Provider>
        </WorkbenchFrameBootContext.Provider>
      </div>
    </section>
  );
}
