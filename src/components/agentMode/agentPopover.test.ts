// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  AGENT_POPOVER_METRICS,
  agentPopoverContainingBlock,
  agentPopoverPosition,
  agentPopoverStyle,
  agentPopoverViewportFrame,
  samePopoverPosition,
  type AgentPopoverAlign,
  type AgentPopoverFrame,
  type AgentPopoverViewport,
} from "./agentPopover";

const VIEWPORT: AgentPopoverViewport = { width: 1200, height: 800 };
const GAP = AGENT_POPOVER_METRICS.gap;
const MARGIN = AGENT_POPOVER_METRICS.margin;

function rect(overrides: Partial<DOMRect>): DOMRect {
  const base = { top: 100, left: 200, width: 160, height: 24, ...overrides };
  return {
    ...base,
    right: overrides.right ?? base.left + base.width,
    bottom: overrides.bottom ?? base.top + base.height,
    x: base.left,
    y: base.top,
    toJSON: () => base,
  } as DOMRect;
}

function popover(width = 240, height = 180) {
  return { offsetWidth: width, offsetHeight: height, scrollHeight: height };
}

function place(
  anchor: DOMRect,
  align: AgentPopoverAlign = "start",
  frame?: AgentPopoverFrame,
  size = popover(),
) {
  return agentPopoverPosition(anchor, size, align, VIEWPORT, frame);
}

describe("agentPopoverPosition", () => {
  it("anchors the popover one gap below the trigger and aligns it to the trigger start", () => {
    const anchor = rect({ top: 100, left: 200 });
    const position = place(anchor);

    expect(position.placement).toBe("down");
    expect(agentPopoverStyle(position, "start")).toMatchObject({
      top: anchor.bottom + GAP,
      left: anchor.left,
    });
  });

  it("aligns to the trigger end when asked, measured from the viewport right edge", () => {
    const anchor = rect({ top: 100, left: 900, width: 120 });
    const position = place(anchor, "end");

    expect(agentPopoverStyle(position, "end")).toMatchObject({
      top: anchor.bottom + GAP,
      right: VIEWPORT.width - anchor.right,
    });
  });

  it("flips above the trigger with the same gap when there is no room below", () => {
    const anchor = rect({ top: 700, left: 200 });
    const position = place(anchor);

    expect(position.placement).toBe("up");
    expect(agentPopoverStyle(position, "start")).toMatchObject({
      bottom: VIEWPORT.height - anchor.top + GAP,
      left: anchor.left,
    });
  });

  it("stays below the trigger when the flip would not gain room", () => {
    const anchor = rect({ top: 20, left: 200 });
    const position = place(anchor, "start", undefined, popover(240, 900));

    expect(position.placement).toBe("down");
    expect(position.offset).toBe(anchor.bottom + GAP);
  });

  it("keeps the popover inside the viewport margins", () => {
    expect(place(rect({ top: 100, left: 2 })).inset).toBe(MARGIN);
    expect(place(rect({ top: 100, left: 1190, width: 8 })).inset).toBe(
      VIEWPORT.width - MARGIN - 240,
    );
    expect(place(rect({ top: 100, left: 2 }), "end").inset).toBe(VIEWPORT.width - MARGIN - 240);
  });

  it("caps the height by the room left on the chosen side", () => {
    expect(place(rect({ top: 500, left: 200 })).maxHeight).toBe(
      VIEWPORT.height - 524 - GAP - MARGIN,
    );
    expect(place(rect({ top: 100, left: 200 })).minWidth).toBe(160);
  });

  it("subtracts the containing block when a transformed ancestor owns the fixed position", () => {
    const anchor = rect({ top: 300, left: 200 });
    const frame: AgentPopoverFrame = { top: 40, left: 12, right: 1180, bottom: 772 };
    const position = place(anchor, "start", frame);

    expect(agentPopoverStyle(position, "start")).toMatchObject({
      top: anchor.bottom + GAP - frame.top,
      left: anchor.left - frame.left,
    });
  });

  it("subtracts the containing block for end alignment and for the flipped placement", () => {
    const frame: AgentPopoverFrame = { top: 40, left: 12, right: 1180, bottom: 772 };
    const anchor = rect({ top: 700, left: 900, width: 120 });
    const position = place(anchor, "end", frame);

    expect(position.placement).toBe("up");
    expect(agentPopoverStyle(position, "end")).toMatchObject({
      bottom: frame.bottom - anchor.top + GAP,
      right: VIEWPORT.width - anchor.right - (VIEWPORT.width - frame.right),
    });
  });

  it("clamps end-aligned popovers inside a docked center column", () => {
    const frame: AgentPopoverFrame = { top: 40, left: 300, right: 940, bottom: 772 };
    const anchor = rect({ top: 100, left: 920, width: 80 });
    const position = place(anchor, "end", frame, popover(360));

    expect(agentPopoverStyle(position, "end")).toMatchObject({
      top: anchor.bottom + GAP - frame.top,
      right: MARGIN,
    });
  });

  it("keeps an end-aligned popover anchored in a maximized center column", () => {
    const frame: AgentPopoverFrame = { top: 0, left: 0, right: 1200, bottom: 800 };
    const anchor = rect({ top: 100, left: 1090, width: 80 });
    const position = place(anchor, "end", frame, popover(360));

    expect(agentPopoverStyle(position, "end")).toMatchObject({
      top: anchor.bottom + GAP,
      right: VIEWPORT.width - anchor.right,
    });
  });

  it("uses the center column rather than the viewport to choose vertical placement", () => {
    const frame: AgentPopoverFrame = { top: 100, left: 300, right: 940, bottom: 500 };
    const anchor = rect({ top: 430, left: 800, width: 80 });
    const position = place(anchor, "end", frame, popover(360, 180));

    expect(position.placement).toBe("up");
    expect(position.maxHeight).toBe(318);
  });

  it("treats the default frame as the viewport", () => {
    const anchor = rect({ top: 100, left: 200 });
    expect(place(anchor)).toEqual(
      agentPopoverPosition(
        anchor,
        popover(),
        "start",
        VIEWPORT,
        agentPopoverViewportFrame(VIEWPORT),
      ),
    );
  });
});

describe("agentPopoverStyle", () => {
  it("returns no style before the first measurement", () => {
    expect(agentPopoverStyle(null, "start")).toEqual({});
  });
});

describe("agentPopoverContainingBlock", () => {
  it("does not offset fixed popovers for a size container", () => {
    const container = document.createElement("div");
    const popover = document.createElement("div");
    container.style.containerType = "inline-size";
    container.append(popover);
    document.body.append(container);

    expect(agentPopoverContainingBlock(popover)).toBeNull();

    container.remove();
  });
});

describe("samePopoverPosition", () => {
  it("detects an unchanged placement so the popover does not resettle on every scroll tick", () => {
    const anchor = rect({ top: 100, left: 200 });
    expect(samePopoverPosition(place(anchor), place(anchor))).toBe(true);
    expect(samePopoverPosition(place(anchor), place(rect({ top: 101, left: 200 })))).toBe(false);
  });
});
