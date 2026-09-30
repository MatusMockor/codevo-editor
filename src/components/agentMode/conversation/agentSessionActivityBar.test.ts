import { describe, expect, it } from "vitest";
import { NO_AGENT_RUNNING_WORK, type AgentRunningWork } from "../agents/agentRunningWork";
import { agentSessionActivityBar } from "./agentSessionActivityBar";

function running(overrides: Partial<AgentRunningWork>): AgentRunningWork {
  return { ...NO_AGENT_RUNNING_WORK, ...overrides };
}

describe("agentSessionActivityBar", () => {
  it("hides the bar when nothing runs", () => {
    expect(agentSessionActivityBar(NO_AGENT_RUNNING_WORK, false)).toBeNull();
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
