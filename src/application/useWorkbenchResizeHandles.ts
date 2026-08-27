import { useCallback, useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import {
  MAX_AGENT_BOTTOM_PANEL_HEIGHT,
  MAX_AGENT_RIGHT_PANEL_WIDTH,
  MIN_AGENT_BOTTOM_PANEL_HEIGHT,
  MIN_AGENT_RIGHT_PANEL_WIDTH,
  clampAgentBottomPanelHeight,
  clampAgentRightPanelWidth,
  type AgentRailState,
  type AgentWorkbenchLayout,
} from "../domain/agentWorkbenchLayout";
import {
  AGENT_CENTER_MIN_WIDTH,
  agentWorkbenchRailWidth,
} from "../domain/agentWorkbenchResponsiveLayout";

export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 520;
export const DEFAULT_SIDEBAR_WIDTH = 300;
export const MIN_BOTTOM_PANEL_HEIGHT = 96;
export const MAX_BOTTOM_PANEL_HEIGHT = 520;
export const DEFAULT_BOTTOM_PANEL_HEIGHT = 152;
export const WORKBENCH_BOTTOM_PANEL_VIEWPORT_RATIO = 0.7;
export const AGENT_RIGHT_PANEL_VIEWPORT_RATIO = 0.7;
export const AGENT_BOTTOM_PANEL_VIEWPORT_RATIO = 0.75;
export const AGENT_WORKBENCH_SELECTOR = ".editor-workbench";
export const AGENT_RIGHT_PANEL_WIDTH_VARIABLE = "--agent-right-panel-width";
export const AGENT_BOTTOM_PANEL_HEIGHT_VARIABLE = "--agent-bottom-panel-height";

export interface AgentPanelResizeCommit {
  readonly layout: Pick<AgentWorkbenchLayout, "rail" | "rightPanelWidth" | "bottomPanelHeight">;
  onResizeRightPanel(width: number): void;
  onResizeBottomPanel(height: number): void;
}

export interface WorkbenchResizeHandles {
  readonly sidebarWidth: number;
  readonly bottomPanelHeight: number;
  readonly shellStyle: CSSProperties;
  startSidebarResize(event: PointerEvent<HTMLElement>): void;
  startBottomPanelResize(event: PointerEvent<HTMLElement>): void;
  startAgentRightPanelResize(event: PointerEvent<HTMLElement>): void;
  startAgentBottomPanelResize(event: PointerEvent<HTMLElement>): void;
}

export function maxWorkbenchBottomPanelHeight(viewportHeight: number): number {
  return Math.max(
    MIN_BOTTOM_PANEL_HEIGHT,
    Math.min(viewportHeight * WORKBENCH_BOTTOM_PANEL_VIEWPORT_RATIO, MAX_BOTTOM_PANEL_HEIGHT),
  );
}

export function maxAgentRightPanelWidth(
  viewportWidth: number,
  rail: AgentRailState = "expanded",
): number {
  const railWidth = agentWorkbenchRailWidth(rail, viewportWidth);
  const availableWidth = viewportWidth - railWidth - AGENT_CENTER_MIN_WIDTH;
  return Math.max(
    MIN_AGENT_RIGHT_PANEL_WIDTH,
    Math.min(
      viewportWidth * AGENT_RIGHT_PANEL_VIEWPORT_RATIO,
      availableWidth,
      MAX_AGENT_RIGHT_PANEL_WIDTH,
    ),
  );
}

export function maxAgentBottomPanelHeight(viewportHeight: number): number {
  return Math.max(
    MIN_AGENT_BOTTOM_PANEL_HEIGHT,
    Math.min(viewportHeight * AGENT_BOTTOM_PANEL_VIEWPORT_RATIO, MAX_AGENT_BOTTOM_PANEL_HEIGHT),
  );
}

export function useWorkbenchResizeHandles(
  agentPanels: AgentPanelResizeCommit,
): WorkbenchResizeHandles {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(DEFAULT_BOTTOM_PANEL_HEIGHT);

  const shellStyle = useMemo(
    () =>
      ({
        "--bottom-panel-height": `${bottomPanelHeight}px`,
        "--sidebar-width": `${sidebarWidth}px`,
      }) as CSSProperties,
    [bottomPanelHeight, sidebarWidth],
  );

  const startSidebarResize = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      startPointerDrag(event, (moveEvent) => {
        setSidebarWidth(
          clamp(startWidth + moveEvent.clientX - startX, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH),
        );
      });
    },
    [sidebarWidth],
  );

  const startBottomPanelResize = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const startY = event.clientY;
      const startHeight = bottomPanelHeight;
      startPointerDrag(event, (moveEvent) => {
        setBottomPanelHeight(
          clamp(
            startHeight + startY - moveEvent.clientY,
            MIN_BOTTOM_PANEL_HEIGHT,
            maxWorkbenchBottomPanelHeight(window.innerHeight),
          ),
        );
      });
    },
    [bottomPanelHeight],
  );

  const { onResizeBottomPanel, onResizeRightPanel } = agentPanels;
  const agentRightPanelWidth = agentPanels.layout.rightPanelWidth;
  const agentRail = agentPanels.layout.rail;
  const agentBottomPanelHeight = agentPanels.layout.bottomPanelHeight;

  const startAgentRightPanelResize = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const frame = agentWorkbenchFrame(event);
      const startX = event.clientX;
      const startWidth = agentRightPanelWidth;
      let width = startWidth;

      startPointerDrag(
        event,
        (moveEvent) => {
          width = clamp(
            startWidth + startX - moveEvent.clientX,
            MIN_AGENT_RIGHT_PANEL_WIDTH,
            maxAgentRightPanelWidth(frame?.clientWidth || window.innerWidth, agentRail),
          );
          frame?.style.setProperty(AGENT_RIGHT_PANEL_WIDTH_VARIABLE, `${width}px`);
        },
        () => {
          frame?.style.removeProperty(AGENT_RIGHT_PANEL_WIDTH_VARIABLE);
          onResizeRightPanel(clampAgentRightPanelWidth(width));
        },
      );
    },
    [agentRail, agentRightPanelWidth, onResizeRightPanel],
  );

  const startAgentBottomPanelResize = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const frame = agentWorkbenchFrame(event);
      const startY = event.clientY;
      const startHeight = agentBottomPanelHeight;
      let height = startHeight;

      startPointerDrag(
        event,
        (moveEvent) => {
          height = clamp(
            startHeight + startY - moveEvent.clientY,
            MIN_AGENT_BOTTOM_PANEL_HEIGHT,
            maxAgentBottomPanelHeight(window.innerHeight),
          );
          frame?.style.setProperty(AGENT_BOTTOM_PANEL_HEIGHT_VARIABLE, `${height}px`);
        },
        () => {
          frame?.style.removeProperty(AGENT_BOTTOM_PANEL_HEIGHT_VARIABLE);
          onResizeBottomPanel(clampAgentBottomPanelHeight(height));
        },
      );
    },
    [agentBottomPanelHeight, onResizeBottomPanel],
  );

  return {
    bottomPanelHeight,
    shellStyle,
    sidebarWidth,
    startAgentBottomPanelResize,
    startAgentRightPanelResize,
    startBottomPanelResize,
    startSidebarResize,
  };
}

function agentWorkbenchFrame(event: PointerEvent<HTMLElement>): HTMLElement | null {
  return event.currentTarget.closest<HTMLElement>(AGENT_WORKBENCH_SELECTOR);
}

function startPointerDrag(
  event: PointerEvent<HTMLElement>,
  onMove: (moveEvent: globalThis.PointerEvent) => void,
  onSettle?: () => void,
): void {
  event.preventDefault();

  const handlePointerMove = (moveEvent: globalThis.PointerEvent) => onMove(moveEvent);
  const stopResize = () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
    window.removeEventListener("blur", stopResize);
    onSettle?.();
  };

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("pointercancel", stopResize);
  window.addEventListener("blur", stopResize);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
