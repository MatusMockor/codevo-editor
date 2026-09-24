import { useEffect, useState, type RefObject } from "react";

export function useRestoreFocus(fallbackRef?: RefObject<HTMLElement | null>): void {
  const [previous] = useState<Element | null>(() => document.activeElement);
  useEffect(
    () => () => {
      const target = restoreTarget(previous, fallbackRef?.current ?? null);
      if (target === null) return;
      target.focus();
    },
    [fallbackRef, previous],
  );
}

function restoreTarget(previous: Element | null, fallback: HTMLElement | null): HTMLElement | null {
  if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) {
    return previous;
  }
  if (fallback === null || !fallback.isConnected) return null;
  return fallback;
}
