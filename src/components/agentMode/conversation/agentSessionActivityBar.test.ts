import { describe, expect, it } from "vitest";
import type { AgentSessionReply } from "../../../domain/agentSessionBackground";
import { NO_AGENT_RUNNING_WORK, type AgentRunningWork } from "../agents/agentRunningWork";
import { agentSessionActivityBar } from "./agentSessionActivityBar";

const REPLYING: AgentSessionReply = { kind: "inProgress", sinceEpochMs: 1_790_718_781_369 };
const NOT_REPLYING: AgentSessionReply = { kind: "none" };
const EXPECTED: AgentSessionReply = {
  kind: "expected",
  sinceEpochMs: 1_790_718_781_369,
  untilEpochMs: 1_790_718_786_369,
};

function running(overrides: Partial<AgentRunningWork>): AgentRunningWork {
  return { ...NO_AGENT_RUNNING_WORK, ...overrides };
}

describe("agentSessionActivityBar", () => {
  it("hides the bar when nothing runs", () => {
    expect(agentSessionActivityBar(NO_AGENT_RUNNING_WORK, false)).toBeNull();
    expect(agentSessionActivityBar(NO_AGENT_RUNNING_WORK, false, NOT_REPLYING)).toBeNull();
  });

  it("announces a follow-up reply with nothing to view or stop when no work is live", () => {
    expect(agentSessionActivityBar(NO_AGENT_RUNNING_WORK, false, REPLYING)).toEqual({
      label: "Claude is replying",
      viewLabel: "View background tasks",
      actions: [],
      announce: true,
    });
  });

  it("leads the running label with the reply while work is still live beside it", () => {
    expect(agentSessionActivityBar(running({ agents: 1 }), false, REPLYING)).toEqual({
      label: "Replying · 1 agent running",
      viewLabel: "View agents",
      actions: ["view"],
      announce: false,
    });
    expect(agentSessionActivityBar(running({ tasks: 2 }), true, REPLYING)).toEqual({
      label: "Replying · 2 background tasks running",
      viewLabel: "View background tasks",
      actions: ["view", "stop"],
      announce: true,
    });
    expect(agentSessionActivityBar(NO_AGENT_RUNNING_WORK, true, REPLYING)?.label).toBe(
      "Replying · Background tasks running",
    );
    expect(agentSessionActivityBar(running({ agents: 1 }), false, NOT_REPLYING)).toEqual(
      agentSessionActivityBar(running({ agents: 1 }), false),
    );
  });

  it("presents a reply expected after the last agent drained exactly like one being written", () => {
    expect(agentSessionActivityBar(NO_AGENT_RUNNING_WORK, false, EXPECTED)).toEqual(
      agentSessionActivityBar(NO_AGENT_RUNNING_WORK, false, REPLYING),
    );
    expect(agentSessionActivityBar(NO_AGENT_RUNNING_WORK, false, EXPECTED)?.label).toBe(
      "Claude is replying",
    );
    expect(agentSessionActivityBar(running({ tasks: 1 }), false, EXPECTED)).toEqual({
      label: "Replying · 1 background task running",
      viewLabel: "View background tasks",
      actions: ["view"],
      announce: false,
    });
  });

  it("shows only the count with View, never a names list", () => {
    expect(agentSessionActivityBar(running({ agents: 4 }), false)).toEqual({
      label: "4 agents running",
      viewLabel: "View agents",
      actions: ["view"],
      announce: false,
    });
  });

  it("adds the thread Stop and announces while a live turn waits on background work", () => {
    expect(agentSessionActivityBar(running({ agents: 1 }), true)).toEqual({
      label: "1 agent running",
      viewLabel: "View agents",
      actions: ["view", "stop"],
      announce: true,
    });
  });

  it("names every combination of agents and background tasks", () => {
    const label = (work: Partial<AgentRunningWork>) =>
      agentSessionActivityBar(running(work), false)?.label;
    expect(label({ agents: 3 })).toBe("3 agents running");
    expect(label({ agents: 2, tasks: 1 })).toBe("2 agents running · 1 background task");
    expect(label({ tasks: 1 })).toBe("1 background task running");
    expect(label({ tasks: 3 })).toBe("3 background tasks running");
    expect(label({ tasksUnknown: true })).toBe("Background tasks running");
    expect(label({ agents: 1, tasksUnknown: true })).toBe("1 agent running · background tasks");
    expect(label({ agents: 32, agentsLowerBound: true })).toBe("At least 32 agents running");
  });

  it("names the View target after what runs", () => {
    const view = (work: Partial<AgentRunningWork>) =>
      agentSessionActivityBar(running(work), false)?.viewLabel;
    expect(view({ tasks: 2 })).toBe("View background tasks");
    expect(view({ agents: 1, tasks: 2 })).toBe("View agents");
  });

  it("keeps a live wait visible even before any task is listed", () => {
    expect(agentSessionActivityBar(NO_AGENT_RUNNING_WORK, true)).toEqual({
      label: "Background tasks running",
      viewLabel: "View background tasks",
      actions: ["view", "stop"],
      announce: true,
    });
  });
});
