import { useLayoutEffect, useRef, type RefObject } from "react";

export function useAgentComposerPanelFocus(panelRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.closest("[hidden]") === null) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [panelRef]);
}

export function useAgentComposerFocusReturn(
  interactionActive: boolean,
  containerRef: RefObject<HTMLElement | null>,
  promptRef: RefObject<HTMLTextAreaElement | null>,
): void {
  const wasActive = useRef(interactionActive);
  useLayoutEffect(() => {
    const ended = wasActive.current && !interactionActive;
    wasActive.current = interactionActive;
    if (!ended) return;
    const active = document.activeElement;
    const released =
      active === null ||
      active === document.body ||
      containerRef.current?.contains(active) === true;
    if (!released) return;
    promptRef.current?.focus({ preventScroll: true });
  }, [interactionActive, containerRef, promptRef]);
}
