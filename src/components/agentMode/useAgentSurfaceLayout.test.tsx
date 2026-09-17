// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import {
  useAgentSurfaceLayout,
  type AgentSurfaceLayout,
  type AgentSurfaceLayoutOptions,
} from "./useAgentSurfaceLayout";
import { recordedLayoutState } from "./agentWorkbenchChromeTestFixtures";

it("restores each remote conversation's panel selection without altering local surfaces", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const element = document.createElement("div");
  const root = createRoot(element);
  const chromeLayout = recordedLayoutState({
    rightPanel: "open",
    openSurfaces: ["files"],
    activeSurface: "files",
  });
  const chrome = { layout: chromeLayout, workspaceTrusted: true };
  let current!: AgentSurfaceLayout;
  function Harness(props: AgentSurfaceLayoutOptions) {
    current = useAgentSurfaceLayout(props);
    return null;
  }
  const render = (remotePaneKey: string | null) =>
    act(() =>
      root.render(
        <Harness
          chrome={chrome}
          selectedThread={null}
          workspaceRoot="/local"
          remotePaneKey={remotePaneKey}
        />,
      ),
    );
  try {
    render(null);
    expect(current.layout.activeSurface).toBe("files");
    render("server-a/conversation");
    expect(current.layout.openSurfaces).toEqual([]);
    act(() => current.openSurface("terminal"));
    expect(current.layout.activeSurface).toBe("terminal");
    render("server-b/conversation");
    expect(current.layout.openSurfaces).toEqual([]);
    act(() => current.openSurface("history"));
    render("server-a/conversation");
    expect(current.layout.openSurfaces).toEqual(["terminal"]);
    act(() => current.closeSurfaceTab("terminal"));
    expect(current.layout.openSurfaces).toEqual([]);
    render("server-b/conversation");
    expect(current.layout.activeSurface).toBe("history");
    render(null);
    expect(current.layout.activeSurface).toBe("files");
    expect(chromeLayout.actions).toEqual([]);
  } finally {
    act(() => root.unmount());
  }
});

it("shows the global panel shell when opening a remote surface from a closed panel", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement("div"));
  const layout = recordedLayoutState();
  let current!: AgentSurfaceLayout;
  function Harness() {
    current = useAgentSurfaceLayout({
      chrome: { layout, workspaceTrusted: true },
      selectedThread: null,
      workspaceRoot: "/local",
      remotePaneKey: "server/project",
    });
    return null;
  }
  try {
    act(() => root.render(<Harness />));
    act(() => current.openSurface("files"));
    expect(layout.actions).toEqual([{ kind: "toggleRightPanel" }]);
    expect(current.layout.activeSurface).toBe("files");
  } finally {
    act(() => root.unmount());
  }
});
