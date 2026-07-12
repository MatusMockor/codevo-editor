import type { ReactNode } from "react";
import type { EditorGroupId, EditorGroupsState } from "../domain/editorGroups";
import type { TabDropPosition } from "../domain/tabOrdering";
import { EditorGroupView, type EditorGroupDocument, type EditorGroupSurface } from "./EditorGroupView";
import { EditorSplit } from "./EditorSplit";

export interface EditorAreaProps {
  documents: readonly EditorGroupDocument[];
  fileStatusesByPath?: React.ComponentProps<typeof EditorGroupView>["fileStatusesByPath"];
  projectId: string;
  state: EditorGroupsState;
  onActivateGroup(groupId: EditorGroupId): void;
  onActivateTab(groupId: EditorGroupId, path: string): void;
  onCloseTab(groupId: EditorGroupId, path: string): void;
  onMoveTab(fromGroupId: EditorGroupId, toGroupId: EditorGroupId, path: string): void;
  onPinTab(groupId: EditorGroupId, path: string): void;
  onReorderTab(groupId: EditorGroupId, fromPath: string, toPath: string, position: TabDropPosition): void;
  onResizeSplit(splitPath: readonly number[], sizes: readonly [number, number]): void;
  renderContent(surface: EditorGroupSurface, groupId: EditorGroupId): ReactNode;
}

export function EditorArea(props: EditorAreaProps) {
  function renderLayout(layout: EditorGroupsState["layout"], splitPath: readonly number[]): ReactNode {
    if (layout.kind === "group") {
      const group = props.state.groups[layout.groupId];
      if (!group) {
        return null;
      }
      return (
        <EditorGroupView
          key={layout.groupId}
          active={props.state.activeGroupId === layout.groupId}
          documents={props.documents}
          fileStatusesByPath={props.fileStatusesByPath}
          group={group}
          groupId={layout.groupId}
          onActivateGroup={props.onActivateGroup}
          onActivateTab={props.onActivateTab}
          onCloseTab={props.onCloseTab}
          onMoveTab={props.onMoveTab}
          onPinTab={props.onPinTab}
          onReorderTab={props.onReorderTab}
          projectId={props.projectId}
          renderContent={props.renderContent}
        />
      );
    }

    return (
      <EditorSplit
        key={`split-${splitPath.join("-") || "root"}`}
        onResize={props.onResizeSplit}
        orientation={layout.orientation}
        sizes={layout.sizes}
        splitPath={splitPath}
      >
        {[
          renderLayout(layout.children[0], [...splitPath, 0]),
          renderLayout(layout.children[1], [...splitPath, 1]),
        ]}
      </EditorSplit>
    );
  }

  return (
    <div className="editor-area" style={{ height: "100%", minHeight: 0, minWidth: 0, width: "100%" }}>
      {renderLayout(props.state.layout, [])}
    </div>
  );
}
