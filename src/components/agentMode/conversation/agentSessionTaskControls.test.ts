import { describe, expect, it } from "vitest";
import type { AgentSessionBackground } from "../../../domain/agentSessionBackground";
import {
  MAX_AGENT_SESSION_TASK_ROWS,
  agentSessionTaskControls,
  agentSessionTaskLabel,
} from "./agentSessionTaskControls";

const NONE: ReadonlySet<string> = new Set();

const watch: AgentSessionBackground = {
  ownerId: "ws-1",
  total: 1,
  agents: 0,
  tasks: [
    { taskId: "b8kzpiexm", taskType: "shell", description: "Watch beta.75 release workflow" },
  ],
  sinceEpochMs: 1,
};

describe("agentSessionTaskControls", () => {
  it("offers nothing without a live session level", () => {
    expect(agentSessionTaskControls(null, NONE, "offered")).toBeNull();
  });

  it("lists a live session task with its own Stop and offers End session", () => {
    expect(agentSessionTaskControls(watch, NONE, "offered")).toEqual({
      rows: [
        {
          taskId: "b8kzpiexm",
          label: "Watch beta.75 release workflow",
          stopLabel: 'Stop background task "Watch beta.75 release workflow"',
          pending: false,
        },
      ],
      hiddenCount: 0,
      endSession: "offered",
    });
    expect(agentSessionTaskControls(watch, NONE, "suggested")?.endSession).toBe("suggested");
  });

  it("marks only the exact pending task as stopping and hides End session while a turn runs", () => {
    const controls = agentSessionTaskControls(
      {
        ...watch,
        total: 2,
        tasks: [...watch.tasks, { taskId: "c9", taskType: "monitor", description: "Tail logs" }],
      },
      new Set(["c9"]),
      "hidden",
    );
    expect(controls?.rows.map((row) => [row.taskId, row.pending])).toEqual([
      ["b8kzpiexm", false],
      ["c9", true],
    ]);
    expect(controls?.endSession).toBe("hidden");
  });

  it("bounds the rows and counts every other live task, listed or not", () => {
    const tasks = Array.from({ length: 5 }, (_, index) => ({
      taskId: `task-${index}`,
      taskType: "shell" as const,
      description: `Command ${index}`,
    }));
    const controls = agentSessionTaskControls({ ...watch, total: 9, tasks }, NONE, "offered");
    expect(controls?.rows).toHaveLength(MAX_AGENT_SESSION_TASK_ROWS);
    expect(controls?.rows.map((row) => row.taskId)).toEqual(["task-0", "task-1", "task-2"]);
    expect(controls?.hiddenCount).toBe(6);
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
