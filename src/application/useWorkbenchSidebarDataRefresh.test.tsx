// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialIndexProgress } from "../domain/indexProgress";
import { initialAgentWorkbenchLayout } from "../domain/agentWorkbenchLayout";
import { agentDiffStatusDemand } from "./agentDiffStatusDemand";
import { useWorkbenchSidebarDataRefresh } from "./useWorkbenchSidebarDataRefresh";

describe("visible project Diff status demand", () => {
  let root: ReturnType<typeof createRoot>;
  let layout: typeof initialAgentWorkbenchLayout;
  let mode: "agent" | "editor-expanded";
  let refresh: ReturnType<typeof vi.fn<() => void>>;
  let workspaceRoot: string;
  function Harness() {
    useWorkbenchSidebarDataRefresh({
      sidebarView: "files",
      agentDiffVisible: agentDiffStatusDemand({
        layout,
        effectiveLayout: mode,
        dispatch: () => undefined,
        persistedBottomPanel: false,
      }),
      indexProgress: initialIndexProgress(),
      workspaceRoot,
      refreshGitStatus: refresh,
      refreshPhpTree: () => undefined,
    });
    return null;
  }
  function render() {
    act(() => root.render(<Harness />));
  }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    root = createRoot(document.createElement("div"));
    layout = {
      ...initialAgentWorkbenchLayout,
      rightPanel: "open",
      activeSurface: "diff",
      openSurfaces: ["diff"],
    };
    mode = "agent";
    refresh = vi.fn();
    workspaceRoot = "/workspace";
  });
  afterEach(() => act(() => root.unmount()));

  it("refreshes visible Diff without changing the editor sidebar", () => {
    render();
    expect(refresh).toHaveBeenCalledOnce();
    render();
    expect(refresh).toHaveBeenCalledOnce();
  });
  it.each(["closed", "otherSurface", "editor"])("does not demand refresh while %s", (hidden) => {
    if (hidden === "closed") layout = { ...layout, rightPanel: "closed" };
    if (hidden === "otherSurface")
      layout = { ...layout, activeSurface: "files", openSurfaces: ["diff", "files"] };
    if (hidden === "editor") mode = "editor-expanded";
    render();
    expect(refresh).not.toHaveBeenCalled();
  });
  it("refreshes when the workspace or mapped-status callback changes", () => {
    render();
    const original = refresh;
    refresh = vi.fn();
    render();
    expect(original).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    workspaceRoot = "/other";
    render();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
