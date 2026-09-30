import { describe, expect, it } from "vitest";
import type { AgentSessionBackground } from "../../../domain/agentSessionBackground";
import { agentSessionTaskControls, agentSessionTaskLabel } from "./agentSessionTaskControls";

const NONE: ReadonlySet<string> = new Set();

const watch: AgentSessionBackground = {
  ownerId: "ws-1",
  total: 1,
  agents: 0,
  tasks: [
    { taskId: "b8kzpiexm", taskType: "shell", description: "Watch beta.75 release workflow" },
  ],
  sinceEpochMs: 1,
  taskSinceEpochMs: new Map([["b8kzpiexm", 1]]),
};

describe("agentSessionTaskControls", () => {
  it("offers nothing without a live session level", () => {
    expect(agentSessionTaskControls(null, NONE, "offered")).toBeNull();
  });

  it("carries the End session offer for a live session level", () => {
    expect(agentSessionTaskControls(watch, NONE, "offered")).toEqual({
      pendingTaskIds: new Set(),
      endSession: "offered",
    });
    expect(agentSessionTaskControls(watch, NONE, "suggested")?.endSession).toBe("suggested");
  });

  it("keeps only pending stops of tasks that are still live", () => {
    const controls = agentSessionTaskControls(
      {
        ...watch,
        total: 2,
        tasks: [...watch.tasks, { taskId: "c9", taskType: "monitor", description: "Tail logs" }],
      },
      new Set(["c9", "gone"]),
      "hidden",
    );
    expect(controls?.pendingTaskIds).toEqual(new Set(["c9"]));
    expect(controls?.endSession).toBe("hidden");
  });

  it("returns the previous controls and pending set while their contents are unchanged", () => {
    const first = agentSessionTaskControls(watch, new Set(["b8kzpiexm"]), "offered");
    const again = agentSessionTaskControls(watch, new Set(["b8kzpiexm"]), "offered", first);
    expect(again).toBe(first);
    const suggested = agentSessionTaskControls(watch, new Set(["b8kzpiexm"]), "suggested", first);
    expect(suggested).not.toBe(first);
    expect(suggested?.pendingTaskIds).toBe(first?.pendingTaskIds);
    const cleared = agentSessionTaskControls(watch, NONE, "offered", first);
    expect(cleared?.pendingTaskIds).toEqual(new Set());
  });

  it("falls back to a neutral label naming the task id when Claude gave no description", () => {
    expect(agentSessionTaskLabel({ taskId: "b8kzpiexm", taskType: "shell" })).toBe(
      "Shell command b8kzpiexm",
    );
    expect(agentSessionTaskLabel({ taskId: "a1", taskType: "agent", description: "   " })).toBe(
      "Agent a1",
    );
    expect(agentSessionTaskLabel({ taskId: "m1", taskType: "monitor" })).toBe("Monitor m1");
    expect(agentSessionTaskLabel({ taskId: "o1", taskType: "other" })).toBe("Background task o1");
    expect(
      agentSessionTaskLabel({ taskId: "o1", taskType: "other", description: "  Build  " }),
    ).toBe("Build");
  });
});
