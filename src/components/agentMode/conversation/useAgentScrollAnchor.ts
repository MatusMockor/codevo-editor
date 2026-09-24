import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

const ROW_SELECTOR =
  "[data-agent-event], .agent-tool-row, .agent-activity-group, .agent-thought, .cv-work-row";

interface CapturedAnchor {
  readonly container: HTMLElement;
  readonly row: HTMLElement | null;
  readonly rowTop: number;
  readonly fallback: HTMLElement;
  readonly fallbackTop: number;
}

export interface AgentScrollAnchor {
  capture(from: HTMLElement, fallback?: HTMLElement): void;
  cancel(): void;
}

export function useAgentScrollAnchor(revision: unknown): AgentScrollAnchor {
  const captured = useRef<CapturedAnchor | null>(null);

  useLayoutEffect(() => {
    const anchor = captured.current;
    if (anchor === null) return;
    captured.current = null;
    const target = restoreTarget(anchor);
    if (target === null) return;
    const delta = target.element.getBoundingClientRect().top - target.top;
    if (!Number.isFinite(delta) || delta === 0) return;
    anchor.container.scrollTop += delta;
  }, [revision]);

  const capture = useCallback((from: HTMLElement, fallback: HTMLElement = from): void => {
    const container = from.closest<HTMLElement>(".agent-session__scroll");
    if (container === null) return;
    const scope = from.closest<HTMLElement>(".agent-turn__events") ?? from;
    const row = firstVisibleRow(scope, container.getBoundingClientRect().top, from);
    captured.current = {
      container,
      row,
      rowTop: row === null ? 0 : row.getBoundingClientRect().top,
      fallback,
      fallbackTop: fallback.getBoundingClientRect().top,
    };
  }, []);

  const cancel = useCallback((): void => {
    captured.current = null;
  }, []);

  return useMemo(() => ({ capture, cancel }), [capture, cancel]);
}

function firstVisibleRow(
  scope: HTMLElement,
  containerTop: number,
  from: HTMLElement,
): HTMLElement | null {
  for (const candidate of scope.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
    if (candidate === from || candidate.contains(from)) continue;
    if (candidate.getBoundingClientRect().bottom > containerTop) return candidate;
  }
  return null;
}

function restoreTarget(
  anchor: CapturedAnchor,
): { readonly element: HTMLElement; readonly top: number } | null {
  if (anchor.row !== null && anchor.row.isConnected)
    return { element: anchor.row, top: anchor.rowTop };
  if (anchor.fallback.isConnected) return { element: anchor.fallback, top: anchor.fallbackTop };
  return null;
}
