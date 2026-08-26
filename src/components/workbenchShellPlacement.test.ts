import { describe, expect, it } from "vitest";
import {
  initialAgentWorkbenchLayout,
  type AgentWorkbenchLayout,
} from "../domain/agentWorkbenchLayout";
import { agentSurfaceHostPlacement, workbenchShellPlacement } from "./workbenchShellPlacement";

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

  it("never mounts the surfaces in the expanded editor even with retained tabs", () => {
    expect(
      agentSurfaceHostPlacement(
        layoutOf({
          layout: "editor-expanded",
          openSurfaces: ["terminal"],
          activeSurface: "terminal",
        }),
      ),
    ).toEqual({ mounted: false, hidden: true });
  });
});

describe("workbenchShellPlacement", () => {
  it("hides the editor while the panel is closed even when the files tab stays open", () => {
    const placement = workbenchShellPlacement({
      bottomPanelVisible: false,
      effectiveLayout: "agent",
      layout: layoutOf({
        rightPanel: "closed",
        openSurfaces: ["files"],
        activeSurface: "files",
        rightPanelWidth: 620,
      }),
    });

    expect(placement).toEqual({
      layout: "agent",
      editorHidden: true,
      rightPanelHidden: true,
      surfacesMounted: true,
      rightPanelMaximized: false,
      rightPanelWidth: 0,
      bottomPanelHeight: 0,
    });
  });

  it("places the editor in the files surface while the panel is open", () => {
    const placement = workbenchShellPlacement({
      bottomPanelVisible: true,
      effectiveLayout: "agent",
      layout: layoutOf({
        rightPanel: "open",
        openSurfaces: ["files", "diff"],
        activeSurface: "files",
        rightPanelMaximized: true,
        rightPanelWidth: 620,
        bottomPanelHeight: 200,
      }),
    });

    expect(placement).toEqual({
      layout: "agent",
      editorHidden: false,
      rightPanelHidden: false,
      surfacesMounted: true,
      rightPanelMaximized: true,
      rightPanelWidth: 620,
      bottomPanelHeight: 200,
    });
  });

  it("gives the expanded editor the whole frame and mounts no surface", () => {
    expect(
      workbenchShellPlacement({
        bottomPanelVisible: true,
        effectiveLayout: "editor-expanded",
        layout: layoutOf({ openSurfaces: ["terminal"], activeSurface: "terminal" }),
      }),
    ).toEqual({
      layout: "editor-expanded",
      editorHidden: false,
      rightPanelHidden: true,
      surfacesMounted: false,
      rightPanelMaximized: false,
      rightPanelWidth: 0,
      bottomPanelHeight: 0,
    });
  });
});
