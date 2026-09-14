import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "../../domain/agentThread";
import { agentTurnProjection } from "./agentModePresentation";

describe("app-server subagent presentation bounds", () => {
  it("keeps parent output visible independently of child traffic and counts hidden child events", () => {
    const events: AgentTurnEvent[] = [{ kind: "assistantText", text: "Parent response" }];
    for (let i = 0; i < 300; i += 1)
      events.push({
        kind: "subagentEvent",
        agentThreadId: "child",
        event: { kind: "reasoning", text: String(i) },
      });
    const projected = agentTurnProjection(events);
    expect(projected.hiddenCount).toBe(0);
    expect(projected.items).toHaveLength(2);
    expect(projected.items[0]?.kind).toBe("assistantText");
    const group = projected.items[1];
    expect(group?.kind).toBe("subagentGroup");
    if (group?.kind !== "subagentGroup") throw new Error("missing group");
    expect(group.group.events).toHaveLength(256);
    expect(group.group.hiddenCount).toBe(44);
    expect(group.group.hiddenCount + agentTurnProjection(group.group.events).hiddenCount).toBe(100);
  });
});
