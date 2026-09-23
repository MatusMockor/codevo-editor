import { describe, expect, it } from "vitest";
import type { AgentBackgroundActivity } from "../../domain/agentBackgroundActivity";
import {
  EMPTY_AGENT_RUNTIME_SUBAGENTS,
  type AgentRuntimeSubagent,
  type AgentRuntimeSubagents,
} from "../../domain/agentRuntimeSubagent";
import {
  agentBackgroundWait,
  agentBackgroundWaitStatus,
  agentBackgroundWaitTitle,
} from "./agentBackgroundIndicatorPresentation";

const activity = (
  tasks: AgentBackgroundActivity["tasks"],
  truncated = false,
): AgentBackgroundActivity => ({ phase: "working", foregroundSettled: true, tasks, truncated });
const agentTask = (taskId: string) => ({ taskId, taskType: "agent" as const });
const shellTask = (taskId: string) => ({ taskId, taskType: "shell" as const });
const working = (id: string): AgentRuntimeSubagent => ({
  id,
  batchId: "turn",
  title: id,
  titleKnown: true,
  role: null,
  model: null,
  status: "working",
  activity: null,
  activityTruncated: false,
  recentActivity: [],
  elapsed: { kind: "unknown" },
  totalTokens: null,
  toolUses: null,
  nestedAgents: 0,
  activityOrder: 0,
});
const subagents = (...agents: AgentRuntimeSubagent[]): AgentRuntimeSubagents => ({
  agents,
  batches: [],
  truncated: false,
});

describe("background wait presentation", () => {
  it("counts agents from native tasks or live subagents without double counting", () => {
    const wait = agentBackgroundWait(
      activity([agentTask("a"), agentTask("b"), shellTask("s")]),
      subagents(working("a")),
    );
    expect(wait).toEqual({ kind: "agents", count: 2 });
    expect(agentBackgroundWaitTitle(wait)).toBe("Waiting for 2 agents");
    expect(agentBackgroundWaitStatus(wait)).toBe("2 agents working");
    const single = agentBackgroundWait(activity([]), subagents(working("a")));
    expect(agentBackgroundWaitTitle(single)).toBe("Waiting for 1 agent");
    expect(agentBackgroundWaitStatus(single)).toBe("1 agent working");
  });
  it("pluralizes background tasks and stays truthful when the count is unknown", () => {
    const one = agentBackgroundWait(activity([shellTask("s")]), EMPTY_AGENT_RUNTIME_SUBAGENTS);
    expect(agentBackgroundWaitTitle(one)).toBe("Waiting for 1 background task");
    expect(agentBackgroundWaitStatus(one)).toBe("1 background task running");
    const two = agentBackgroundWait(
      activity([shellTask("s"), { taskId: "m", taskType: "monitor" }]),
      EMPTY_AGENT_RUNTIME_SUBAGENTS,
    );
    expect(agentBackgroundWaitTitle(two)).toBe("Waiting for 2 background tasks");
    const unknown = agentBackgroundWait(
      activity([shellTask("s")], true),
      EMPTY_AGENT_RUNTIME_SUBAGENTS,
    );
    expect(agentBackgroundWaitTitle(unknown)).toBe("Waiting for background tasks");
    expect(agentBackgroundWaitStatus(unknown)).toBe("Background tasks running");
  });
});
