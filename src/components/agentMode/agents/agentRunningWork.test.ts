import { describe, expect, it } from "vitest";
import {
  projectAgentRuntimeSubagents,
  type AgentRuntimeSubagentSource,
} from "../../../domain/agentRuntimeSubagent";
import type { AgentSessionBackground } from "../../../domain/agentSessionBackground";
import type { AgentAgentsPanelGroup } from "../agentAgentsPanelPresentation";
import {
  MAX_AGENT_RUNNING_ROWS,
  agentRunningLabel,
  agentRunningStopPolicy,
  agentRunningStopReasonText,
  agentRunningWork,
  reuseAgentRunningWork,
  type AgentRunningStopPolicy,
  type AgentRunningWorkSource,
} from "./agentRunningWork";

const PER_TASK: AgentRunningStopPolicy = { kind: "perTask", pendingTaskIds: new Set() };

function source(id: string, overrides: Partial<AgentRuntimeSubagentSource> = {}) {
  return {
    id,
    batchId: "entry:batch",
    observedState: "running",
    resumable: false,
    activityOrder: 0,
    title: `Agent ${id}`,
    ...overrides,
  } satisfies AgentRuntimeSubagentSource;
}

function group(key: string, sources: ReadonlyArray<AgentRuntimeSubagentSource>) {
  return {
    key,
    subagents: projectAgentRuntimeSubagents(sources, false),
  } satisfies AgentAgentsPanelGroup;
}

function session(
  tasks: AgentSessionBackground["tasks"],
  counts: { total?: number; agents?: number } = {},
): AgentSessionBackground {
  return {
    ownerId: "ws-1",
    total: counts.total ?? tasks.length,
    agents: counts.agents ?? tasks.filter((task) => task.taskType === "agent").length,
    tasks,
    sinceEpochMs: 1_000,
    taskSinceEpochMs: new Map(tasks.map((task, index) => [task.taskId, 1_000 + index])),
    reply: { kind: "none" },
  };
}

function work(overrides: Partial<AgentRunningWorkSource> = {}) {
  return agentRunningWork({
    provider: "claudeCode",
    groups: [],
    session: null,
    live: null,
    stop: PER_TASK,
    ...overrides,
  });
}

