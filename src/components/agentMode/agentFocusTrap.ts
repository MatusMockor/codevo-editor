import type { KeyboardEvent, RefObject } from "react";

export function trapTab(
  event: KeyboardEvent<HTMLElement>,
  refs: ReadonlyArray<RefObject<HTMLButtonElement | null>>,
): void {
  const controls = refs.map((ref) => ref.current).filter(isControl);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (first === undefined || last === undefined) return;
  const active = document.activeElement;
  const inside = active !== event.currentTarget && event.currentTarget.contains(active);
  if (event.shiftKey && (active === first || !inside)) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && (active === last || !inside)) {
    event.preventDefault();
    first.focus();
  }
}

function isControl(element: HTMLButtonElement | null): element is HTMLButtonElement {
  return element !== null;
}
