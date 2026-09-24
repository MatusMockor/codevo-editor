import { describe, expect, it } from "vitest";
import { computePopoverPosition } from "./popoverPosition";

const VIEWPORT = { width: 1000, height: 800 };
const MENU = { width: 200, height: 120 };

describe("computePopoverPosition", () => {
  it("opens below the anchor, aligned to its start, with a 4px gap", () => {
    const anchor = { top: 100, left: 300, width: 80, height: 28 };

    expect(computePopoverPosition(anchor, MENU, VIEWPORT, "bottom-start")).toEqual({
      top: 132,
      left: 300,
      placement: "bottom-start",
    });
  });

  it("aligns to the anchor end", () => {
    const anchor = { top: 100, left: 300, width: 80, height: 28 };

    expect(computePopoverPosition(anchor, MENU, VIEWPORT, "bottom-end").left).toBe(180);
  });

  it("flips above when there is no room below", () => {
    const anchor = { top: 740, left: 300, width: 80, height: 28 };

    expect(computePopoverPosition(anchor, MENU, VIEWPORT, "bottom-start")).toEqual({
      top: 616,
      left: 300,
      placement: "top-start",
    });
  });

  it("flips a submenu to the left side at the right window edge", () => {
    const anchor = { top: 200, left: 850, width: 140, height: 28 };

    expect(computePopoverPosition(anchor, MENU, VIEWPORT, "right-start")).toEqual({
      top: 200,
      left: 646,
      placement: "left-start",
    });
  });

  it("clamps inside an 8px margin when the anchor is at the edge", () => {
    const anchor = { top: 100, left: 2, width: 20, height: 28 };

    expect(computePopoverPosition(anchor, MENU, VIEWPORT, "bottom-end").left).toBe(8);
  });

  it("never returns negative coordinates for a popover larger than the window", () => {
    const anchor = { top: 10, left: 10, width: 20, height: 20 };
    const position = computePopoverPosition(
      anchor,
      { width: 1400, height: 1200 },
      VIEWPORT,
      "bottom-start",
    );

    expect(position).toEqual({ top: 8, left: 8, placement: "bottom-start" });
  });

  it("keeps the side with more room when neither side fits", () => {
    const tall = { width: 200, height: 500 };

    expect(
      computePopoverPosition(
        { top: 300, left: 300, width: 80, height: 28 },
        tall,
        VIEWPORT,
        "bottom-start",
      ).placement,
    ).toBe("bottom-start");
    expect(
      computePopoverPosition(
        { top: 500, left: 300, width: 80, height: 28 },
        tall,
        VIEWPORT,
        "bottom-start",
      ).placement,
    ).toBe("top-start");
    expect(
      computePopoverPosition(
        { top: 500, left: 300, width: 80, height: 28 },
        tall,
        VIEWPORT,
        "top-end",
      ).placement,
    ).toBe("top-end");
    expect(
      computePopoverPosition(
        { top: 100, left: 600, width: 100, height: 28 },
        { width: 700, height: 120 },
        VIEWPORT,
        "right-start",
      ).placement,
    ).toBe("left-start");
  });
});
