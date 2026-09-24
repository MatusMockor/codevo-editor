import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
  MIN_AGENT_RIGHT_PANEL_WIDTH,
} from "../../domain/agentWorkbenchLayout";
import { AGENT_PANEL_RESIZE_STEP, panelWidthForKey } from "./agentSurfaceResize";

describe("panelWidthForKey", () => {
  it("grows the right-docked panel with ArrowLeft and shrinks it with ArrowRight", () => {
    expect(panelWidthForKey("ArrowLeft", 540, 900)).toBe(540 + AGENT_PANEL_RESIZE_STEP);
    expect(panelWidthForKey("ArrowRight", 540, 900)).toBe(540 - AGENT_PANEL_RESIZE_STEP);
  });

  it("jumps to the renderable bounds and resets to the default", () => {
    expect(panelWidthForKey("Home", 700, 900)).toBe(MIN_AGENT_RIGHT_PANEL_WIDTH);
    expect(panelWidthForKey("End", 700, 900)).toBe(900);
    expect(panelWidthForKey("Enter", 700, 900)).toBe(DEFAULT_AGENT_RIGHT_PANEL_WIDTH);
    expect(panelWidthForKey(" ", 700, 900)).toBe(DEFAULT_AGENT_RIGHT_PANEL_WIDTH);
  });

  it("never steps past the renderable maximum or below the minimum", () => {
    expect(panelWidthForKey("ArrowLeft", 584, 584)).toBe(584);
    expect(panelWidthForKey("Enter", 700, 500)).toBe(500);
    expect(panelWidthForKey("ArrowRight", MIN_AGENT_RIGHT_PANEL_WIDTH, 900)).toBe(
      MIN_AGENT_RIGHT_PANEL_WIDTH,
    );
  });

  it("ignores other keys", () => {
    expect(panelWidthForKey("ArrowUp", 540, 900)).toBeNull();
    expect(panelWidthForKey("a", 540, 900)).toBeNull();
  });
});
