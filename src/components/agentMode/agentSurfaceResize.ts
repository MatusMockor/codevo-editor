import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  AGENT_RIGHT_PANEL_WIDTH_VARIABLE,
  AGENT_WORKBENCH_SELECTOR,
  measureAgentRightPanel,
  type AgentRightPanelMeasurement,
} from "../../application/useWorkbenchResizeHandles";
import {
  DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
  MAX_AGENT_RIGHT_PANEL_WIDTH,
  MIN_AGENT_RIGHT_PANEL_WIDTH,
  clampAgentRightPanelWidth,
  type AgentRailState,
} from "../../domain/agentWorkbenchLayout";

export const AGENT_PANEL_RESIZE_STEP = 16;

export function panelWidthForKey(key: string, width: number, max: number): number | null {
  const requested = requestedPanelWidth(key, width, max);
  if (requested === null) return null;
  return Math.min(Math.max(requested, MIN_AGENT_RIGHT_PANEL_WIDTH), max);
}

function requestedPanelWidth(key: string, width: number, max: number): number | null {
  if (key === "ArrowLeft") return width + AGENT_PANEL_RESIZE_STEP;
  if (key === "ArrowRight") return width - AGENT_PANEL_RESIZE_STEP;
  if (key === "Home") return MIN_AGENT_RIGHT_PANEL_WIDTH;
  if (key === "End") return max;
  if (key === "Enter" || key === " ") return DEFAULT_AGENT_RIGHT_PANEL_WIDTH;
  return null;
}

export interface AgentPanelKeyboardResizeOptions {
  readonly panelRef: RefObject<HTMLElement | null>;
  readonly savedWidth: number;
  readonly rail: AgentRailState | undefined;
  readonly railWidth: number | undefined;
  readonly disabled: boolean;
  readonly onCommit: ((width: number) => void) | undefined;
}

export interface AgentPanelKeyboardResize {
  readonly valueNow: number;
  readonly valueMax: number;
  onFocus(): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
  onKeyUp(): void;
  onBlur(): void;
}

interface PendingResize {
  readonly frame: HTMLElement | null;
  readonly width: number;
}

export function useAgentPanelKeyboardResize({
  disabled,
  onCommit,
  panelRef,
  rail,
  railWidth,
  savedWidth,
}: AgentPanelKeyboardResizeOptions): AgentPanelKeyboardResize {
  const [measured, setMeasured] = useState<AgentRightPanelMeasurement | null>(null);
  const pendingRef = useRef<PendingResize | null>(null);

  const measure = useCallback((): AgentRightPanelMeasurement | null => {
    const panel = panelRef.current;
    if (panel === null) return null;
    return measureAgentRightPanel(panel, savedWidth, rail, railWidth);
  }, [panelRef, rail, railWidth, savedWidth]);

  const refresh = useCallback(() => {
    if (pendingRef.current !== null) return;
    const next = measure();
    setMeasured((current) => (sameMeasurement(current, next) ? current : next));
  }, [measure]);

  useLayoutEffect(() => {
    refresh();
    window.addEventListener("resize", refresh);
    return () => window.removeEventListener("resize", refresh);
  }, [disabled, refresh]);

  useEffect(() => {
    const pendingHolder = pendingRef;
    return () => {
      const pending = pendingHolder.current;
      pendingHolder.current = null;
      pending?.frame?.style.removeProperty(AGENT_RIGHT_PANEL_WIDTH_VARIABLE);
    };
  }, []);

  const commit = (): void => {
    const pending = pendingRef.current;
    if (pending === null) return;
    pendingRef.current = null;
    pending.frame?.style.removeProperty(AGENT_RIGHT_PANEL_WIDTH_VARIABLE);
    onCommit?.(clampAgentRightPanelWidth(pending.width));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (disabled || onCommit === undefined) return;
    const current = measure();
    if (current === null) return;
    const start = pendingRef.current?.width ?? current.width;
    const next = panelWidthForKey(event.key, start, current.max);
    if (next === null) return;
    event.preventDefault();
    const frame = event.currentTarget.closest<HTMLElement>(AGENT_WORKBENCH_SELECTOR);
    frame?.style.setProperty(AGENT_RIGHT_PANEL_WIDTH_VARIABLE, `${next}px`);
    pendingRef.current = { frame, width: next };
    setMeasured({ width: next, max: current.max });
  };

  return {
    valueNow: measured?.width ?? savedWidth,
    valueMax: measured?.max ?? MAX_AGENT_RIGHT_PANEL_WIDTH,
    onFocus: refresh,
    onKeyDown,
    onKeyUp: commit,
    onBlur: commit,
  };
}

function sameMeasurement(
  left: AgentRightPanelMeasurement | null,
  right: AgentRightPanelMeasurement | null,
): boolean {
  return left?.width === right?.width && left?.max === right?.max;
}
