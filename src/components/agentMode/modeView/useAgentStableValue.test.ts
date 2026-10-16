import { describe, expect, it } from "vitest";
import { agentStructurallyEqual } from "./useAgentStableValue";

describe("agentStructurallyEqual", () => {
  const handler = () => undefined;

  it("treats rebuilt plain objects and arrays with identical leaves as equal", () => {
    expect(
      agentStructurallyEqual(
        { label: "app", options: [{ root: "/app" }], onPick: handler },
        { label: "app", options: [{ root: "/app" }], onPick: handler },
        4,
      ),
    ).toBe(true);
  });

  it("detects a changed leaf, a new callback and extra keys", () => {
    expect(agentStructurallyEqual({ label: "app" }, { label: "api" }, 2)).toBe(false);
    expect(agentStructurallyEqual({ onPick: handler }, { onPick: () => undefined }, 2)).toBe(false);
    expect(agentStructurallyEqual({ label: "app" }, { label: "app", extra: 1 }, 2)).toBe(false);
  });

  it("compares nested values by identity once the depth is exhausted", () => {
    expect(
      agentStructurallyEqual({ nested: { root: "/app" } }, { nested: { root: "/app" } }, 1),
    ).toBe(false);
  });

  it("compares class instances and maps by identity", () => {
    expect(agentStructurallyEqual(new Map([["a", 1]]), new Map([["a", 1]]), 4)).toBe(false);
  });
});
