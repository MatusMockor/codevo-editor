import { useLayoutEffect, useState, type RefObject } from "react";
import {
  computePopoverPosition,
  type PopoverPlacement,
  type PopoverPosition,
} from "./popoverPosition";

const OFFSCREEN = -10000;

export function usePopoverPosition(
  anchorRef: RefObject<HTMLElement | null>,
  surfaceRef: RefObject<HTMLElement | null>,
  placement: PopoverPlacement,
): PopoverPosition {
  const [position, setPosition] = useState<PopoverPosition>({
    top: OFFSCREEN,
    left: OFFSCREEN,
    placement,
  });
  useLayoutEffect(() => {
    const update = (): void => {
      const anchor = anchorRef.current;
      const surface = surfaceRef.current;
      if (anchor === null || surface === null) return;
      const rect = anchor.getBoundingClientRect();
      const next = computePopoverPosition(
        { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        { width: surface.offsetWidth, height: surface.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        placement,
      );
      setPosition((current) =>
        current.top === next.top &&
        current.left === next.left &&
        current.placement === next.placement
          ? current
          : next,
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, placement, surfaceRef]);
  return position;
}
