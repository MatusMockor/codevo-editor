import type { MouseEvent } from "react";

const TRANSCRIPT_SCROLL = ".agent-session__scroll";

export function releaseFocusAfterPointerPress(event: MouseEvent<HTMLElement>): void {
  const pressed = event.currentTarget;
  pressed.ownerDocument.addEventListener("mouseup", () => releaseFocus(pressed), {
    capture: true,
    once: true,
  });
}

function releaseFocus(pressed: HTMLElement): void {
  if (pressed.ownerDocument.activeElement !== pressed) return;
  const transcript = pressed.closest<HTMLElement>(TRANSCRIPT_SCROLL);
  if (transcript === null) {
    pressed.blur();
    return;
  }
  transcript.focus({ preventScroll: true });
  if (pressed.ownerDocument.activeElement === pressed) pressed.blur();
}
