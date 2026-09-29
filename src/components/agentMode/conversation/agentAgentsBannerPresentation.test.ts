import { describe, expect, it } from "vitest";
import type {
  AgentRuntimeSubagent,
  AgentRuntimeSubagents,
} from "../../../domain/agentRuntimeSubagent";
import { agentAgentsBannerModel } from "./agentAgentsBannerPresentation";

function agent(id: string, patch: Partial<AgentRuntimeSubagent> = {}): AgentRuntimeSubagent {
  return {
    id,
    batchId: "batch",
    title: `Agent ${id}`,
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
    ...patch,
  };
}

function group(agents: ReadonlyArray<AgentRuntimeSubagent>): {
  readonly subagents: AgentRuntimeSubagents;
} {
  return { subagents: { agents, batches: [], truncated: false } };
}

describe("agentAgentsBannerModel", () => {
  it("counts working agents across turns and names them by role", () => {
    expect(
      agentAgentsBannerModel([
        group([agent("a", { role: "explorer" }), agent("b", { status: "completed" })]),
        group([agent("c", { role: "reviewer" })]),
      ]),
    ).toEqual({ count: 2, label: "2 agents running", names: "explorer, reviewer" });
  });

  it("falls back to titles, dedupes and bounds the names", () => {
    expect(
      agentAgentsBannerModel([
        group([agent("a"), agent("b"), agent("c"), agent("d"), agent("e", { title: "Agent a" })]),
      ]),
    ).toEqual({ count: 5, label: "5 agents running", names: "Agent a, Agent b, Agent c +1" });
  });

  it("hides the banner when nothing is working", () => {
    expect(agentAgentsBannerModel([group([agent("a", { status: "idle" })])])).toBeNull();
    expect(agentAgentsBannerModel([])).toBeNull();
  });

  it("uses the singular for one agent", () => {
    expect(agentAgentsBannerModel([group([agent("a", { role: "explorer" })])])?.label).toBe(
      "1 agent running",
    );
  });
});
