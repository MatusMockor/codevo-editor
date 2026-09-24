import { describe, expect, it } from "vitest";
import { prependedTurnIds, turnCursor } from "./agentSessionDom";

describe("prependedTurnIds", () => {
  it("reports only turns whose first event moved earlier", () => {
    expect(
      prependedTurnIds(
        [
          { turnId: "a", offset: 0 },
          { turnId: "b", offset: -10 },
        ],
        [
          { turnId: "a", offset: -200 },
          { turnId: "b", offset: -10 },
          { turnId: "c", offset: -5 },
        ],
      ),
    ).toEqual(["a"]);
    expect(prependedTurnIds([], [{ turnId: "a", offset: -1 }])).toEqual([]);
  });
});

describe("turnCursor", () => {
  it("counts earlier hits on the same event", () => {
    const hit = { scope: "turn", turnId: "t", eventIndex: 3 } as const;
    expect(turnCursor([hit, hit, hit] as never, 2)).toEqual({
      kind: "event",
      eventIndex: 3,
      occurrence: 2,
    });
    expect(turnCursor([] as never, 0)).toBeNull();
  });
});
