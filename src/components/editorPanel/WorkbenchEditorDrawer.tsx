import { ShieldCheck, X } from "lucide-react";
import type { ReactNode } from "react";
import type { EditorDrawerView } from "../../domain/editorDrawer";
import { Button } from "../../ui/foundation/Button";
import { IconButton } from "../../ui/foundation/IconButton";
import { WorkbenchPanelViewContent, type WorkbenchPanelProps } from "../workbenchPanelViews";
import { workbenchPanelViewContentProps } from "../workbenchPanelViewProps";
import { EditorDrawer } from "./EditorDrawer";
import type { EditorDrawerFrame } from "./EditorPanelLayout";
import {
  editorDrawerAvailabilityFromPanel,
  effectiveEditorDrawerView,
} from "./workbenchDrawerAvailability";

export interface WorkbenchEditorDrawerProps {
  readonly panel: WorkbenchPanelProps;
  readonly view: EditorDrawerView;
  readonly frame: EditorDrawerFrame;
  readonly consoleHeader: ReactNode;
  readonly phpTree: ReactNode;
}

export function WorkbenchEditorDrawer({
  consoleHeader,
  frame,
  panel,
  phpTree,
  view,
}: WorkbenchEditorDrawerProps) {
  const availability = editorDrawerAvailabilityFromPanel(panel, view);
  const effectiveView = effectiveEditorDrawerView(view, availability);
  return (
    <EditorDrawer
      availability={availability}
      headerExtras={drawerHeaderExtras(panel, effectiveView, consoleHeader)}
      height={frame.height}
      onClose={panel.onClose}
      onResize={frame.onResize}
      onSelectView={panel.onSelectView}
      problemCount={panel.notices.length}
      view={effectiveView}
    >
      {panel.search ? (
        <div className="cv-edrawer__search" hidden={effectiveView !== "search"}>
          {panel.search}
        </div>
      ) : null}
      <WorkbenchPanelViewContent
        {...workbenchPanelViewContentProps(panel, effectiveView, phpTree)}
      />
    </EditorDrawer>
  );
}

function drawerHeaderExtras(
  panel: WorkbenchPanelProps,
  view: EditorDrawerView,
  consoleHeader: ReactNode,
): ReactNode {
  if (view === "debug") return consoleHeader;
  if (view === "problems" && panel.notices.length > 0) {
    return (
      <IconButton
        icon={<X size={14} />}
        label="Clear problems"
        onClick={panel.onClearProblems}
        size="xs"
      />
    );
  }
  if (view === "symfony" && panel.workspaceRoot && !panel.workspaceTrusted) {
    return (
      <Button
        icon={<ShieldCheck size={14} />}
        onClick={panel.onTrustWorkspace}
        size="sm"
        title="Trust workspace"
        variant="ghost"
      >
        Trust
      </Button>
    );
  }
  return null;
}
