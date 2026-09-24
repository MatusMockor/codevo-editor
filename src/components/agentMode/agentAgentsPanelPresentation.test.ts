import { describe, expect, it } from "vitest";
import {
  projectAgentRuntimeSubagents,
  type AgentRuntimeSubagentSource,
  type AgentRuntimeSubagentStatus,
} from "../../domain/agentRuntimeSubagent";
import {
  MAX_AGENTS_PANEL_ROWS,
  agentAgentsPanelModel,
  agentAgentsWorkingLabel,
  agentSubagentAnnouncement,
  agentWorkingAgentNames,
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

const sourceOf = (
  overrides: Partial<AgentRuntimeSubagentSource> & { readonly id: string },
): AgentRuntimeSubagentSource => ({ ...source(overrides.id), ...overrides });

const groupOf = (key: string, sources: ReadonlyArray<AgentRuntimeSubagentSource>) => ({
  key,
  subagents: projectAgentRuntimeSubagents(sources, false),
});

describe("agents panel sections", () => {
  it("puts the latest turn with agents under This turn and older turns under Earlier", () => {
    const model = agentAgentsPanelModel([
      groupOf("t1", [
        sourceOf({
          id: "a",
          title: "Old A",
          observedState: "completed",
          durationMs: 30_000,
          totalTokens: 10_000,
        }),
        sourceOf({
          id: "b",
          title: "Old B",
          observedState: "completed",
          durationMs: 65_000,
          totalTokens: 21_000,
        }),
      ]),
      groupOf("t2", []),
      groupOf("t3", [
        sourceOf({ id: "c", title: "Review", role: "reviewer", progress: "Read src/app.ts" }),
        sourceOf({ id: "d", title: "Map", observedState: "completed", durationMs: 48_000 }),
      ]),
    ]);
    expect(model.current.map((row) => row.agent.title)).toEqual(["Review", "Map"]);
    expect(model.earlier).toEqual([
      expect.objectContaining({
        key: "t1",
        label: "Ran 2 subagents",
        summary: "2 agents · 31.0k tok · 1m 05s",
        tone: "completed",
      }),
    ]);
    expect(model.working).toBe(1);
    expect(model.settled).toBe(3);
  });

  it("names the working agents by role, falling back to the title", () => {
    expect(
      agentWorkingAgentNames([
        groupOf("t1", [
          sourceOf({ id: "a", title: "Review", role: "reviewer" }),
          sourceOf({ id: "b", title: "Write retry tests" }),
          sourceOf({ id: "c", title: "Done", observedState: "completed" }),
        ]),
      ]),
    ).toEqual(["reviewer", "Write retry tests"]);
  });
});
