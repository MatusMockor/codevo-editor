import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "../../domain/agentThread";
import { appServerGroups } from "./agentAppServerGroups";
import { agentTurnProjection } from "./agentTurnProjection";

describe("app-server child threads", () => {
  it("never renders Codex child thread events as transcript items", () => {
    const events: AgentTurnEvent[] = [
      { kind: "assistantText", text: "Parent response" },
      {
        kind: "subagentActivity",
        activity: "started",
        agentThreadId: "child",
        agentPath: "/root/explorer",
      },
      {
        kind: "subagentEvent",
        agentThreadId: "child",
        event: { kind: "toolCall", toolId: "c1", name: "shell", inputSummary: "rg createOrder" },
      },
      { kind: "subagentTurnDone", agentThreadId: "child", durationMs: 1200, isError: false },
    ];
    const projected = agentTurnProjection(events);
    expect(projected.items.map((item) => item.kind)).toEqual(["assistantText"]);
    expect(projected.hiddenCount).toBe(0);
  });

  it("keeps grouping child events for the subagent batch row", () => {
    const events: AgentTurnEvent[] = Array.from({ length: 40 }, (_, index) => ({
      kind: "subagentEvent",
      agentThreadId: `child-${index}`,
      event: { kind: "assistantText", text: `response ${index}` },
    }));
    const groups = appServerGroups(events);
    expect(groups.size).toBeGreaterThan(0);
    expect([...groups.values()][0]?.agentThreadId).toBe("child-0");
  });
});
