import type { EditorDrawerView } from "../../domain/editorDrawer";
import { dockedTextSearchProps } from "../dockedTextSearchProps";
import { PhpTreePanel } from "../PhpTreePanel";
import { TextSearch } from "../TextSearch";
import type { WorkbenchBottomPanelHostProps } from "../WorkbenchBottomPanelHost";
import { workbenchBottomPanelHostProps } from "../workbenchBottomPanelHostPresenter";
import type { EditorDrawerFrame } from "./EditorPanelLayout";
import { WorkbenchEditorDrawer } from "./WorkbenchEditorDrawer";

export interface WorkbenchEditorDrawerHostProps extends WorkbenchBottomPanelHostProps {
  readonly view: EditorDrawerView;
  readonly frame: EditorDrawerFrame;
}

export function WorkbenchEditorDrawerHost({
  frame,
  onSetDockedTextSearchOpen,
  view,
  workbench,
  ...input
}: WorkbenchEditorDrawerHostProps) {
  const search = (
    <TextSearch {...dockedTextSearchProps({ setOpen: onSetDockedTextSearchOpen, workbench })} />
  );
  const panel = workbenchBottomPanelHostProps({
    ...input,
    onCloseSearch: () => onSetDockedTextSearchOpen(false),
    search,
    workbench,
  });
  const phpTree =
    view === "phpTree" ? (
      <PhpTreePanel
        activePath={workbench.activePath}
        expandedNodeIds={workbench.phpTreeExpandedNodeIds}
        isLoading={workbench.phpTreeLoading}
        onOpenNode={workbench.openPhpTreeNode}
        onToggleNode={workbench.togglePhpTreeNode}
        rootPath={workbench.workspaceRoot}
        tree={workbench.phpTree}
      />
    ) : null;
  return <WorkbenchEditorDrawer frame={frame} panel={panel} phpTree={phpTree} view={view} />;
}
