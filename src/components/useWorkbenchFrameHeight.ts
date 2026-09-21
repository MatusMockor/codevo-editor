import { useCallback, useSyncExternalStore } from "react";

/** Observe the available workbench, excluding the window chrome and status bar. */
export function useWorkbenchFrameHeight(owner: HTMLElement | null): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      window.addEventListener("resize", onChange);
      const observer = typeof ResizeObserver === "function" ? new ResizeObserver(onChange) : null;
      if (owner) observer?.observe(owner);
      return () => {
        observer?.disconnect();
        window.removeEventListener("resize", onChange);
      };
    },
    [owner],
  );
  const snapshot = useCallback(() => owner?.clientHeight || window.innerHeight, [owner]);
  return useSyncExternalStore(subscribe, snapshot, () => 800);
}
