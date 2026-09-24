import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentTurn } from "../../domain/agentThread";
import {
  agentRowElapsedLabel,
  agentRowStatus,
  agentRowStatusLabel,
  agentRowStatusTitle,
  agentRowStatusTone,
  agentRowWorkingAgents,
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
    expect(agentRowStatusLabel({ kind: "agents", count: 1 })).toBe("1 agent");
    expect(agentRowStatusLabel({ kind: "agents", count: 3 })).toBe("3 agents");
    expect(agentRowStatusTitle({ kind: "agents", count: 3 })).toBe("Waiting for 3 agents");
    expect(agentRowStatusTitle({ kind: "approval" })).toBe("Waiting for your approval");
    expect(agentRowStatusTitle({ kind: "input" })).toBe("Waiting for your answer");
    expect(agentRowStatusTitle({ kind: "done" })).toBeNull();
    expect(agentRowStatusLabel({ kind: "approval" })).toBe("Approval");
    expect(agentRowStatusLabel({ kind: "input" })).toBe("Input");
    expect(agentRowStatusTone({ kind: "input" })).toBe("warn");
    expect(agentRowStatusTone({ kind: "approval" })).toBe("warn");
    expect(agentRowStatusTone({ kind: "agents", count: 2 })).toBe("work");
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
