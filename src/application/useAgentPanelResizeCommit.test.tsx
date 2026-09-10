// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAgentWorkbenchLayout } from "../domain/agentWorkbenchLayout";
import { useAgentPanelResizeCommit } from "./useAgentPanelResizeCommit";
import type { AgentWorkbenchLayoutState } from "./useAgentWorkbenchLayout";
import type { AgentPanelResizeCommit } from "./useWorkbenchResizeHandles";

describe("useAgentPanelResizeCommit", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function layoutState(dispatch: AgentWorkbenchLayoutState["dispatch"]): AgentWorkbenchLayoutState {
    return {
      layout: initialAgentWorkbenchLayout,
      effectiveLayout: "agent",
      persistedBottomPanel: false,
      dispatch,
    };
  }

  function renderCommits(agentLayout: AgentWorkbenchLayoutState): AgentPanelResizeCommit[] {
    const seen: AgentPanelResizeCommit[] = [];

    function Probe() {
      seen.push(useAgentPanelResizeCommit(agentLayout));

      return null;
    }

    act(() => root.render(<Probe />));

    return seen;
  }

  it("commits panel resizes as layout actions and keeps the layout it was given", () => {
    const dispatch = vi.fn();
    const agentLayout = layoutState(dispatch);
    const commit = renderCommits(agentLayout)[0];

    expect(commit).toBeDefined();
    expect(commit?.layout).toBe(agentLayout.layout);

    act(() => commit?.onResizeRightPanel(420));
    act(() => commit?.onResizeBottomPanel(240));

    expect(dispatch).toHaveBeenNthCalledWith(1, { kind: "resizeRightPanel", width: 420 });
    expect(dispatch).toHaveBeenNthCalledWith(2, { kind: "resizeBottomPanel", height: 240 });
  });

  it("keeps a stable commit while the layout is unchanged", () => {
    const agentLayout = layoutState(vi.fn());
    const seen: AgentPanelResizeCommit[] = [];

    function Probe() {
      seen.push(useAgentPanelResizeCommit(agentLayout));

      return null;
    }

    act(() => root.render(<Probe />));
    act(() => root.render(<Probe />));

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });
});
