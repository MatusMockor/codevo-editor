import { describe, expect, it } from "vitest";
import {
  projectAgentRuntimeSubagents,
  type AgentRuntimeSubagentSource,
  type AgentRuntimeSubagentStatus,
} from "../../domain/agentRuntimeSubagent";
import {
  AGENTS_DOCK_MIN_WIDTH,
  MAX_AGENTS_PANEL_ROWS,
  agentAgentsDockMode,
  agentAgentsPanelModel,
  agentAgentsWorkingLabel,
  agentSubagentAnnouncement,
} from "./agentAgentsPanelPresentation";

const source = (id: string): AgentRuntimeSubagentSource => ({
  id,
  batchId: "spawn:a",
  observedState: "running",
  resumable: false,
  activityOrder: 0,
});

const counts = (
  overrides: Partial<Record<AgentRuntimeSubagentStatus, number>>,
): Readonly<Record<AgentRuntimeSubagentStatus, number>> => ({
  working: 0,
  idle: 0,
  completed: 0,
  failed: 0,
  stopped: 0,
  unknown: 0,
  ...overrides,
});

const group = (key: string, count: number, truncated = false) => ({
  key,
  subagents: projectAgentRuntimeSubagents(
    Array.from({ length: count }, (_, index) => source(`a${index}`)),
    truncated,
  ),
});

describe("agentAgentsPanelModel notice", () => {
  it("states truncation once for the whole projection", () => {
    expect(agentAgentsPanelModel([group("t1", 3)]).notice).toBeNull();
    expect(agentAgentsPanelModel([group("t1", 32, true)])).toMatchObject({
      notice: "Showing the first 32 agents",
      truncated: true,
    });
    expect(agentAgentsPanelModel([group("t1", 1, true)]).notice).toBe("Showing the first 1 agent");
  });

  it("says when only the latest rows fit", () => {
    const groups = Array.from({ length: 4 }, (_, index) => group(`t${index}`, 32));

    expect(agentAgentsPanelModel(groups).notice).toBe(
      `Showing the latest ${MAX_AGENTS_PANEL_ROWS} agents`,
    );
  });
});

describe("subagent announcements", () => {
  it("bounds the working label truthfully", () => {
    expect(agentAgentsWorkingLabel(1, false)).toBe("1 agent working");
    expect(agentAgentsWorkingLabel(32, true)).toBe("at least 32 agents working");
  });

  it("announces only count changes and the final settle", () => {
    expect(agentSubagentAnnouncement(null, counts({}), false)).toBeNull();
    expect(agentSubagentAnnouncement(null, counts({ working: 2 }), false)).toBe("2 agents working");
    expect(agentSubagentAnnouncement(2, counts({ working: 2 }), false)).toBeNull();
    expect(agentSubagentAnnouncement(2, counts({ working: 1 }), false)).toBe("1 agent working");
    expect(agentSubagentAnnouncement(1, counts({ completed: 3 }), false)).toBe(
      "All agents finished",
    );
    expect(agentSubagentAnnouncement(0, counts({}), false)).toBeNull();
    expect(agentSubagentAnnouncement(31, counts({ working: 32 }), true)).toBe(
      "At least 32 agents working",
    );
  });

  it("never claims every agent finished when some failed or stopped", () => {
    expect(agentSubagentAnnouncement(3, counts({ failed: 3 }), false)).toBe("3 agents failed");
    expect(agentSubagentAnnouncement(1, counts({ failed: 1 }), false)).toBe("1 agent failed");
    expect(agentSubagentAnnouncement(2, counts({ stopped: 2 }), false)).toBe("2 agents stopped");
    expect(agentSubagentAnnouncement(1, counts({ stopped: 1 }), false)).toBe("1 agent stopped");
    expect(agentSubagentAnnouncement(3, counts({ failed: 2, stopped: 1 }), false)).toBe(
      "2 agents failed, 1 stopped",
    );
    expect(agentSubagentAnnouncement(2, counts({ completed: 1, idle: 1 }), false)).toBe(
      "All agents finished",
    );
  });
});

describe("agentAgentsDockMode", () => {
  it("docks beside the thread and overlays only below the narrow threshold", () => {
    expect(agentAgentsDockMode(false, 300)).toBe("closed");
    expect(agentAgentsDockMode(true, AGENTS_DOCK_MIN_WIDTH)).toBe("docked");
    expect(agentAgentsDockMode(true, AGENTS_DOCK_MIN_WIDTH - 1)).toBe("overlay");
  });
});
