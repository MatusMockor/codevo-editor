import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "../../domain/agentThread";
import { agentTurnProjection } from "./agentModePresentation";

describe("app-server subagent presentation bounds", () => {
  it("reserves a bounded group slot for a search target after the normal group limit", () => {
    const events: AgentTurnEvent[] = Array.from({ length: 40 }, (_, index) => ({
      kind: "subagentEvent",
      agentThreadId: `child-${index}`,
      event: { kind: "assistantText", text: `response ${index}` },
    }));
    const projected = agentTurnProjection(events, 39);
    const groups = projected.items.filter((item) => item.kind === "subagentGroup");
    expect(groups).toHaveLength(32);
    expect(groups[groups.length - 1]?.group.agentThreadId).toBe("child-39");
    expect(groups[groups.length - 1]?.group.sourceOffsets).toEqual([39]);
  });

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
