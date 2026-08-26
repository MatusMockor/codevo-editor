import { describe, expect, it } from "vitest";
import {
  agentTerminalPanelIntent,
  initialAgentTerminalPanelIntentState,
  type AgentTerminalPanelIntentState,
} from "./agentWorkbenchChrome";

const OWNER = "/workspace/app";

describe("agentTerminalPanelIntent", () => {
  it("adopts the owner without revealing the terminal", () => {
    const result = agentTerminalPanelIntent(initialAgentTerminalPanelIntentState, {
      owner: OWNER,
      active: true,
      visible: false,
      view: "problems",
      persisted: false,
    });

    expect(result.showTerminal).toBe(false);
    expect(result.state).toEqual({
      owner: OWNER,
      visible: false,
      view: "problems",
      applied: false,
    });
  });

  it("shows the terminal once when the hydrated layout persisted an open panel", () => {
    const adopted = adopt();

    const hydrated = agentTerminalPanelIntent(adopted, {
      owner: OWNER,
      active: true,
      visible: false,
      view: "problems",
      persisted: true,
    });
    expect(hydrated.showTerminal).toBe(true);
    expect(hydrated.state.applied).toBe(true);

    const settled = agentTerminalPanelIntent(hydrated.state, {
      owner: OWNER,
      active: true,
      visible: true,
      view: "terminal",
      persisted: true,
    });
    expect(settled.showTerminal).toBe(false);

    const idle = agentTerminalPanelIntent(settled.state, {
      owner: OWNER,
      active: true,
      visible: true,
      view: "terminal",
      persisted: true,
    });
    expect(idle.showTerminal).toBe(false);
  });

  it("reveals the terminal view when the controller shows the panel with an unchanged view", () => {
    const opened = agentTerminalPanelIntent(adopt(), {
      owner: OWNER,
      active: true,
      visible: true,
      view: "problems",
      persisted: false,
    });

    expect(opened.showTerminal).toBe(true);

    const closed = agentTerminalPanelIntent(opened.state, {
      owner: OWNER,
      active: true,
      visible: false,
      view: "terminal",
      persisted: true,
    });

    expect(closed.showTerminal).toBe(false);
  });

  it("keeps an explicit view change out of the terminal reveal", () => {
    const opened = agentTerminalPanelIntent(adopt(), {
      owner: OWNER,
      active: true,
      visible: true,
      view: "index",
      persisted: false,
    });

    expect(opened.showTerminal).toBe(false);
  });

  it("tracks without revealing the terminal while the agent layout is inactive", () => {
    const applied = agentTerminalPanelIntent(adopt(), {
      owner: OWNER,
      active: true,
      visible: false,
      view: "problems",
      persisted: true,
    }).state;

    const inactive = agentTerminalPanelIntent(applied, {
      owner: OWNER,
      active: false,
      visible: true,
      view: "problems",
      persisted: false,
    });
    expect(inactive.showTerminal).toBe(false);
    expect(inactive.state.visible).toBe(true);

    const resumed = agentTerminalPanelIntent(inactive.state, {
      owner: OWNER,
      active: true,
      visible: true,
      view: "problems",
      persisted: false,
    });
    expect(resumed.showTerminal).toBe(false);
  });

  it("resets the applied flag on a workspace A -> B -> A switch", () => {
    const applied = agentTerminalPanelIntent(adopt(), {
      owner: OWNER,
      active: true,
      visible: false,
      view: "problems",
      persisted: true,
    }).state;
    expect(applied.applied).toBe(true);

    const other = agentTerminalPanelIntent(applied, {
      owner: "/workspace/api",
      active: true,
      visible: false,
      view: "problems",
      persisted: false,
    });
    expect(other.state).toEqual({
      owner: "/workspace/api",
      visible: false,
      view: "problems",
      applied: false,
    });
    expect(other.showTerminal).toBe(false);

    const back = agentTerminalPanelIntent(other.state, {
      owner: OWNER,
      active: true,
      visible: false,
      view: "problems",
      persisted: true,
    });
    expect(back.state.applied).toBe(false);
    expect(back.showTerminal).toBe(false);
  });
});

function adopt(): AgentTerminalPanelIntentState {
  return agentTerminalPanelIntent(initialAgentTerminalPanelIntentState, {
    owner: OWNER,
    active: true,
    visible: false,
    view: "problems",
    persisted: false,
  }).state;
}
