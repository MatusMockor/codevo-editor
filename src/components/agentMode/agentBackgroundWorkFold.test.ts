import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "../../domain/agentThread";
import { agentBackgroundSettledWorkFold } from "./agentBackgroundWorkFold";
import { agentTurnProjection } from "./agentTurnProjection";

const events: AgentTurnEvent[] = [
  {
    kind: "toolCall",
    toolId: "spawn",
    name: "Agent",
    inputSummary: "Review the gateway",
    description: "Gateway review",
  },
  { kind: "subagent", status: "starting", toolId: "spawn", taskId: "agent-task" },
  { kind: "backgroundTask", taskId: "agent-task", taskType: "agent", status: "starting" },
  { kind: "toolResult", toolId: "spawn", outputSummary: "Async agent launched", isError: false },
  { kind: "assistantText", text: "Review started; I will summarize when it finishes." },
  {
    kind: "toolCall",
    toolId: "child-read",
    name: "Read",
    inputSummary: "src/gateway.ts",
    parentToolId: "spawn",
  },
];

describe("background settled work fold", () => {
  it("keeps the lead answer outside and moves later child work into the fold", () => {
    const items = agentTurnProjection(events, null, null, "running").items;
    const fold = agentBackgroundSettledWorkFold(items);
    expect(fold?.visibleItems.map((item) => item.kind)).toEqual(["assistantText"]);
    expect(fold?.workItems.map((item) => (item.kind === "tool" ? item.toolId : item.kind))).toEqual(
      ["spawn", "child-read"],
    );
    expect(fold?.summary).not.toBe("");
  });
  it("keeps no fold when there is no work before the answer", () => {
    const items = agentTurnProjection(
      [{ kind: "assistantText", text: "Done" }],
      null,
      null,
      "running",
    ).items;
    expect(agentBackgroundSettledWorkFold(items)).toBeNull();
  });
});
