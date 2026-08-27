import { useCallback, useSyncExternalStore } from "react";

const FALLBACK_VIEWPORT_WIDTH = 1280;

export function useViewportWidth(owner: Element | null): number {
  const subscribe = useCallback(
    (onChange: () => void) => subscribeToWidth(owner, onChange),
    [owner],
  );
  const snapshot = useCallback(() => elementWidth(owner), [owner]);
  return useSyncExternalStore(subscribe, snapshot, fallbackViewportWidth);
}

function subscribeToWidth(owner: Element | null, onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(onChange) : null;
  observer?.observe(owner ?? document.documentElement);
  return () => {
    observer?.disconnect();
    window.removeEventListener("resize", onChange);
  };
}

function elementWidth(owner: Element | null): number {
  return (owner ?? document.documentElement).clientWidth || window.innerWidth;
}

function fallbackViewportWidth(): number {
  return FALLBACK_VIEWPORT_WIDTH;
}
