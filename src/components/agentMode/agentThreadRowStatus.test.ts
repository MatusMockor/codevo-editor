import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentBackgroundActivity } from "../../domain/agentBackgroundActivity";
import type { AgentTurn } from "../../domain/agentThread";
import type { AgentSessionBackground } from "../../domain/agentSessionBackground";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  agentRowElapsedLabel,
  agentRowIsLive,
  agentRowStatus,
  agentRowStatusLabel,
  agentRowStatusTitle,
  agentRowStatusTone,
  agentRowWorkingAgents,
  type AgentRowStatus,
} from "./agentThreadRowStatus";

type LifecycleState = "running" | "completed";

function runningView(
  lifecycleStates: ReadonlyArray<LifecycleState>,
  nested: ReadonlyArray<LifecycleState> = [],
): AgentThreadView {
  const entry = (state: LifecycleState, index: number, parentToolId?: string) => ({
    id: `thread:${parentToolId ?? "root"}:${index}`,
    agentThreadId: `c${index}`,
    name: "subagent",
    description: "",
    state,
    telemetryState: state,
    ...(parentToolId === undefined ? {} : { parentToolId }),
  });
  const turn = {
    turnId: "t1",
    status: { kind: "running" },
    startedAtEpochMs: 1_000,
    events: [],
    eventsTruncated: false,
    subagentLifecycle: {
      truncated: false,
      entries: [
        ...lifecycleStates.map((state, index) => entry(state, index)),
        ...nested.map((state, index) => entry(state, index, "tool-1")),
      ],
    },
  } as unknown as AgentTurn;
  return {
    unread: false,
    thread: { threadId: "a", archived: false, provider: { kind: "codex" }, turns: [turn] },
  } as unknown as AgentThreadView;
}

function settledView(): AgentThreadView {
  const turn = {
    turnId: "t1",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 1_000,
    events: [],
    eventsTruncated: false,
  } as unknown as AgentTurn;
  return {
    unread: true,
    thread: { threadId: "a", archived: false, provider: { kind: "codex" }, turns: [turn] },
  } as unknown as AgentThreadView;
}

function agentsStatus(count: number, lead: "working" | "waiting"): AgentRowStatus {
  return { kind: "agents", count, lead, startedAtEpochMs: 0 };
}

function background(
  foregroundSettled: boolean,
  tasks: AgentBackgroundActivity["tasks"],
): AgentBackgroundActivity {
  return {
    phase: tasks.length === 0 ? "inactive" : "working",
    foregroundSettled,
    tasks,
    truncated: false,
  } as AgentBackgroundActivity;
}

const agentTask = (taskId: string) => ({ taskId, taskType: "agent" }) as const;

describe("row status for background work", () => {
  it("shows a foreground turn alone as Working with its elapsed start", () => {
    expect(
      agentRowStatus(runningView([]), undefined, background(false, []), {
        pending: null,
        workingAgents: 0,
      }),
    ).toEqual({ kind: "working", startedAtEpochMs: 1_000 });
  });

  it("keeps the timer while the lead works with agents", () => {
    expect(
      agentRowStatus(runningView(["running", "running"]), undefined, background(false, []), {
        pending: null,
        workingAgents: 2,
      }),
    ).toEqual({ kind: "agents", count: 2, lead: "working", startedAtEpochMs: 1_000 });
  });

  it("stays running while only background agents remain after the lead settled", () => {
    const view = runningView([]);
    const settled = background(true, [agentTask("a"), agentTask("b"), agentTask("c")]);
    expect(agentRowStatus(view, undefined, settled, { pending: null, workingAgents: 1 })).toEqual({
      kind: "agents",
      count: 3,
      lead: "waiting",
      startedAtEpochMs: 1_000,
    });
  });

  it("settles once the turn finished or was interrupted by a reload", () => {
    const settled = background(true, [agentTask("a")]);
    expect(
      agentRowStatus(settledView(), undefined, settled, { pending: null, workingAgents: 3 }),
    ).toEqual({ kind: "done" });
    const interrupted = {
      ...settledView(),
      unread: false,
      thread: {
        ...settledView().thread,
        turns: [{ ...settledView().thread.turns[0], status: { kind: "interrupted" } }],
      },
    } as unknown as AgentThreadView;
    expect(
      agentRowStatus(interrupted, undefined, settled, { pending: null, workingAgents: 3 }),
    ).toEqual({ kind: "stopped" });
  });
});

const RESUMED_AT = 1_790_718_781_369;

