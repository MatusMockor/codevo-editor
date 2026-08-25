import { describe, expect, it } from "vitest";
import {
  agentBottomPanelSync,
  initialAgentBottomPanelSyncState,
  type AgentBottomPanelSyncState,
} from "./agentWorkbenchChrome";

const OWNER = "/workspace/app";

describe("agentBottomPanelSync", () => {
  it("adopts the owner without touching either side", () => {
    const result = agentBottomPanelSync(initialAgentBottomPanelSyncState, {
      owner: OWNER,
      active: true,
      visible: false,
      view: "problems",
      persisted: false,
    });

    expect(result.mirror).toBeNull();
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

    const hydrated = agentBottomPanelSync(adopted, {
      owner: OWNER,
      active: true,
      visible: false,
      view: "problems",
      persisted: true,
    });
    expect(hydrated.showTerminal).toBe(true);
    expect(hydrated.state.applied).toBe(true);

    const settled = agentBottomPanelSync(hydrated.state, {
      owner: OWNER,
      active: true,
      visible: true,
      view: "terminal",
      persisted: true,
    });
    expect(settled.mirror).toBe("show");
    expect(settled.showTerminal).toBe(false);

    const idle = agentBottomPanelSync(settled.state, {
      owner: OWNER,
      active: true,
      visible: true,
      view: "terminal",
      persisted: true,
    });
    expect(idle.mirror).toBeNull();
    expect(idle.showTerminal).toBe(false);
  });

  it("mirrors a controller toggle into the layout and reveals the terminal view", () => {
    const opened = agentBottomPanelSync(adopt(), {
      owner: OWNER,
      active: true,
      visible: true,
      view: "problems",
      persisted: false,
    });

    expect(opened.mirror).toBe("show");
    expect(opened.showTerminal).toBe(true);

    const closed = agentBottomPanelSync(opened.state, {
      owner: OWNER,
      active: true,
      visible: false,
      view: "terminal",
      persisted: true,
    });

    expect(closed.mirror).toBe("hide");
    expect(closed.showTerminal).toBe(false);
  });

  it("keeps an explicit view change out of the terminal reveal", () => {
    const opened = agentBottomPanelSync(adopt(), {
      owner: OWNER,
      active: true,
      visible: true,
      view: "index",
      persisted: false,
    });

    expect(opened.mirror).toBe("show");
    expect(opened.showTerminal).toBe(false);
  });

  it("tracks without touching either side while the agent layout is inactive", () => {
    const applied = agentBottomPanelSync(adopt(), {
      owner: OWNER,
      active: true,
      visible: false,
      view: "problems",
      persisted: true,
    }).state;

    const inactive = agentBottomPanelSync(applied, {
      owner: OWNER,
      active: false,
      visible: true,
      view: "problems",
      persisted: false,
    });
    expect(inactive.mirror).toBeNull();
    expect(inactive.showTerminal).toBe(false);
    expect(inactive.state.visible).toBe(true);

    const resumed = agentBottomPanelSync(inactive.state, {
      owner: OWNER,
      active: true,
      visible: true,
      view: "problems",
      persisted: false,
    });
    expect(resumed.mirror).toBe("show");
    expect(resumed.showTerminal).toBe(false);
  });

  it("resets the applied flag on a workspace A -> B -> A switch", () => {
    const applied = agentBottomPanelSync(adopt(), {
      owner: OWNER,
      active: true,
      visible: false,
      view: "problems",
      persisted: true,
    }).state;
    expect(applied.applied).toBe(true);

    const other = agentBottomPanelSync(applied, {
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

    const back = agentBottomPanelSync(other.state, {
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

function adopt(): AgentBottomPanelSyncState {
  return agentBottomPanelSync(initialAgentBottomPanelSyncState, {
    owner: OWNER,
    active: true,
    visible: false,
    view: "problems",
    persisted: false,
  }).state;
}
