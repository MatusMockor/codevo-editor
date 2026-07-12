import type { ReactNode } from "react";
import type { EditorGroup, EditorGroupId } from "../domain/editorGroups";
import { visibleEditorPaths, type EditorDocument, type ImageTab } from "../domain/workspace";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import type { TabDropPosition } from "../domain/tabOrdering";
import { EditorTabs } from "./EditorTabs";
import { getTabId, getTabPanelId } from "./tabIds";

export type EditorGroupDocument = EditorDocument | ImageTab | MarkdownPreviewTab;
export type EditorGroupSurface =
  | { kind: "empty" }
  | { kind: "document"; document: EditorGroupDocument; path: string };

export interface EditorGroupViewProps {
  active: boolean;
  documents: readonly EditorGroupDocument[];
  fileStatusesByPath?: React.ComponentProps<typeof EditorTabs>["fileStatusesByPath"];
  group: EditorGroup;
  groupId: EditorGroupId;
  projectId: string;
  onActivateGroup(groupId: EditorGroupId): void;
  onActivateTab(groupId: EditorGroupId, path: string): void;
  onCloseTab(groupId: EditorGroupId, path: string): void;
  onMoveTab(fromGroupId: EditorGroupId, toGroupId: EditorGroupId, path: string): void;
  onPinTab(groupId: EditorGroupId, path: string): void;
  onReorderTab(groupId: EditorGroupId, fromPath: string, toPath: string, position: TabDropPosition): void;
  renderContent(surface: EditorGroupSurface, groupId: EditorGroupId): ReactNode;
}

export function EditorGroupView(props: EditorGroupViewProps) {
  const {
    active,
    documents,
    fileStatusesByPath,
    group,
    groupId,
    projectId,
    onActivateGroup,
    onActivateTab,
    onCloseTab,
    onMoveTab,
    onPinTab,
    onReorderTab,
    renderContent,
  } = props;
  const byPath = new Map(documents.map((document) => [document.path, document]));
  const groupDocuments = visibleEditorPaths(group.openPaths, group.previewPath)
    .flatMap((path) => {
      const document = byPath.get(path);
      return document ? [document] : [];
    });
  const activeDocument = group.activePath ? byPath.get(group.activePath) : undefined;
  const surface: EditorGroupSurface = activeDocument && group.activePath
    ? { kind: "document", document: activeDocument, path: group.activePath }
    : { kind: "empty" };

  function activateGroup() {
    if (active) {
      return;
    }
    onActivateGroup(groupId);
  }

  return (
    <section
      className={`editor-group${active ? " active" : ""}`}
      data-editor-group-id={groupId}
      onFocusCapture={activateGroup}
      onPointerDown={activateGroup}
      style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0 }}
    >
      <EditorTabs
        activePath={group.activePath}
        documents={groupDocuments}
        fileStatusesByPath={fileStatusesByPath}
        groupId={groupId}
        onActivate={(path) => onActivateTab(groupId, path)}
        onClose={(path) => onCloseTab(groupId, path)}
        onMove={onMoveTab}
        onPin={(path) => onPinTab(groupId, path)}
        onReorder={(fromPath, toPath, position) => onReorderTab(groupId, fromPath, toPath, position)}
        previewPath={group.previewPath}
        projectId={projectId}
      />
      <div
        aria-labelledby={activeDocument && group.activePath ? getTabId(group.activePath, groupId) : undefined}
        className="editor-panel"
        id={activeDocument && group.activePath ? getTabPanelId(group.activePath, groupId) : undefined}
        role="tabpanel"
        style={{ flex: 1, minHeight: 0, minWidth: 0 }}
      >
        {renderContent(surface, groupId)}
      </div>
    </section>
  );
}