describe("agent running work", () => {
  it("is empty and unlabelled when nothing runs", () => {
    const empty = work({ groups: [group("t1", [source("a", { observedState: "completed" })])] });
    expect(empty.rows).toEqual([]);
    expect(agentRunningLabel(empty)).toBeNull();
  });

  it("counts every combination of agents and background tasks truthfully", () => {
    expect(agentRunningLabel(work({ groups: [group("t1", [source("a")])] }))).toBe(
      "1 agent running",
    );
    expect(
      agentRunningLabel(work({ groups: [group("t1", [source("a"), source("b"), source("c")])] })),
    ).toBe("3 agents running");
    expect(
      agentRunningLabel(
        work({
          groups: [group("t1", [source("a"), source("b")])],
          session: session([{ taskId: "s1", taskType: "shell", description: "Run tests" }]),
        }),
      ),
    ).toBe("2 agents running · 1 background task");
    expect(
      agentRunningLabel(
        work({
          session: session([
            { taskId: "s1", taskType: "shell" },
            { taskId: "m1", taskType: "monitor" },
          ]),
        }),
      ),
    ).toBe("2 background tasks running");
    expect(
      agentRunningLabel(work({ session: session([{ taskId: "s1", taskType: "shell" }]) })),
    ).toBe("1 background task running");
    expect(
      agentRunningLabel(
        work({ live: { tasks: [{ taskId: "s1", taskType: "shell" }], truncated: true } }),
      ),
    ).toBe("Background tasks running");
    expect(
      agentRunningLabel(
        work({
          groups: [group("t1", [source("a")])],
          live: { tasks: [], truncated: true },
        }),
      ),
    ).toBe("At least 1 agent running · background tasks");
  });

  it("never double counts a subagent that is also a live background agent task", () => {
    const running = work({
      groups: [group("t1", [source("tool-a", { taskId: "task-a" }), source("tool-b")])],
      session: session([
        { taskId: "task-a", taskType: "agent", description: "Review" },
        { taskId: "task-c", taskType: "agent", description: "Resumed reviewer" },
      ]),
      live: { tasks: [{ taskId: "task-a", taskType: "agent" }], truncated: false },
    });
    expect(running.agents).toBe(3);
    expect(running.tasks).toBe(0);
    expect(agentRunningLabel(running)).toBe("3 agents running");
    expect(running.rows.map((row) => row.key)).toEqual(["t1:tool-a", "t1:tool-b", "task:task-c"]);
  });

  it("counts session tasks Claude reported but did not list", () => {
    const running = work({
      session: session([{ taskId: "a1", taskType: "agent" }], { total: 5, agents: 3 }),
    });
    expect(running.agents).toBe(3);
    expect(running.tasks).toBe(2);
    expect(agentRunningLabel(running)).toBe("3 agents running · 2 background tasks");
    expect(running.rows).toHaveLength(1);
    expect(running.unlisted).toBe(4);
  });

  it("offers the exact per-task stop only for tasks in Claude's live session", () => {
    const running = work({
      groups: [group("t1", [source("tool-a", { taskId: "task-a" }), source("tool-b")])],
      session: session([
        { taskId: "task-a", taskType: "agent", description: "Review" },
        { taskId: "s1", taskType: "shell", description: "Watch release" },
      ]),
      live: { tasks: [{ taskId: "turn-only", taskType: "monitor" }], truncated: false },
      stop: { kind: "perTask", pendingTaskIds: new Set(["s1"]) },
    });
    expect(running.rows.map((row) => [row.key, row.stop])).toEqual([
      ["t1:tool-a", { kind: "stoppable", taskId: "task-a" }],
      ["t1:tool-b", { kind: "unavailable", reason: "turn" }],
      ["task:s1", { kind: "stopping", taskId: "s1" }],
      ["task:turn-only", { kind: "unavailable", reason: "unlisted" }],
    ]);
    const task = running.rows[2];
    expect(task?.kind === "task" ? [task.title, task.typeLabel, task.elapsed] : null).toEqual([
      "Watch release",
      "Shell",
      { kind: "since", sinceEpochMs: 1_001 },
    ]);
    const turnOnly = running.rows[3];
    expect(turnOnly?.kind === "task" ? turnOnly.elapsed : null).toEqual({ kind: "unknown" });
  });

  it("says truthfully why a row cannot stop on its own", () => {
    const codex = work({ provider: "codex", groups: [group("t1", [source("thread:a")])] });
    expect(codex.rows[0]?.stop).toEqual({ kind: "unavailable", reason: "codex" });
    const unlistedAgent = work({ groups: [group("t1", [source("tool-a", { taskId: "x" })])] });
    expect(unlistedAgent.rows[0]?.stop).toEqual({ kind: "unavailable", reason: "unlisted" });
    const remote = work({
      session: session([{ taskId: "s1", taskType: "shell" }]),
      stop: agentRunningStopPolicy({ remote: true, pendingTaskIds: new Set() }),
    });
    expect(remote.rows[0]?.stop).toEqual({ kind: "unavailable", reason: "remote" });
    const noPort = work({
      session: session([{ taskId: "s1", taskType: "shell" }]),
      stop: agentRunningStopPolicy({ remote: false, pendingTaskIds: null }),
    });
    expect(noPort.rows[0]?.stop).toEqual({ kind: "unavailable", reason: "unavailable" });
    expect(agentRunningStopPolicy({ remote: false, pendingTaskIds: new Set(["s1"]) })).toEqual({
      kind: "perTask",
      pendingTaskIds: new Set(["s1"]),
    });
    expect(agentRunningStopReasonText("unlisted")).toBe(
      "Claude's session doesn't list this task, so it can't be stopped on its own. Stop the turn or end the session instead.",
    );
  });

  it("scopes the agent lower bound to the live turn and truncated live events", () => {
    const truncated = {
      key: "t1",
      subagents: projectAgentRuntimeSubagents([source("a")], true),
    } satisfies AgentAgentsPanelGroup;
    expect(agentRunningLabel(work({ groups: [truncated] }))).toBe("At least 1 agent running");
    expect(agentRunningLabel(work({ groups: [truncated, group("t2", [source("b")])] }))).toBe(
      "2 agents running",
    );
    expect(
      agentRunningLabel(
        work({ groups: [group("t2", [source("b")])], live: { tasks: [], truncated: true } }),
      ),
    ).toBe("At least 1 agent running · background tasks");
  });

  it("never double counts known tasks above Claude's listed cap", () => {
    const listed = [
      ...Array.from({ length: 30 }, (_, index) => ({
        taskId: `s${index}`,
        taskType: "shell" as const,
      })),
      { taskId: "a0", taskType: "agent" as const },
      { taskId: "a1", taskType: "agent" as const },
    ];
    const running = work({
      groups: [
        group("t1", [source("tool-x1", { taskId: "x1" }), source("tool-x2", { taskId: "x2" })]),
      ],
      session: session(listed, { total: 40, agents: 6 }),
      live: {
        tasks: [
          { taskId: "x1", taskType: "agent" },
          { taskId: "l1", taskType: "shell" },
        ],
        truncated: false,
      },
    });
    expect(running.agents).toBe(6);
    expect(running.tasks).toBe(34);
    expect(agentRunningLabel(running)).toBe("6 agents running · 34 background tasks");
    expect(running.rows).toHaveLength(35);
    expect(running.unlisted).toBe(5);
  });

  it("reuses unchanged rows and the whole snapshot when nothing changed", () => {
    const input = {
      groups: [group("t1", [source("tool-a", { taskId: "task-a" })])],
      session: session([
        { taskId: "task-a", taskType: "agent" as const },
        { taskId: "s1", taskType: "shell" as const },
      ]),
    };
    const first = work(input);
    expect(reuseAgentRunningWork(first, work(input))).toBe(first);
    const pending = reuseAgentRunningWork(
      first,
      work({ ...input, stop: { kind: "perTask", pendingTaskIds: new Set(["s1"]) } }),
    );
    expect(pending).not.toBe(first);
    expect(pending.rows[0]).toBe(first.rows[0]);
    expect(pending.rows[1]).not.toBe(first.rows[1]);
    expect(pending.rows[1]?.stop).toEqual({ kind: "stopping", taskId: "s1" });
  });

  it("bounds the rows and reports how many more run", () => {
    const tasks = Array.from({ length: MAX_AGENT_RUNNING_ROWS + 20 }, (_, index) => ({
      taskId: `s${index}`,
      taskType: "shell" as const,
    }));
    const running = work({ session: session(tasks) });
    expect(running.rows).toHaveLength(MAX_AGENT_RUNNING_ROWS);
    expect(running.unlisted).toBe(20);
    expect(running.tasks).toBe(MAX_AGENT_RUNNING_ROWS + 20);
  });
});
