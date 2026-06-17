import { Circle, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { MouseEvent } from "react";
import type { EditorDocument } from "../domain/workspace";
import { isDirty } from "../domain/workspace";
import { getTabId, getTabPanelId } from "./tabIds";

interface EditorTabsProps {
  documents: EditorDocument[];
  activePath: string | null;
  previewPath: string | null;
  onActivate(path: string): void;
  onClose(path: string): void;
  onPin(path: string): void;
}

export function EditorTabs({
  documents,
  activePath,
  previewPath,
  onActivate,
  onClose,
  onPin,
}: EditorTabsProps) {
  if (documents.length === 0) {
    return <div className="editor-tabs empty" />;
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLButtonElement>) {
    const nextIndex = getNextTabIndex(index, documents.length, event.key);

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextDocument = documents[nextIndex];
    onActivate(nextDocument.path);
    requestAnimationFrame(() => {
      document.getElementById(getTabId(nextDocument.path))?.focus();
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

  return (
    <div aria-label="Open files" className="editor-tabs" role="tablist">
      {documents.map((document, index) => {
        const dirty = isDirty(document);
        const active = document.path === activePath;
        const preview = document.path === previewPath && !dirty;

        return (
          <div
            className={getEditorTabClassName(active, preview, dirty)}
            key={document.path}
            onAuxClick={(event) => handleAuxClick(document.path, event)}
          >
            <button
              aria-controls={getTabPanelId(document.path)}
              aria-selected={active}
              className="tab-main"
              id={getTabId(document.path)}
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
              <span>{document.name}</span>
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

  return classNames.join(" ");
}
