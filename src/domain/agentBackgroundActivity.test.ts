import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "./agentThread";
import {
  projectAgentBackgroundActivity,
  projectAgentBackgroundState,
  resolveAgentBackgroundActivity,
  MAX_AGENT_BACKGROUND_TASKS,
  MAX_AGENT_BACKGROUND_OBSERVED_TASKS,
  MAX_AGENT_BACKGROUND_OPEN_ROOT_TOOLS,
} from "./agentBackgroundActivity";

const settledByInference = (events: ReadonlyArray<AgentTurnEvent>, processAlive: boolean) =>
  resolveAgentBackgroundActivity(projectAgentBackgroundState(events, processAlive), "settled");

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
const backgroundAgentLaunch: AgentTurnEvent[] = [
  {
    kind: "toolCall",
    toolId: "spawn",
    name: "Agent",
    inputSummary: "Review the gateway",
    description: "Gateway review",
  },
  { kind: "subagent", status: "starting", toolId: "spawn", taskId: "agent-task" },
  task("starting", "agent", "agent-task"),
  {
    kind: "toolResult",
    toolId: "spawn",
    outputSummary: "Async agent launched successfully.",
    isError: false,
  },
];
const launchShell: AgentTurnEvent = {
  kind: "toolCall",
  toolId: "shell",
  name: "Bash",
  inputSummary: "npm test",
};
const launchShellResult: AgentTurnEvent = {
  kind: "toolResult",
  toolId: "shell",
  outputSummary: "Command running in background",
  isError: false,
};
const leadAnswer: AgentTurnEvent = {
  kind: "assistantText",
  text: "The gateway review is running; I will summarize when it finishes.",
};

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
        [...events, { kind: "toolCall", toolId: "late", name: "Bash", inputSummary: "gh run" }],
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
        [...events, { kind: "toolCall", toolId: "root", name: "Read", inputSummary: "a.ts" }],
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
  it("settles an idle lead without result while live tasks run and no root tool is open", () => {
    const events = [...backgroundAgentLaunch, leadAnswer];
    expect(projectAgentBackgroundActivity(events, true).foregroundSettled).toBe(false);
    expect(settledByInference(events, true)).toMatchObject({
      phase: "working",
      foregroundSettled: true,
      tasks: [{ taskId: "agent-task", taskType: "agent" }],
    });
    expect(
      settledByInference([task("starting"), launchShell, launchShellResult, leadAnswer], true),
    ).toMatchObject({ phase: "monitoring", foregroundSettled: true });
    expect(
      settledByInference(
        [...events, { kind: "assistantText", text: "child", parentToolId: "spawn" }],
        true,
      ).foregroundSettled,
    ).toBe(true);
  });
  it("does not infer an idle lead while a root tool call is open", () => {
    const foregroundAgent: AgentTurnEvent[] = [
      { kind: "toolCall", toolId: "spawn", name: "Agent", inputSummary: "Echo alpha" },
      task("starting", "agent", "agent-task"),
      { kind: "assistantText", text: "I will wait for the agent" },
    ];
    expect(projectAgentBackgroundActivity(foregroundAgent, true)).toMatchObject({
      phase: "working",
      foregroundSettled: false,
    });
    expect(
      projectAgentBackgroundActivity([...backgroundAgentLaunch, leadAnswer, launchShell], true)
        .foregroundSettled,
    ).toBe(false);
    expect(
      projectAgentBackgroundActivity(
        [...backgroundAgentLaunch, leadAnswer, { kind: "reasoning", text: "Next step" }],
        true,
      ).foregroundSettled,
    ).toBe(false);
  });
  it("never infers an idle lead from prose alone, from history, or from lossy events", () => {
    expect(projectAgentBackgroundActivity([leadAnswer], true)).toMatchObject({
      phase: "inactive",
      foregroundSettled: false,
    });
    expect(
      projectAgentBackgroundActivity(
        [...backgroundAgentLaunch, leadAnswer, task("completed", "agent", "agent-task")],
        true,
      ).foregroundSettled,
    ).toBe(false);
    expect(
      projectAgentBackgroundActivity([...backgroundAgentLaunch, leadAnswer], false),
    ).toMatchObject({ phase: "inactive", foregroundSettled: false });
    expect(
      projectAgentBackgroundActivity([...backgroundAgentLaunch, leadAnswer], true, true),
    ).toMatchObject({ phase: "working", foregroundSettled: false, truncated: true });
  });
  it("treats a wake-up that begins with root reasoning or a user message as foreground work", () => {
    const settled = [task("starting"), result];
    expect(projectAgentBackgroundActivity(settled, true).foregroundSettled).toBe(true);
    expect(
      projectAgentBackgroundActivity([...settled, { kind: "reasoning", text: "Checking" }], true)
        .foregroundSettled,
    ).toBe(false);
    expect(
      projectAgentBackgroundActivity(
        [...settled, { kind: "userMessage", text: "Now deploy" }],
        true,
      ).foregroundSettled,
    ).toBe(false);
    expect(
      projectAgentBackgroundActivity(
        [...settled, { kind: "reasoning", text: "child", parentToolId: "spawn" }],
        true,
      ).foregroundSettled,
    ).toBe(true);
  });
  it("distinguishes result-confirmed settlement from inferred idle", () => {
    const shell = [launchShell, launchShellResult, task("starting")];
    expect(projectAgentBackgroundState([...shell, leadAnswer, result], true).foreground).toEqual({
      kind: "settled",
    });
    expect(projectAgentBackgroundState([...shell, launchShell], true).foreground).toEqual({
      kind: "running",
    });
    const inferred = projectAgentBackgroundState([...shell, leadAnswer], true);
    expect(inferred.foreground.kind).toBe("inferredIdle");
    expect(resolveAgentBackgroundActivity(inferred, "pending")).toMatchObject({
      phase: "working",
      foregroundSettled: false,
    });
    expect(resolveAgentBackgroundActivity(inferred, "settled")).toMatchObject({
      phase: "monitoring",
      foregroundSettled: true,
    });
    expect(projectAgentBackgroundActivity([...shell, leadAnswer], true)).toEqual(
      resolveAgentBackgroundActivity(inferred, "pending"),
    );
  });
  it("moves the inferred idle anchor on every new root event but not on background progress", () => {
    const shell = [launchShell, launchShellResult, task("starting")];
    const anchor = (events: ReadonlyArray<AgentTurnEvent>) => {
      const { foreground } = projectAgentBackgroundState(events, true);
      return foreground.kind === "inferredIdle" ? foreground.anchor : null;
    };
    const first = anchor([...shell, leadAnswer]);
    expect(first).not.toBeNull();
    expect(anchor([...shell, leadAnswer, task("running")])).toBe(first);
    const grown = anchor([...shell, { kind: "assistantText", text: "The gateway review" }]);
    expect(grown).not.toBe(first);
    const later = anchor([...shell, leadAnswer, launchShell, launchShellResult, leadAnswer]);
    expect(later).not.toBeNull();
    expect(later).not.toBe(first);
  });
  it("fails closed when open root tool tracking overflows", () => {
    const calls: AgentTurnEvent[] = Array.from(
      { length: MAX_AGENT_BACKGROUND_OPEN_ROOT_TOOLS + 1 },
      (_, i) => ({ kind: "toolCall", toolId: `t-${i}`, name: "Read", inputSummary: "a" }),
    );
    const results: AgentTurnEvent[] = calls.map((_, i) => ({
      kind: "toolResult",
      toolId: `t-${i}`,
      outputSummary: "ok",
      isError: false,
    }));
    expect(
      settledByInference([...calls, ...results, task("starting"), leadAnswer], true)
        .foregroundSettled,
    ).toBe(false);
    expect(
      settledByInference([...calls.slice(1), ...results, task("starting"), leadAnswer], true)
        .foregroundSettled,
    ).toBe(true);
  });
  it("does not resurrect terminal IDs from late progress or terminal updates", () => {
    for (const terminal of ["completed", "failed", "stopped"] as const) {
      expect(
        projectAgentBackgroundActivity([task(terminal), task("running"), result], true).tasks,
      ).toEqual([]);
      for (const late of ["completed", "failed", "stopped"] as const) {
        expect(
          projectAgentBackgroundActivity([task(terminal), task(late), result], true).tasks,
        ).toEqual([]);
      }
    }
  });
  it("revives a terminal ID only on a genuine restart", () => {
    for (const terminal of ["completed", "failed", "stopped"] as const) {
      expect(
        projectAgentBackgroundActivity(
          [task(terminal), task("starting"), task("running"), result],
          true,
        ),
      ).toMatchObject({ phase: "monitoring", tasks: [{ taskId: "task-1", taskType: "shell" }] });
    }
  });
  it("keeps a resumed background agent live after the previous process reported it stopped", () => {
    const resumed = [
      task("stopped", "agent", "agent-task"),
      task("starting", "agent", "agent-task"),
      result,
    ];
    expect(projectAgentBackgroundActivity(resumed, true)).toMatchObject({
      phase: "working",
      foregroundSettled: true,
      tasks: [{ taskId: "agent-task", taskType: "agent" }],
      truncated: false,
    });
    expect(
      projectAgentBackgroundActivity([...resumed, task("completed", "agent", "agent-task")], true),
    ).toMatchObject({ phase: "inactive", tasks: [] });
  });
  it("revives a finished agent whose progress arrives under the resuming tool call", () => {
    const agentId = "a4b355dcf6056a875";
    const launch = "toolu_012nR5ST1SeGiHfvahNc1s2X";
    const resume = "toolu_019eyG6GAy4aZoYrH76mTu6u";
    const title = "Live Codex model catalog like Claude";
    const native = (
      status: Extract<AgentTurnEvent, { kind: "backgroundTask" }>["status"],
      taskType: Extract<AgentTurnEvent, { kind: "backgroundTask" }>["taskType"],
      description?: string,
    ): AgentTurnEvent => ({
      kind: "backgroundTask",
      taskId: agentId,
      status,
      taskType,
      ...(description === undefined ? {} : { description }),
    });
    const progress = (toolId: string, description: string): AgentTurnEvent[] => [
      {
        kind: "subagent",
        status: "running",
        toolId,
        taskId: agentId,
        subagentType: "general-purpose",
        description,
      },
      native("running", "other", description),
    ];
    const finishedRun: AgentTurnEvent[] = [
      {
        kind: "subagent",
        status: "starting",
        toolId: launch,
        taskId: agentId,
        subagentType: "general-purpose",
        description: title,
      },
      native("starting", "agent", title),
      ...progress(launch, "Running Show changed files and sizes"),
      { kind: "subagent", status: "completed", taskId: agentId },
      native("completed", "other"),
      { kind: "subagent", status: "completed", toolId: launch, taskId: agentId },
      native("completed", "other"),
      result,
    ];
    expect(
      projectAgentBackgroundActivity(
        [...finishedRun, ...progress(resume, "Running Run presentation and domain tests")],
        true,
      ),
    ).toMatchObject({
      phase: "working",
      tasks: [{ taskId: agentId, taskType: "agent" }],
    });
    expect(
      projectAgentBackgroundActivity(
        [...finishedRun, ...progress(launch, "Running Show changed files and sizes")],
        true,
      ).tasks,
    ).toEqual([]);
    expect(
      projectAgentBackgroundActivity(
        [
          ...finishedRun,
          ...progress(resume, "Running Run presentation and domain tests"),
          { kind: "subagent", status: "completed", toolId: resume, taskId: agentId },
          native("completed", "other"),
        ],
        true,
      ).tasks,
    ).toEqual([]);
  });
  it("revives only a finished agent run whose tool call is known, keeping its native type", () => {
    const taskId = "a4b355dcf6056a875";
    const resumed: AgentTurnEvent = {
      kind: "subagent",
      status: "running",
      toolId: "toolu_019eyG6GAy4aZoYrH76mTu6u",
      taskId,
    };
    const progress = task("running", "other", taskId);
    const untracked = [
      task("starting", "agent", taskId),
      task("completed", "other", taskId),
      result,
    ];
    expect(projectAgentBackgroundActivity([...untracked, resumed, progress], true).tasks).toEqual(
      [],
    );
    const launch: AgentTurnEvent = {
      kind: "subagent",
      status: "starting",
      toolId: "toolu_012nR5ST1SeGiHfvahNc1s2X",
      taskId,
    };
    const shell = [launch, task("starting", "shell", taskId), task("completed", "other", taskId)];
    expect(
      projectAgentBackgroundActivity([...shell, result, resumed, progress], true).tasks,
    ).toEqual([]);
    const agent = [launch, task("starting", "agent", taskId), task("completed", "other", taskId)];
    expect(
      projectAgentBackgroundActivity([...agent, result, resumed, progress], true).tasks,
    ).toEqual([{ taskId, taskType: "agent", description: "Watch pipeline" }]);
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
    const events = [...terminals, task("running", "shell", "done-0"), result];
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
    expect(
      projectAgentBackgroundActivity(
        [...terminals, task("starting", "shell", "done-0"), result],
        true,
      ),
    ).toMatchObject({ phase: "working", truncated: true, tasks: [{ taskId: "done-0" }] });
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
