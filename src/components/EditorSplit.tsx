import { useEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import {
  MIN_EDITOR_PANE_SIZE,
  clampEditorSplitSizes,
  type EditorSplitOrientation,
} from "../domain/editorLayout";

interface EditorSplitProps {
  children: [ReactNode, ReactNode];
  orientation: EditorSplitOrientation;
  sizes: readonly [number, number];
  splitPath: readonly number[];
  onResize(splitPath: readonly number[], sizes: readonly [number, number]): void;
}

export function EditorSplit({
  children,
  orientation,
  sizes,
  splitPath,
  onResize,
}: EditorSplitProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const firstSize = clampEditorSplitSizes(sizes)[0];

  useEffect(() => () => dragCleanupRef.current?.(), []);

  function resize(nextFirstSize: number) {
    const nextSizes = clampEditorSplitSizes([nextFirstSize, 1 - nextFirstSize]);
    onResize(splitPath, nextSizes);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const direction = orientation === "horizontal"
      ? event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0
      : event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (event.key === "Home") {
      event.preventDefault();
      resize(MIN_EDITOR_PANE_SIZE);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      resize(1 - MIN_EDITOR_PANE_SIZE);
      return;
    }
    if (direction === 0) {
      return;
    }
    event.preventDefault();
    resize(firstSize + direction * (event.shiftKey ? 0.1 : 0.02));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragCleanupRef.current?.();

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const bounds = rootRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }
      const length = orientation === "horizontal" ? bounds.width : bounds.height;
      if (length <= 0) {
        return;
      }
      const offset = orientation === "horizontal"
        ? moveEvent.clientX - bounds.left
        : moveEvent.clientY - bounds.top;
      resize(offset / length);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }

  const gridTemplate = `${firstSize}fr auto ${1 - firstSize}fr`;
  return (
    <div
      className={`editor-split editor-split-${orientation}`}
      data-split-path={splitPath.join(".")}
      ref={rootRef}
      style={{
        display: "grid",
        gridTemplateColumns: orientation === "horizontal" ? gridTemplate : undefined,
        gridTemplateRows: orientation === "vertical" ? gridTemplate : undefined,
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        width: "100%",
      }}
    >
      <div className="editor-split-pane" style={{ minHeight: 0, minWidth: 0, overflow: "hidden" }}>{children[0]}</div>
      <div
        aria-label={`Resize ${orientation} editor split`}
        aria-orientation={orientation === "horizontal" ? "vertical" : "horizontal"}
        aria-valuemax={(1 - MIN_EDITOR_PANE_SIZE) * 100}
        aria-valuemin={MIN_EDITOR_PANE_SIZE * 100}
        aria-valuenow={Math.round(firstSize * 100)}
        className="editor-split-resizer"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        role="separator"
        style={{
          cursor: orientation === "horizontal" ? "col-resize" : "row-resize",
          height: orientation === "horizontal" ? "100%" : 4,
          touchAction: "none",
          width: orientation === "horizontal" ? 4 : "100%",
        }}
        tabIndex={0}
      />
      <div className="editor-split-pane" style={{ minHeight: 0, minWidth: 0, overflow: "hidden" }}>{children[1]}</div>
    </div>
  );
}
