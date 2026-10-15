import { describe, expect, it } from "vitest";
import {
  initialAgentWorkbenchLayout,
  type AgentWorkbenchLayout,
} from "../domain/agentWorkbenchLayout";
import {
  agentSurfaceHostPlacement,
  rightPanelCoversThread,
  workbenchShellPlacement,
} from "./workbenchShellPlacement";

function layoutOf(overrides: Partial<AgentWorkbenchLayout>): AgentWorkbenchLayout {
  return { ...initialAgentWorkbenchLayout, ...overrides };
}

describe("agentSurfaceHostPlacement", () => {
  it("keeps the surfaces mounted but hidden while the panel is closed", () => {
    expect(
      agentSurfaceHostPlacement(
        layoutOf({ rightPanel: "closed", openSurfaces: ["terminal"], activeSurface: "terminal" }),
      ),
    ).toEqual({ mounted: true, hidden: true });
  });

  it("unmounts the surfaces when the closed panel has no tabs", () => {
    expect(agentSurfaceHostPlacement(initialAgentWorkbenchLayout)).toEqual({
      mounted: false,
      hidden: true,
    });
  });

  it("shows the surfaces while the panel is open", () => {
    expect(
      agentSurfaceHostPlacement(
        layoutOf({ rightPanel: "open", openSurfaces: ["files"], activeSurface: "files" }),
      ),
    ).toEqual({ mounted: true, hidden: false });
  });
});

describe("rightPanelCoversThread", () => {
  it.each([
    { rightPanel: "open", rightPanelMaximized: true, covered: true },
    { rightPanel: "open", rightPanelMaximized: false, covered: false },
    { rightPanel: "closed", rightPanelMaximized: true, covered: false },
    { rightPanel: "closed", rightPanelMaximized: false, covered: false },
  ] as const)(
    "reports $covered for a $rightPanel panel with maximized=$rightPanelMaximized and matches the frame",
    ({ covered, rightPanel, rightPanelMaximized }) => {
      const layout = layoutOf({ rightPanel, rightPanelMaximized });

      expect(rightPanelCoversThread(layout)).toBe(covered);
      expect(
        workbenchShellPlacement({ bottomPanelVisible: false, layout }).rightPanelMaximized,
      ).toBe(covered);
    },
  );
});

describe("workbenchShellPlacement", () => {
  it.each([
    { viewportWidth: 1_280, expectedWidth: 464, rightPanelOverlay: false },
    { viewportWidth: 1_180, expectedWidth: 372, rightPanelOverlay: false },
    { viewportWidth: 1_000, expectedWidth: 420, rightPanelOverlay: true },
    { viewportWidth: 720, expectedWidth: 420, rightPanelOverlay: true },
  ])(
    "uses docking or overlay without automatic maximization at $viewportWidth pixels",
    ({ expectedWidth, rightPanelOverlay, viewportWidth }) => {
      const placement = workbenchShellPlacement({
        bottomPanelVisible: false,
        layout: layoutOf({
          rightPanel: "open",
          openSurfaces: ["files"],
          activeSurface: "files",
          rightPanelWidth: 540,
        }),
        viewportWidth,
      });

      expect(placement).toMatchObject({
        responsiveMaximized: false,
        rightPanelOverlay,
        rightPanelMaximized: false,
        rightPanelWidth: expectedWidth,
      });
    },
  );

  it("clamps a restored wide panel against the rail and minimum centre width", () => {
    expect(
      workbenchShellPlacement({
        bottomPanelVisible: false,
        layout: layoutOf({ rightPanel: "open", rightPanelWidth: 700 }),
        viewportWidth: 1_180,
      }),
    ).toMatchObject({ rightPanelWidth: 372, rightPanelOverlay: false });
  });

  it("hides the right panel while it is closed even when the files tab stays open", () => {
    const placement = workbenchShellPlacement({
      bottomPanelVisible: false,
      layout: layoutOf({
        rightPanel: "closed",
        openSurfaces: ["files"],
        activeSurface: "files",
        rightPanelWidth: 620,
      }),
    });

    expect(placement).toEqual({
      rightPanelHidden: true,
      surfacesMounted: true,
      rightPanelMaximized: false,
      responsiveMaximized: false,
      rightPanelOverlay: false,
      responsiveRestore: "none",
      rail: "expanded",
      railWidth: 256,
      rightPanelWidth: 0,
      bottomPanelHeight: 0,
    });
  });

  it("carries the collapsed rail into the placement for the frame rail track", () => {
    expect(
      workbenchShellPlacement({
        bottomPanelVisible: true,
        layout: layoutOf({ rail: "collapsed" }),
      }),
    ).toMatchObject({ rail: "collapsed", bottomPanelHeight: 280 });
  });

  it("places a maximized Files viewer with the collapsed rail", () => {
    const placement = workbenchShellPlacement({
      bottomPanelVisible: true,
      layout: layoutOf({
        rightPanel: "open",
        openSurfaces: ["files", "diff"],
        activeSurface: "files",
        rightPanelMaximized: true,
        rail: "collapsed",
        rightPanelWidth: 620,
        bottomPanelHeight: 200,
      }),
    });

    expect(placement).toEqual({
      rightPanelHidden: false,
      surfacesMounted: true,
      rightPanelMaximized: true,
      responsiveMaximized: false,
      rightPanelOverlay: false,
      responsiveRestore: "none",
      rail: "collapsed",
      railWidth: 256,
      rightPanelWidth: 620,
      bottomPanelHeight: 200,
    });
  });
});
