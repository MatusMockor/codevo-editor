import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "./agentThread";
import {
  projectAgentBackgroundActivity,
  MAX_AGENT_BACKGROUND_TASKS,
  MAX_AGENT_BACKGROUND_OBSERVED_TASKS,
} from "./agentBackgroundActivity";

const task = (
  status: Extract<AgentTurnEvent, { kind: "backgroundTask" }>["status"],
  taskType: Extract<AgentTurnEvent, { kind: "backgroundTask" }>["taskType"] = "shell",
  taskId = "task-1",
): AgentTurnEvent => ({
  kind: "backgroundTask",
  taskId,
  status,
  taskType,
  description: "Watch pipeline",
});
const result: AgentTurnEvent = { kind: "result", text: "Watching", isError: false, usage: null };

describe("factual background activity", () => {
  it("separates settled foreground from ongoing monitor and late provider response", () => {
    const events = [task("starting"), result];
    expect(projectAgentBackgroundActivity(events, true)).toMatchObject({
      phase: "monitoring",
      foregroundSettled: true,
      tasks: [{ taskId: "task-1" }],
    });
    expect(
      projectAgentBackgroundActivity(
        [...events, { kind: "assistantText", text: "Pipeline completed" }],
        true,
      ),
    ).toMatchObject({ phase: "working", foregroundSettled: false });
    expect(
      projectAgentBackgroundActivity([...events, task("completed"), result], true),
    ).toMatchObject({ phase: "inactive", foregroundSettled: true, tasks: [] });
  });
  it("ignores child output while root output resumes foreground work", () => {
    const events: AgentTurnEvent[] = [
      task("starting"),
      result,
      { kind: "assistantText", text: "child result", parentToolId: "child-owner" },
      {
        kind: "toolCall",
        toolId: "tool-child",
        name: "Bash",
        inputSummary: "echo",
        parentToolId: "child-owner",
      },
    ];
    expect(projectAgentBackgroundActivity(events, true)).toMatchObject({
      phase: "monitoring",
      foregroundSettled: true,
    });
    expect(
      projectAgentBackgroundActivity(
        [...events, { kind: "assistantText", text: "root reply" }],
        true,
      ),
    ).toMatchObject({ phase: "working", foregroundSettled: false });
  });
  it("keeps agent and unknown work working even after result", () => {
    for (const type of ["agent", "other"] as const)
      expect(projectAgentBackgroundActivity([task("starting", type), result], true).phase).toBe(
        "working",
      );
  });
  it("ignores assistant promises and taskless progress", () => {
    expect(
      projectAgentBackgroundActivity(
        [{ kind: "assistantText", text: "I will monitor the pipeline" }, result, task("running")],
        true,
      ).tasks,
    ).toEqual([]);
  });
  it("does not resurrect terminal IDs from late progress or duplicate starts", () => {
    for (const terminal of ["completed", "failed", "stopped"] as const) {
      expect(
        projectAgentBackgroundActivity(
          [task(terminal), task("starting"), task("running"), result],
          true,
        ).tasks,
      ).toEqual([]);
    }
  });
  it("deduplicates starts and retains task type when progress omits native type", () => {
    expect(
      projectAgentBackgroundActivity(
        [task("starting"), task("starting"), task("running", "other"), result],
        true,
      ),
    ).toMatchObject({ phase: "monitoring", tasks: [{ taskType: "shell" }] });
  });
  it("clears historical live work after actual stop or exit", () => {
    expect(projectAgentBackgroundActivity([task("starting"), result], false)).toMatchObject({
      phase: "inactive",
      tasks: [],
      truncated: false,
    });
  });
  it("retains monitoring after hundreds of serial tasks and bounds observed tombstones", () => {
    const serial: AgentTurnEvent[] = Array.from({ length: 300 }, (_, i) => [
      task("starting", "shell", `s-${i}`),
      task("completed", "shell", `s-${i}`),
    ]).flat();
    expect(
      projectAgentBackgroundActivity([...serial, task("starting"), result], true),
    ).toMatchObject({ phase: "monitoring", truncated: false, tasks: [{ taskId: "task-1" }] });
    const terminals = Array.from({ length: MAX_AGENT_BACKGROUND_OBSERVED_TASKS + 1 }, (_, i) =>
      task("completed", "shell", `done-${i}`),
    );
    const events = [...terminals, task("starting", "shell", "done-0"), result];
    expect(projectAgentBackgroundActivity(events, true)).toMatchObject({
      phase: "working",
      truncated: true,
      tasks: [],
    });
    expect(projectAgentBackgroundActivity(events, false)).toMatchObject({
      phase: "inactive",
      truncated: false,
      tasks: [],
    });
  });
  it("bounds active work and reports uncertainty instead of false idle", () => {
    const starts = Array.from({ length: MAX_AGENT_BACKGROUND_TASKS + 1 }, (_, i) =>
      task("starting", "shell", `t-${i}`),
    );
    const ends = starts.map((_, i) => task("completed", "shell", `t-${i}`));
    expect(projectAgentBackgroundActivity(starts, true).tasks).toHaveLength(
      MAX_AGENT_BACKGROUND_TASKS,
    );
    expect(projectAgentBackgroundActivity([...starts, ...ends, result], true)).toMatchObject({
      phase: "working",
      truncated: true,
      tasks: [],
    });
    expect(projectAgentBackgroundActivity([result], true, true)).toMatchObject({
      phase: "working",
      truncated: true,
    });
    expect(projectAgentBackgroundActivity([result], false, true)).toMatchObject({
      phase: "inactive",
      truncated: false,
    });
  });
});
