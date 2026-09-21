import { useLayoutEffect, useRef } from "react";

/** Hiding a focused terminal returns typing to the same mounted composer. */
export function useTerminalPanelFocusReturn(frame: HTMLElement | null, visible: boolean): void {
  const previous = useRef<{
    frame: HTMLElement | null;
    visible: boolean;
    prompt: HTMLTextAreaElement | null;
  }>({ frame: null, visible: false, prompt: null });
  useLayoutEffect(() => {
    const prompt = frame?.querySelector<HTMLTextAreaElement>("#agent-prompt") ?? null;
    const old = previous.current;
    previous.current = { frame, visible, prompt };
    if (visible || !old.visible || old.frame !== frame || old.prompt !== prompt) return;
    const active = document.activeElement;
    const terminalOwnsFocus =
      active === document.body ||
      (active instanceof Element && frame?.querySelector('[data-slot="bottom"]')?.contains(active));
    if (terminalOwnsFocus && prompt?.isConnected && !prompt.disabled) {
      prompt.focus({ preventScroll: true });
    }
  }, [frame, visible]);
}