function idleSession(tasks: AgentSessionBackground["tasks"], exitCode = 0): AgentThreadView {
  const settled = surfaceThreadView();
  const turn: AgentTurn = {
    turnId: "agt-mun7q6rd-9777",
    prompt: "Claude continued after background work finished",
    status: { kind: "exited", exitCode },
    startedAtEpochMs: RESUMED_AT,
    endedAtEpochMs: RESUMED_AT,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
  return {
    ...surfaceThreadView({ thread: { ...settled.thread, turns: [turn] } }),
    unread: true,
    sessionBackground: {
      ownerId: settled.thread.owner.ownerId,
      total: tasks.length,
      agents: tasks.filter((task) => task.taskType === "agent").length,
      tasks,
      sinceEpochMs: RESUMED_AT,
      taskSinceEpochMs: new Map(),
    },
  };
}

const resumedAgent = {
  taskId: "a4b355dcf6056a875",
  taskType: "agent",
  description: "Live Codex model catalog like Claude",
} as const;

describe("row status for live session background work", () => {
  it("keeps a thread running with its agent count while a resumed agent works after the turn", () => {
    const status = agentRowStatus(idleSession([resumedAgent]));
    expect(status).toEqual({
      kind: "agents",
      count: 1,
      lead: "waiting",
      startedAtEpochMs: RESUMED_AT,
    });
    expect(agentRowStatusLabel(status)).toBe("1 agent running");
    expect(agentRowIsLive(status)).toBe(true);
    expect(agentRowStatus(idleSession([resumedAgent], 1))).toMatchObject({ kind: "agents" });
  });

  it("shows other live session tasks as background work or monitoring", () => {
    const shell = { taskId: "bdxqm7bz6", taskType: "shell" } as const;
    const monitor = { taskId: "mon-1", taskType: "monitor" } as const;
    expect(agentRowStatus(idleSession([shell]))).toEqual({
      kind: "working",
      startedAtEpochMs: RESUMED_AT,
      activity: "background",
    });
    expect(agentRowStatus(idleSession([monitor]))).toEqual({
      kind: "working",
      startedAtEpochMs: RESUMED_AT,
      activity: "monitoring",
    });
  });

  it("counts inherited session agents while a new turn runs", () => {
    const view = {
      ...runningView([]),
      sessionBackground: idleSession([resumedAgent]).sessionBackground,
    };
    expect(
      agentRowStatus(view, undefined, background(false, []), { pending: null, workingAgents: 0 }),
    ).toEqual({ kind: "agents", count: 1, lead: "working", startedAtEpochMs: 1_000 });
  });
});

describe("row status", () => {
  it("puts approval and input before agents and working", () => {
    const view = runningView(["running", "running"]);
    expect(
      agentRowStatus(view, undefined, null, { pending: "approval", workingAgents: 2 }),
    ).toEqual({ kind: "approval" });
    expect(agentRowStatus(view, undefined, null, { pending: "input", workingAgents: 2 })).toEqual({
      kind: "input",
    });
    expect(agentRowStatus(view, undefined, null, { pending: null, workingAgents: 2 })).toEqual({
      kind: "agents",
      count: 2,
      lead: "working",
      startedAtEpochMs: 1_000,
    });
    expect(
      agentRowStatus(view, undefined, null, { pending: null, workingAgents: 0 }),
    ).toMatchObject({ kind: "working", startedAtEpochMs: 1_000 });
  });

  it("ignores stale signals once the thread is no longer running", () => {
    expect(
      agentRowStatus(settledView(), undefined, null, { pending: "approval", workingAgents: 3 }),
    ).toEqual({ kind: "done" });
  });

  it("counts only running top-level subagents of the running turn", () => {
    expect(
      agentRowWorkingAgents(runningView(["running", "completed", "running"], ["running"])),
    ).toBe(2);
    expect(agentRowWorkingAgents(settledView())).toBe(0);
  });

  it("labels, titles and tones", () => {
    expect(agentRowStatusLabel(agentsStatus(1, "working"))).toBe("1 agent running");
    expect(agentRowStatusLabel(agentsStatus(3, "waiting"))).toBe("3 agents running");
    expect(agentRowStatusTitle(agentsStatus(3, "waiting"))).toBe("Waiting for 3 agents");
    expect(agentRowStatusTitle(agentsStatus(1, "working"))).toBe("Working with 1 agent");
    expect(agentRowStatusTitle({ kind: "approval" })).toBe("Waiting for your approval");
    expect(agentRowStatusTitle({ kind: "input" })).toBe("Waiting for your answer");
    expect(agentRowStatusTitle({ kind: "done" })).toBeNull();
    expect(agentRowStatusLabel({ kind: "approval" })).toBe("Approval");
    expect(agentRowStatusLabel({ kind: "input" })).toBe("Input");
    expect(agentRowStatusTone({ kind: "input" })).toBe("warn");
    expect(agentRowStatusTone({ kind: "approval" })).toBe("warn");
    expect(agentRowStatusTone(agentsStatus(2, "waiting"))).toBe("work");
    expect(agentRowStatusTone({ kind: "done" })).toBe("ok");
    expect(agentRowStatusTone({ kind: "failed" })).toBe("fail");
    expect(agentRowStatusTone({ kind: "stopped" })).toBe("quiet");
    expect(agentRowStatusTone({ kind: "working", startedAtEpochMs: 0 })).toBe("work");
  });

  it("formats elapsed time as m:ss and h:mm:ss", () => {
    expect(agentRowElapsedLabel(0, 5_000)).toBe("0:05");
    expect(agentRowElapsedLabel(0, 161_000)).toBe("2:41");
    expect(agentRowElapsedLabel(0, 3_725_000)).toBe("1:02:05");
    expect(agentRowElapsedLabel(10_000, 0)).toBe("0:00");
  });
});
