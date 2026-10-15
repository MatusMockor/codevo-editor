import { describe, expect, it } from "vitest";
import {
  agentTerminalPanelIntent,
  ariaKeyShortcuts,
  initialAgentTerminalPanelIntentState,
  type AgentTerminalPanelIntentState,
} from "./agentWorkbenchChrome";

const OWNER = "/workspace/app";

describe("agentTerminalPanelIntent", () => {
  it("restores each project's own persisted panel across A to B to A", () => {
    const openA = agentTerminalPanelIntent(
      agentTerminalPanelIntent(initialAgentTerminalPanelIntentState, {
        owner: "/workspace-a",
        visible: false,
        persisted: false,
      }).state,
      { owner: "/workspace-a", visible: true, persisted: false },
    );
    const switchedToB = agentTerminalPanelIntent(openA.state, {
      owner: "/workspace-b",
      visible: false,
      persisted: false,
    });
    const hydratedB = agentTerminalPanelIntent(switchedToB.state, {
      owner: "/workspace-b",
      visible: false,
      persisted: false,
    });
    expect(hydratedB.showTerminal).toBe(false);

    const backToA = agentTerminalPanelIntent(hydratedB.state, {
      owner: "/workspace-a",
      visible: false,
      persisted: false,
    });
    const hydratedA = agentTerminalPanelIntent(backToA.state, {
      owner: "/workspace-a",
      visible: false,
      persisted: true,
    });
    expect(hydratedA.showTerminal).toBe(true);
  });

  it("adopts the owner without revealing the terminal", () => {
    const result = agentTerminalPanelIntent(initialAgentTerminalPanelIntentState, {
      owner: OWNER,
      visible: false,
      persisted: false,
    });

    expect(result.showTerminal).toBe(false);
    expect(result.state).toEqual({ owner: OWNER, visible: false, applied: false });
  });

  it("shows the terminal once when the hydrated layout persisted an open panel", () => {
    const hydrated = agentTerminalPanelIntent(adopt(), {
      owner: OWNER,
      visible: false,
      persisted: true,
    });
    expect(hydrated.showTerminal).toBe(true);
    expect(hydrated.state.applied).toBe(true);

    const settled = agentTerminalPanelIntent(hydrated.state, {
      owner: OWNER,
      visible: true,
      persisted: true,
    });
    expect(settled.showTerminal).toBe(false);

    const idle = agentTerminalPanelIntent(settled.state, {
      owner: OWNER,
      visible: true,
      persisted: true,
    });
    expect(idle.showTerminal).toBe(false);
  });

  it("keeps a panel the user toggled before hydration out of the persisted reveal", () => {
    const opened = agentTerminalPanelIntent(adopt(), {
      owner: OWNER,
      visible: true,
      persisted: false,
    });
    expect(opened.showTerminal).toBe(false);
    expect(opened.state.applied).toBe(true);

    const closed = agentTerminalPanelIntent(opened.state, {
      owner: OWNER,
      visible: false,
      persisted: true,
    });
    expect(closed.showTerminal).toBe(false);

    const unchanged = agentTerminalPanelIntent(closed.state, {
      owner: OWNER,
      visible: false,
      persisted: true,
    });
    expect(unchanged.showTerminal).toBe(false);
  });

  it("resets the applied flag on a workspace A -> B -> A switch", () => {
    const applied = agentTerminalPanelIntent(adopt(), {
      owner: OWNER,
      visible: false,
      persisted: true,
    }).state;
    expect(applied.applied).toBe(true);

    const other = agentTerminalPanelIntent(applied, {
      owner: "/workspace/api",
      visible: false,
      persisted: false,
    });
    expect(other.state).toEqual({ owner: "/workspace/api", visible: false, applied: false });
    expect(other.showTerminal).toBe(false);

    const back = agentTerminalPanelIntent(other.state, {
      owner: OWNER,
      visible: false,
      persisted: true,
    });
    expect(back.state.applied).toBe(false);
    expect(back.showTerminal).toBe(false);
  });
});

function adopt(): AgentTerminalPanelIntentState {
  return agentTerminalPanelIntent(initialAgentTerminalPanelIntentState, {
    owner: OWNER,
    visible: false,
    persisted: false,
  }).state;
}

describe("ariaKeyShortcuts", () => {
  it("spells keymap chords in the aria-keyshortcuts vocabulary", () => {
    expect(ariaKeyShortcuts("Cmd+P")).toBe("Meta+P");
    expect(ariaKeyShortcuts("Ctrl+Shift+p")).toBe("Control+Shift+P");
    expect(ariaKeyShortcuts("Alt+Enter")).toBe("Alt+Enter");
    expect(ariaKeyShortcuts("f")).toBe("F");
  });

  it("returns nothing for an empty, oversized or unknown-modifier chord", () => {
    expect(ariaKeyShortcuts("")).toBe("");
    expect(ariaKeyShortcuts(" + ")).toBe("");
    expect(ariaKeyShortcuts(`Cmd+${"P".repeat(80)}`)).toBe("");
    expect(ariaKeyShortcuts("Mod+P")).toBe("");
    expect(ariaKeyShortcuts("Cmd Shift+P")).toBe("");
  });
});
