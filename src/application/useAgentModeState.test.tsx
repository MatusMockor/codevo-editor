// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useAgentModeState, type AgentModeState } from "./useAgentModeState";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useAgentModeState", () => {
  it("never renders workspace A agent mode for workspace B", () => {
    const harness = renderAgentModeState("workspace-a", true);
    harness.enable();

    harness.rerender("workspace-b", true);

    expect(harness.result().agentModeActive).toBe(false);
    expect(harness.rendersSinceLastTransition()).not.toContain(true);
    harness.unmount();
  });

  it("never renders agent mode after the workspace is removed", () => {
    const harness = renderAgentModeState("workspace-a", true);
    harness.enable();

    harness.rerender(null, false);

    expect(harness.result().agentModeActive).toBe(false);
    expect(harness.rendersSinceLastTransition()).not.toContain(true);
    harness.unmount();
  });

  it("does not resurrect workspace A agent mode across A to B to A", () => {
    const harness = renderAgentModeState("workspace-a", true);
    harness.enable();

    harness.rerender("workspace-b", true);
    expect(harness.rendersSinceLastTransition()).not.toContain(true);

    harness.rerender("workspace-a", true);

    expect(harness.result().agentModeActive).toBe(false);
    expect(harness.rendersSinceLastTransition()).not.toContain(true);
    harness.unmount();
  });

  it("rejects each stale A callback after A to B to A", () => {
    const harness = renderAgentModeState("workspace-a", true);
    const staleA = harness.result();
    harness.rerender("workspace-b", true);
    harness.rerender("workspace-a", true);

    act(() => staleA.setAgentModeActive(true));
    expect(harness.result().agentModeActive).toBe(false);

    act(() => staleA.toggleAgentMode());
    expect(harness.result().agentModeActive).toBe(false);
    harness.unmount();
  });

  it("does not let stale foreign callbacks deactivate the current owner", () => {
    const harness = renderAgentModeState("workspace-a", true);
    harness.rerender("workspace-b", true);
    const staleB = harness.result();
    harness.rerender("workspace-a", true);
    harness.enable();

    act(() => staleB.setAgentModeActive(false));
    expect(harness.result().agentModeActive).toBe(true);

    act(() => staleB.toggleAgentMode());
    expect(harness.result().agentModeActive).toBe(true);
    harness.unmount();
  });

  it("rejects a stale callback batched with an owner transition", () => {
    const harness = renderAgentModeState("workspace-a", true);
    const staleA = harness.result();
    harness.enable();

    act(() => {
      harness.rerenderWithoutAct("workspace-b", true);
      staleA.setAgentModeActive(true);
    });

    expect(harness.result().agentModeActive).toBe(false);
    expect(harness.rendersSinceLastTransition()).not.toContain(true);
    harness.unmount();
  });
});

function renderAgentModeState(
  initialWorkspaceOwnerKey: string | null,
  initialHasWorkspace: boolean,
) {
  let workspaceOwnerKey = initialWorkspaceOwnerKey;
  let hasWorkspace = initialHasWorkspace;
  let latestResult: AgentModeState | null = null;
  let transitionRenderValues: boolean[] = [];
  const root = createRoot(document.body.appendChild(document.createElement("div")));

  function Harness() {
    const result = useAgentModeState(workspaceOwnerKey, hasWorkspace);
    latestResult = result;
    transitionRenderValues.push(result.agentModeActive);
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    enable() {
      act(() => getResult().setAgentModeActive(true));
      expect(getResult().agentModeActive).toBe(true);
    },
    result: getResult,
    rerender(nextWorkspaceOwnerKey: string | null, nextHasWorkspace: boolean) {
      act(() => rerenderWithoutAct(nextWorkspaceOwnerKey, nextHasWorkspace));
    },
    rerenderWithoutAct,
    rendersSinceLastTransition: () => transitionRenderValues,
    unmount: () => act(() => root.unmount()),
  };

  function rerenderWithoutAct(nextWorkspaceOwnerKey: string | null, nextHasWorkspace: boolean) {
    workspaceOwnerKey = nextWorkspaceOwnerKey;
    hasWorkspace = nextHasWorkspace;
    transitionRenderValues = [];
    root.render(<Harness />);
  }

  function getResult(): AgentModeState {
    if (!latestResult) {
      throw new Error("agent mode state hook is not mounted");
    }
    return latestResult;
  }
}
