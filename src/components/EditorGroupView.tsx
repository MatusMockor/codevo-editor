import { memo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { EditorGroup, EditorGroupId } from "../domain/editorGroups";
import { visibleEditorPaths, type EditorDocument, type ImageTab } from "../domain/workspace";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import type { TabDropPosition } from "../domain/tabOrdering";
import { EditorTabs } from "./EditorTabs";
import { getTabId, getTabPanelId } from "./tabIds";
import { useWorkbenchEditorTabsPortalTarget } from "./workbenchEditorTabsPortalContext";

export type EditorGroupDocument = EditorDocument | ImageTab | MarkdownPreviewTab;
export type EditorGroupSurface =
  { kind: "empty" } | { kind: "document"; document: EditorGroupDocument; path: string };

export interface EditorGroupViewProps {
  active: boolean;
  contentRevision?: unknown;
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
  onReorderTab(
    groupId: EditorGroupId,
    fromPath: string,
    toPath: string,
    position: TabDropPosition,
  ): void;
  renderContent(surface: EditorGroupSurface, groupId: EditorGroupId): ReactNode;
}

export const EditorGroupView = memo(function EditorGroupView(props: EditorGroupViewProps) {
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
  const groupDocuments = visibleEditorPaths(group.openPaths, group.previewPath).flatMap((path) => {
    const document = byPath.get(path);
    return document ? [document] : [];
  });
  const activeDocument = group.activePath ? byPath.get(group.activePath) : undefined;
  const groupElementRef = useRef<HTMLElement | null>(null);
  const editorTabsPortalTarget = useWorkbenchEditorTabsPortalTarget();
  const surface: EditorGroupSurface =
    activeDocument && group.activePath
      ? { kind: "document", document: activeDocument, path: group.activePath }
      : { kind: "empty" };

  function activateGroup() {
    if (active) {
      return;
    }
    onActivateGroup(groupId);
  }

  const tabs = (
    <EditorTabs
      activePath={group.activePath}
      documents={groupDocuments}
      fileStatusesByPath={fileStatusesByPath}
      groupId={groupId}
      groupElementRef={groupElementRef}
      onActivate={(path) => onActivateTab(groupId, path)}
      onClose={(path) => onCloseTab(groupId, path)}
      onMove={onMoveTab}
      onPin={(path) => onPinTab(groupId, path)}
      onReorder={(fromPath, toPath, position) => onReorderTab(groupId, fromPath, toPath, position)}
      previewPath={group.previewPath}
      projectId={projectId}
    />
  );

  return (
    <section
      className={`editor-group${active ? " active" : ""}`}
      data-editor-group-id={groupId}
      onFocusCapture={activateGroup}
      onPointerDown={activateGroup}
      ref={groupElementRef}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {active && editorTabsPortalTarget !== null
        ? createPortal(tabs, editorTabsPortalTarget)
        : tabs}
      <div
        aria-labelledby={
          activeDocument && group.activePath ? getTabId(group.activePath, groupId) : undefined
        }
        className="editor-panel"
        id={
          activeDocument && group.activePath ? getTabPanelId(group.activePath, groupId) : undefined
        }
        role="tabpanel"
        style={{ flex: 1, minHeight: 0, minWidth: 0 }}
      >
        {renderContent(surface, groupId)}
      </div>
    </section>
  );
}, editorGroupViewPropsEqual);

function editorGroupViewPropsEqual(
  previous: EditorGroupViewProps,
  next: EditorGroupViewProps,
): boolean {
  if (
    previous.active !== next.active ||
    previous.contentRevision !== next.contentRevision ||
    previous.group !== next.group ||
    previous.groupId !== next.groupId ||
    previous.projectId !== next.projectId ||
    previous.onActivateGroup !== next.onActivateGroup ||
    previous.onActivateTab !== next.onActivateTab ||
    previous.onCloseTab !== next.onCloseTab ||
    previous.onMoveTab !== next.onMoveTab ||
    previous.onPinTab !== next.onPinTab ||
    previous.onReorderTab !== next.onReorderTab
  ) {
    return false;
  }

  const visiblePaths = visibleEditorPaths(next.group.openPaths, next.group.previewPath);
  const previousDocuments = new Map(
    previous.documents.map((document) => [document.path, document]),
  );
  const nextDocuments = new Map(next.documents.map((document) => [document.path, document]));

  return visiblePaths.every(
    (path) =>
      previousDocuments.get(path) === nextDocuments.get(path) &&
      previous.fileStatusesByPath?.[path] === next.fileStatusesByPath?.[path],
  );
}
