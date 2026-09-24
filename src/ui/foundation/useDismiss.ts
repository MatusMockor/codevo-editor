import { useEffect, type RefObject } from "react";
import { useLatest } from "./useLatest";

export function useDismiss(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  anchorRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  const onDismissRef = useLatest(onDismiss);
  useEffect(() => {
    if (!active) return;
    const isInside = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      [containerRef.current, anchorRef.current].some((element) => element?.contains(target));
    const handlePointerDown = (event: PointerEvent): void => {
      if (isInside(event.target)) return;
      onDismissRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      onDismissRef.current();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, anchorRef, containerRef, onDismissRef]);
}
