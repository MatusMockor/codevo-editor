import { describe, expect, it } from "vitest";
import { responsiveAgentPanelPlacement } from "./agentWorkbenchResponsiveLayout";

describe("responsiveAgentPanelPlacement", () => {
  it.each([
    {
      viewportWidth: 1_180,
      expected: { maximized: false, restore: "none", width: 540 },
    },
    {
      viewportWidth: 1_000,
      expected: { maximized: false, restore: "none", width: 392 },
    },
    {
      viewportWidth: 900,
      expected: { maximized: true, restore: "collapseRail", width: 540 },
    },
    {
      viewportWidth: 720,
      expected: { maximized: true, restore: "closePanel", width: 540 },
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

  it("retains a truthful responsive restore while the user preference is also maximized", () => {
    expect(
      responsiveAgentPanelPlacement({
        hidden: false,
        maximized: true,
        rail: "expanded",
        requestedWidth: 700,
        viewportWidth: 720,
      }),
    ).toEqual({ maximized: true, restore: "closePanel", width: 700 });
  });

  it("keeps a collapsed rail docked whenever both minimum columns fit", () => {
    expect(
      responsiveAgentPanelPlacement({
        hidden: false,
        maximized: false,
        rail: "collapsed",
        requestedWidth: 540,
        viewportWidth: 900,
      }),
    ).toEqual({ maximized: false, restore: "none", width: 492 });
  });
});
