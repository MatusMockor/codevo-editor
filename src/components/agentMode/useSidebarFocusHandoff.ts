import { useLayoutEffect, useRef, type RefObject } from "react";
import type { AgentRailState } from "../../domain/agentWorkbenchLayout";
import { COLLAPSE_SIDEBAR_LABEL, EXPAND_SIDEBAR_LABEL } from "./AgentSidebarReveal";

export function useSidebarFocusHandoff(
  rail: AgentRailState,
  anchor: RefObject<HTMLElement | null>,
): void {
  const previous = useRef(rail);

  useLayoutEffect(() => {
    if (previous.current === rail) return;
    previous.current = rail;
    const doc = anchor.current?.ownerDocument;
    if (doc === undefined) return;
    const active = doc.activeElement;
    if (active !== null && active !== doc.body && active.isConnected) return;
    const label = rail === "collapsed" ? EXPAND_SIDEBAR_LABEL : COLLAPSE_SIDEBAR_LABEL;
    doc.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.focus();
  }, [anchor, rail]);
}
