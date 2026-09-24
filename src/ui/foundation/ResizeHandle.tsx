import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "./classNames";
import "./panels.css";

export type ResizeEdge = "start" | "end";

export interface ResizeHandleProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly edge: ResizeEdge;
  readonly step?: number;
  onChange(value: number): void;
  onCommit?(value: number): void;
}

interface DragState {
  readonly originX: number;
  readonly originValue: number;
  last: number;
}

const DIRECTION: Readonly<Record<ResizeEdge, number>> = { start: -1, end: 1 };

export function ResizeHandle({
  edge,
  label,
  max,
  min,
  onChange,
  onCommit,
  step = 16,
  value,
}: ResizeHandleProps) {
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const direction = DIRECTION[edge];

  const apply = (next: number): number => {
    const clamped = clamp(next, min, max);
    onChange(clamped);
    return clamped;
  };
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    if (typeof target.setPointerCapture === "function") target.setPointerCapture(event.pointerId);
    dragRef.current = { originX: event.clientX, originValue: value, last: value };
    setDragging(true);
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null) return;
    drag.last = apply(drag.originValue + (event.clientX - drag.originX) * direction);
  };
  const finishDrag = (): void => {
    const drag = dragRef.current;
    if (drag === null) return;
    dragRef.current = null;
    setDragging(false);
    onCommit?.(drag.last);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = keyboardValue(event.key, value, min, max, step * direction * -1);
    if (next === null) return;
    event.preventDefault();
    onCommit?.(apply(next));
  };

  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className={cx("cv-resize", `cv-resize--${edge}`, dragging && "cv-resize--active")}
      onKeyDown={handleKeyDown}
      onPointerCancel={finishDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      role="separator"
      tabIndex={0}
    />
  );
}

function keyboardValue(
  key: string,
  value: number,
  min: number,
  max: number,
  leftStep: number,
): number | null {
  if (key === "ArrowLeft") return value + leftStep;
  if (key === "ArrowRight") return value - leftStep;
  if (key === "Home") return min;
  if (key === "End") return max;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
