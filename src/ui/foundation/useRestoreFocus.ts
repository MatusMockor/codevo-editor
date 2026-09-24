import { useEffect, useState, type RefObject } from "react";

export function useRestoreFocus(
  fallbackRef?: RefObject<HTMLElement | null>,
  containerRef?: RefObject<HTMLElement | null>,
): void {
  const [previous] = useState<Element | null>(() => document.activeElement);
  useEffect(() => {
    const container = containerRef?.current ?? null;
    const fallback = fallbackRef;
    return () => {
      if (!focusLeftWithSurface(container)) return;
      const target = restoreTarget(previous, fallback?.current ?? null);
      if (target === null) return;
      target.focus();
    };
  }, [containerRef, fallbackRef, previous]);
}

function focusLeftWithSurface(container: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (active === null || active === document.body) return true;
  if (container === null) return false;
  return container.contains(active);
}

function restoreTarget(previous: Element | null, fallback: HTMLElement | null): HTMLElement | null {
  if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) {
    return previous;
  }
  if (fallback === null || !fallback.isConnected) return null;
  return fallback;
}
