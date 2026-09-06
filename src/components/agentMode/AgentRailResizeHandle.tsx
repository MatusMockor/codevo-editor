import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import {
  MAX_AGENT_RAIL_WIDTH,
  MIN_AGENT_RAIL_WIDTH,
  clampAgentRailWidth,
} from "../../domain/agentWorkbenchLayout";
import { AGENT_WORKBENCH_SELECTOR } from "../../application/useWorkbenchResizeHandles";
import {
  AGENT_RAIL_RESIZE_LABEL,
  AGENT_RAIL_WIDTH_VARIABLE,
  railWidthForKey,
} from "./agentRailResize";

export interface AgentRailResizeHandleProps {
  readonly width: number;
  onResize(width: number): void;
  onReset(): void;
}

interface RailDrag {
  readonly pointerId: number;
  readonly clientX: number;
  readonly startWidth: number;
  readonly frame: HTMLElement | null;
  width: number;
}

export function AgentRailResizeHandle({ onReset, onResize, width }: AgentRailResizeHandleProps) {
  const dragRef = useRef<RailDrag | null>(null);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const settle = useCallback((commit: boolean) => {
    const drag = dragRef.current;
    if (drag === null) return;
    dragRef.current = null;
    drag.frame?.style.removeProperty(AGENT_RAIL_WIDTH_VARIABLE);
    if (!commit || drag.width === drag.startWidth) return;
    onResizeRef.current(drag.width);
  }, []);

  useEffect(() => {
    const abandon = () => settle(true);
    window.addEventListener("blur", abandon);
    return () => {
      window.removeEventListener("blur", abandon);
      settle(false);
    };
  }, [settle]);

  const startDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startWidth = clampAgentRailWidth(width);
      dragRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        startWidth,
        frame: event.currentTarget.closest<HTMLElement>(AGENT_WORKBENCH_SELECTOR),
        width: startWidth,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [width],
  );

  const moveDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId) return;
      if (event.buttons === 0) {
        releaseCapture(event);
        settle(true);
        return;
      }
      drag.width = clampAgentRailWidth(drag.startWidth + (event.clientX - drag.clientX));
      drag.frame?.style.setProperty(AGENT_RAIL_WIDTH_VARIABLE, `${drag.width}px`);
    },
    [settle],
  );

  const endDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId) return;
      releaseCapture(event);
      settle(event.type !== "pointercancel");
    },
    [settle],
  );

  const resetWidth = useCallback(() => {
    settle(false);
    onReset();
  }, [onReset, settle]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const next = railWidthForKey(event.key, width);
      if (next === null) return;
      event.preventDefault();
      onResize(next);
    },
    [onResize, width],
  );

  return (
    <div
      aria-label={AGENT_RAIL_RESIZE_LABEL}
      aria-orientation="vertical"
      aria-valuemax={MAX_AGENT_RAIL_WIDTH}
      aria-valuemin={MIN_AGENT_RAIL_WIDTH}
      aria-valuenow={clampAgentRailWidth(width)}
      className="agent-rail-resize"
      onDoubleClick={resetWidth}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      role="separator"
      tabIndex={0}
    />
  );
}

function releaseCapture(event: PointerEvent<HTMLDivElement>): void {
  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
  event.currentTarget.releasePointerCapture(event.pointerId);
}
