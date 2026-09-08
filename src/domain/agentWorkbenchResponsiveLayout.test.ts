import { describe, expect, it } from "vitest";
import { responsiveAgentPanelPlacement } from "./agentWorkbenchResponsiveLayout";

describe("responsiveAgentPanelPlacement", () => {
  it.each([
    {
      viewportWidth: 1_280,
      expected: { overlay: false, restore: "none", width: 464 },
    },
    {
      viewportWidth: 1_180,
      expected: { overlay: false, restore: "none", width: 372 },
    },
    {
      viewportWidth: 1_000,
      expected: { overlay: true, restore: "none", width: 420 },
    },
    {
      viewportWidth: 900,
      expected: { overlay: true, restore: "none", width: 420 },
    },
    {
      viewportWidth: 720,
      expected: { overlay: true, restore: "none", width: 420 },
    },
  ])("derives bounded placement at $viewportWidth pixels", ({ expected, viewportWidth }) => {
    expect(
      responsiveAgentPanelPlacement({
        hidden: false,
        maximized: false,
        rail: "expanded",
        requestedWidth: 540,
        viewportWidth,
      }),
    ).toEqual(expected);
  });

  it("keeps explicit maximization separate from responsive overlay", () => {
    expect(
      responsiveAgentPanelPlacement({
        hidden: false,
        maximized: true,
        rail: "expanded",
        requestedWidth: 700,
        viewportWidth: 720,
      }),
    ).toEqual({ overlay: false, restore: "none", width: 700 });
  });

  it.each([0, 200, 480, 720, 721, 900])(
    "bounds overlays within %i px and never maximizes",
    (viewportWidth) => {
      const result = responsiveAgentPanelPlacement({
        hidden: false,
        maximized: false,
        rail: "expanded",
        requestedWidth: 900,
        viewportWidth,
      });
      expect(result.overlay).toBe(true);
      expect(result.width).toBeGreaterThanOrEqual(0);
      expect(result.width).toBeLessThanOrEqual(viewportWidth);
      expect(result.restore).toBe("none");
    },
  );

  it("keeps a collapsed rail docked whenever both minimum columns fit", () => {
    expect(
      responsiveAgentPanelPlacement({
        hidden: false,
        maximized: false,
        rail: "collapsed",
        requestedWidth: 540,
        viewportWidth: 1_280,
      }),
    ).toEqual({ overlay: false, restore: "none", width: 540 });
  });

  it("clamps the panel against a widened rail before it overlays", () => {
    expect(
      responsiveAgentPanelPlacement({
        hidden: false,
        maximized: false,
        rail: "expanded",
        railWidth: 420,
        requestedWidth: 540,
        viewportWidth: 1_400,
      }),
    ).toEqual({ overlay: false, restore: "none", width: 420 });
  });
});
