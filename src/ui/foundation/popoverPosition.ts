export type PopoverPlacement =
  "bottom-start" | "bottom-end" | "top-start" | "top-end" | "right-start" | "left-start";

export interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface PopoverPosition {
  readonly top: number;
  readonly left: number;
  readonly placement: PopoverPlacement;
}

interface Point {
  readonly top: number;
  readonly left: number;
}

const GAP = 4;
const MARGIN = 8;

const FLIPPED: Readonly<Record<PopoverPlacement, PopoverPlacement>> = {
  "bottom-start": "top-start",
  "bottom-end": "top-end",
  "top-start": "bottom-start",
  "top-end": "bottom-end",
  "right-start": "left-start",
  "left-start": "right-start",
};

export function computePopoverPosition(
  anchor: Rect,
  popover: Size,
  viewport: Size,
  placement: PopoverPlacement,
): PopoverPosition {
  const chosen = choosePlacement(anchor, popover, viewport, placement);
  const point = placeAt(anchor, popover, chosen);
  return {
    top: clamp(point.top, MARGIN, viewport.height - popover.height - MARGIN),
    left: clamp(point.left, MARGIN, viewport.width - popover.width - MARGIN),
    placement: chosen,
  };
}

function choosePlacement(
  anchor: Rect,
  popover: Size,
  viewport: Size,
  placement: PopoverPlacement,
): PopoverPlacement {
  if (fitsMainAxis(placeAt(anchor, popover, placement), popover, viewport, placement)) {
    return placement;
  }
  const flipped = FLIPPED[placement];
  if (fitsMainAxis(placeAt(anchor, popover, flipped), popover, viewport, flipped)) return flipped;
  if (mainAxisRoom(anchor, viewport, flipped) > mainAxisRoom(anchor, viewport, placement)) {
    return flipped;
  }
  return placement;
}

function mainAxisRoom(anchor: Rect, viewport: Size, placement: PopoverPlacement): number {
  switch (placement) {
    case "bottom-start":
    case "bottom-end":
      return viewport.height - MARGIN - (anchor.top + anchor.height + GAP);
    case "top-start":
    case "top-end":
      return anchor.top - GAP - MARGIN;
    case "right-start":
      return viewport.width - MARGIN - (anchor.left + anchor.width + GAP);
    case "left-start":
      return anchor.left - GAP - MARGIN;
  }
}

function fitsMainAxis(
  point: Point,
  popover: Size,
  viewport: Size,
  placement: PopoverPlacement,
): boolean {
  if (placement === "right-start" || placement === "left-start") {
    return point.left >= MARGIN && point.left + popover.width <= viewport.width - MARGIN;
  }
  return point.top >= MARGIN && point.top + popover.height <= viewport.height - MARGIN;
}

function placeAt(anchor: Rect, popover: Size, placement: PopoverPlacement): Point {
  const below = anchor.top + anchor.height + GAP;
  const above = anchor.top - GAP - popover.height;
  const endAligned = anchor.left + anchor.width - popover.width;
  switch (placement) {
    case "bottom-start":
      return { top: below, left: anchor.left };
    case "bottom-end":
      return { top: below, left: endAligned };
    case "top-start":
      return { top: above, left: anchor.left };
    case "top-end":
      return { top: above, left: endAligned };
    case "right-start":
      return { top: anchor.top, left: anchor.left + anchor.width + GAP };
    case "left-start":
      return { top: anchor.top, left: anchor.left - GAP - popover.width };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
