import { useCallback, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import {
  DEFAULT_AGENT_APPEARANCE_VARIANT,
  type AgentAppearanceVariant,
} from "../domain/agentSettings";
import { WorkbenchFramePortalContext } from "./workbenchFramePortal";
import { WorkbenchFrameTreeContext } from "./workbenchFrameTreeReport";
import {
  EMPTY_WORKBENCH_FRAME_EDITOR_REPORTS,
  WorkbenchFrameEditorContext,
  nextWorkbenchFrameEditorReports,
  workbenchFrameEditorState,
  type WorkbenchFrameEditorReporter,
  type WorkbenchFrameEditorReports,
} from "./workbenchFrameEditorReport";
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

export type WorkbenchShellSurface = "workbench" | "settings";

export interface WorkbenchShellFrameProps {
  readonly placement: WorkbenchShellPlacement;
  readonly agentVariant?: AgentAppearanceVariant;
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
  agentVariant = DEFAULT_AGENT_APPEARANCE_VARIANT,
  bottom,
  chrome,
  editor,
  placement,
  settings = null,
  settingsRef,
  surface = "workbench",
}: WorkbenchShellFrameProps) {
  const settingsSurface = surface === "settings";
  const [workbenchElement, setWorkbenchElement] = useState<HTMLElement | null>(null);
  const viewportWidth = useViewportWidth(workbenchElement);
  const responsivePlacement = responsiveWorkbenchShellPlacement(placement, viewportWidth);
  const [treeReportedVisible, setTreeReportedVisible] = useState(false);
  const [editorReports, setEditorReports] = useState<WorkbenchFrameEditorReports>(
    EMPTY_WORKBENCH_FRAME_EDITOR_REPORTS,
  );
  const reportEditor = useCallback<WorkbenchFrameEditorReporter>((key, state) => {
    setEditorReports((current) => nextWorkbenchFrameEditorReports(current, key, state));
  }, []);
  const [frameElement, setFrameElement] = useState<HTMLDivElement | null>(null);
  const editorHidden = responsivePlacement.editorHidden || settingsSurface;
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
      <div className="workbench-frame__chrome" data-slot="chrome" hidden={settingsSurface}>
        {chrome}
      </div>
      <div
        className="workbench-frame"
        data-agent-variant={agentVariant}
        data-editor={workbenchFrameEditorState(editorReports)}
        data-layout={responsivePlacement.layout}
        data-rail={responsivePlacement.rail}
        data-right-panel={responsivePlacement.rightPanelMaximized ? "maximized" : "docked"}
        data-surface={settingsSurface ? "settings" : undefined}
        data-tree={workbenchFrameTreeState(responsivePlacement, treeReportedVisible)}
        ref={setFrameElement}
      >
        <WorkbenchEditorTabsPortalProvider>
          <WorkbenchFrameEditorContext.Provider value={reportEditor}>
            <WorkbenchFramePortalContext.Provider value={frameElement}>
              <WorkbenchFrameTreeContext.Provider value={setTreeReportedVisible}>
                <WorkbenchFrameResponsiveContext.Provider
                  value={responsivePlacement.responsiveRestore}
                >
                  {agent}
                </WorkbenchFrameResponsiveContext.Provider>
              </WorkbenchFrameTreeContext.Provider>
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
        </WorkbenchEditorTabsPortalProvider>
      </div>
    </section>
  );
}
