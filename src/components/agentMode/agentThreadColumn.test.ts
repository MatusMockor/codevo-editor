import { describe, expect, it } from "vitest";
import { agentThreadColumnKey } from "./agentThreadColumn";

describe("agentThreadColumnKey", () => {
  it("keys each half of the column in its own namespace", () => {
    expect(agentThreadColumnKey({ scope: "imported", exchangeIndex: 0 })).toBe("imported:0");
    expect(agentThreadColumnKey({ scope: "imported", exchangeIndex: 41 })).toBe("imported:41");
    expect(agentThreadColumnKey({ scope: "turn", turnId: "agt-1-t3" })).toBe("turn:agt-1-t3");
  });

  it("cannot collide an imported entry with a live turn that spells the same id", () => {
    expect(agentThreadColumnKey({ scope: "turn", turnId: "imported:7" })).not.toBe(
      agentThreadColumnKey({ scope: "imported", exchangeIndex: 7 }),
    );
    expect(agentThreadColumnKey({ scope: "turn", turnId: "turn:x" })).toBe("turn:turn:x");
  });
});
