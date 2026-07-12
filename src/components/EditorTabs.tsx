import { Circle, X } from "lucide-react";
import { memo, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import type { MouseEvent } from "react";
import type { EditorDocument, ImageTab } from "../domain/workspace";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import {
  gitStatusLabel,
  gitStatusTitle,
  type GitChangeStatus,
} from "../domain/git";
import { isDirty } from "../domain/workspace";
import type { TabDropPosition } from "../domain/tabOrdering";
import { getTabId, getTabPanelId } from "./tabIds";
import {
  hasEditorTabDragType,
  readEditorTabDragPayload,
  writeEditorTabDragPayload,
} from "./editorTabDrag";

export interface EditorTabsProps {
  documents: Array<EditorDocument | ImageTab | MarkdownPreviewTab>;
  fileStatusesByPath?: Record<string, GitChangeStatus>;
  activePath: string | null;
  previewPath: string | null;
  groupId?: string;
  projectId?: string;
  onActivate(path: string): void;
  onClose(path: string): void;
  onPin(path: string): void;
  onReorder?(
    fromPath: string,
    toPath: string,
    position: TabDropPosition,
  ): void;
  onMove?(fromGroupId: string, toGroupId: string, path: string): void;
}

function EditorTabsComponent({
  documents,
  fileStatusesByPath,
  activePath,
  previewPath,
  groupId,
  projectId = "default",
  onActivate,
  onClose,
  onPin,
  onReorder,
  onMove,
}: EditorTabsProps) {
  const [dropTarget, setDropTarget] = useState<{
    path: string;
    position: TabDropPosition;
  } | null>(null);

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLButtonElement>) {
    const nextIndex = getNextTabIndex(index, documents.length, event.key);

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextDocument = documents[nextIndex];
    onActivate(nextDocument.path);
    requestAnimationFrame(() => {
      document.getElementById(getTabId(nextDocument.path, groupId))?.focus();
    });
  }

  function handleAuxClick(
    path: string,
    event: MouseEvent<HTMLDivElement>,
  ) {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onClose(path);
  }

  function handleDragStart(path: string, event: DragEvent<HTMLDivElement>) {
    if (path === previewPath) {
      onPin(path);
    }
    writeEditorTabDragPayload(event.dataTransfer, {
      path,
      projectId,
      sourceGroupId: groupId ?? "editor-main",
    });
  }

  function handleDragOver(path: string, event: DragEvent<HTMLDivElement>) {
    if (!hasEditorTabDragType(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const position = dropPosition(event);
    setDropTarget({ path, position });
  }

  function handleDrop(path: string, event: DragEvent<HTMLDivElement>) {
    const payload = readEditorTabDragPayload(event.dataTransfer, projectId);
    setDropTarget(null);

    if (!payload) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const targetGroupId = groupId ?? "editor-main";
    if (payload.sourceGroupId !== targetGroupId) {
      onMove?.(payload.sourceGroupId, targetGroupId, payload.path);
      return;
    }
    if (payload.path === path) {
      return;
    }
    onReorder?.(payload.path, path, dropPosition(event));
  }

  function handleStripDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasEditorTabDragType(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleStripDrop(event: DragEvent<HTMLDivElement>) {
    const payload = readEditorTabDragPayload(event.dataTransfer, projectId);
    const targetGroupId = groupId ?? "editor-main";
    if (!payload || payload.sourceGroupId === targetGroupId) {
      return;
    }
    event.preventDefault();
    onMove?.(payload.sourceGroupId, targetGroupId, payload.path);
  }

  return (
    <div
      aria-label="Open files"
      className={`editor-tabs${documents.length === 0 ? " empty" : ""}`}
      onDragOver={handleStripDragOver}
      onDrop={handleStripDrop}
      role="tablist"
    >
      {documents.map((document, index) => {
        const dirty = isEditorDocument(document) && isDirty(document);
        const active = document.path === activePath;
        const preview = document.path === previewPath && !dirty;
        const status = fileStatusesByPath?.[document.path];

        return (
          <div
            className={getEditorTabClassName(
              active,
              preview,
              dirty,
              dropTarget?.path === document.path
                ? dropTarget.position
                : null,
            )}
            draggable
            key={document.path}
            onAuxClick={(event) => handleAuxClick(document.path, event)}
            onDragEnd={() => setDropTarget(null)}
            onDragLeave={() => setDropTarget(null)}
            onDragOver={(event) => handleDragOver(document.path, event)}
            onDragStart={(event) => handleDragStart(document.path, event)}
            onDrop={(event) => handleDrop(document.path, event)}
          >
            <button
              aria-controls={getTabPanelId(document.path, groupId)}
              aria-selected={active}
              className="tab-main"
              id={getTabId(document.path, groupId)}
              onDoubleClick={() => onPin(document.path)}
              onKeyDown={(event) => handleKeyDown(index, event)}
              onClick={() => onActivate(document.path)}
              role="tab"
              tabIndex={active ? 0 : -1}
              title={document.path}
              type="button"
            >
              {dirty ? (
                <Circle aria-hidden="true" className="dirty-dot" size={8} />
              ) : null}
              <span className="tab-name">{document.name}</span>
              {status ? (
                <span
                  aria-label={gitStatusTitle(status)}
                  className={getEditorTabStatusClassName(
                    status,
                  )}
                >
                  {gitStatusLabel(status)}
                </span>
              ) : null}
            </button>
            <button
              aria-label={`Close ${document.name}`}
              className="tab-close"
              onClick={() => onClose(document.path)}
              title="Close"
              type="button"
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function isEditorDocument(
  tab: EditorDocument | ImageTab | MarkdownPreviewTab,
): tab is EditorDocument {
  return "savedContent" in tab;
}

export const EditorTabs = memo(EditorTabsComponent);

function getNextTabIndex(
  currentIndex: number,
  tabCount: number,
  key: string,
): number | null {
  if (key === "ArrowLeft") {
    return currentIndex === 0 ? tabCount - 1 : currentIndex - 1;
  }

  if (key === "ArrowRight") {
    return currentIndex === tabCount - 1 ? 0 : currentIndex + 1;
  }

  if (key === "Home") {
    return 0;
  }

  if (key === "End") {
    return tabCount - 1;
  }

  return null;
}

function getEditorTabClassName(
  active: boolean,
  preview: boolean,
  dirty: boolean,
  dropPosition: TabDropPosition | null,
): string {
  const classNames = ["editor-tab"];

  if (active) {
    classNames.push("active");
  }

  if (preview) {
    classNames.push("preview");
  }

  if (dirty) {
    classNames.push("changed");
  }

  if (dropPosition) {
    classNames.push(`drop-${dropPosition}`);
  }

  return classNames.join(" ");
}

function dropPosition(event: DragEvent<HTMLDivElement>): TabDropPosition {
  const bounds = event.currentTarget.getBoundingClientRect();

  if (event.clientX < bounds.left + bounds.width / 2) {
    return "before";
  }

  return "after";
}

function getEditorTabStatusClassName(status: GitChangeStatus): string {
  if (status === "added" || status === "renamed") {
    return "editor-tab-status editor-tab-status-added";
  }

  if (status === "modified") {
    return "editor-tab-status editor-tab-status-modified";
  }

  return `editor-tab-status editor-tab-status-${status}`;
}
