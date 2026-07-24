import { describe, expect, it } from "vitest";
import {
  captureDebugCopyValueCandidate,
  debugCopyValueCandidatesEqual,
  debugCopyValueExpression,
  type DebugCopyValueCandidate,
} from "./debugCopyValue";

const candidate: DebugCopyValueCandidate = {
  source: "variables",
  identity: "variable:scope-1:user",
  rootKey: "/workspace",
  workspaceOwnerKey: "owner-a",
  sessionId: 7,
  pauseGeneration: 3,
  frameId: 11,
  generation: 5,
  epoch: 9,
  evaluateName: 'root["user"]',
  displayedValue: "User {…}",
};

describe("debug copy value contract", () => {
  it("captures a detached frozen candidate and preserves the exact expression", () => {
    const source = { ...candidate };
    const captured = captureDebugCopyValueCandidate({
      readDebugCopyValueCandidate: () => source,
    });
    expect(captured).toEqual(candidate);
    expect(Object.isFrozen(captured)).toBe(true);
    source.displayedValue = "mutated";
    expect(captured?.displayedValue).toBe("User {…}");
    expect(debugCopyValueExpression(captured!)).toBe('root["user"]');
    expect(
      debugCopyValueExpression({
        ...candidate,
        evaluateName: undefined,
        displayedValue: "  raw  ",
      }),
    ).toBe("  raw  ");
  });

  it("captures and compares the separately proven adapter evaluate path", () => {
    const withAdapterPath = {
      ...candidate,
      adapterEvaluateName: 'root["user"]',
    };
    const captured = captureDebugCopyValueCandidate({
      readDebugCopyValueCandidate: () => withAdapterPath,
    });
    expect(captured).toEqual(withAdapterPath);
    expect(
      debugCopyValueCandidatesEqual(withAdapterPath, {
        ...withAdapterPath,
        adapterEvaluateName: "root.user",
      }),
    ).toBe(false);
  });

  it("reads every own candidate scalar exactly once before validating the snapshot", () => {
    const source = {} as Record<string, unknown>;
    const reads = new Map<string, number>();
    for (const [key, first] of Object.entries(candidate)) {
      Object.defineProperty(source, key, {
        configurable: true,
        enumerable: true,
        get: () => {
          const count = (reads.get(key) ?? 0) + 1;
          reads.set(key, count);
          return count === 1 ? first : null;
        },
      });
    }

    const captured = captureDebugCopyValueCandidate({
      readDebugCopyValueCandidate: () => source,
    });

    expect(captured).toEqual(candidate);
    expect([...reads.values()]).toEqual(Object.keys(candidate).map(() => 1));
  });

  it("rejects symbol, non-enumerable, and inherited optional fields as non-exact", () => {
    const symbolExtra = { ...candidate, [Symbol("extra")]: true };
    const hiddenExtra = { ...candidate };
    Object.defineProperty(hiddenExtra, "hidden", { value: true });
    let inheritedReads = 0;
    const inherited = Object.assign(
      Object.create({
        get evaluateName() {
          inheritedReads += 1;
          return "mutate()";
        },
      }),
      Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "evaluateName")),
    );

    for (const value of [symbolExtra, hiddenExtra, inherited]) {
      expect(
        captureDebugCopyValueCandidate({ readDebugCopyValueCandidate: () => value }),
      ).toBeNull();
    }
    expect(inheritedReads).toBe(0);
  });

  it("compares every owner, focus, generation, epoch, expression, and value field", () => {
    expect(debugCopyValueCandidatesEqual(candidate, { ...candidate })).toBe(true);
    const variants: DebugCopyValueCandidate[] = [
      { ...candidate, source: "watch" },
      { ...candidate, identity: "watch:user" },
      { ...candidate, rootKey: "/other" },
      { ...candidate, workspaceOwnerKey: "owner-b" },
      { ...candidate, sessionId: 8 },
      { ...candidate, pauseGeneration: 4 },
      { ...candidate, frameId: 12 },
      { ...candidate, generation: 6 },
      { ...candidate, epoch: 10 },
      { ...candidate, evaluateName: "user" },
      { ...candidate, adapterEvaluateName: "user" },
      { ...candidate, displayedValue: "changed" },
    ];
    for (const variant of variants) {
      expect(debugCopyValueCandidatesEqual(candidate, variant)).toBe(false);
    }
  });

  it("fails closed for malformed, oversized, extra-key, and throwing captures", () => {
    const malformed: unknown[] = [
      null,
      { ...candidate, extra: true },
      { ...candidate, source: "repl" },
      { ...candidate, identity: "" },
      { ...candidate, rootKey: "bad\nroot" },
      { ...candidate, workspaceOwnerKey: "" },
      { ...candidate, sessionId: 0 },
      { ...candidate, pauseGeneration: 0 },
      { ...candidate, frameId: 0 },
      { ...candidate, generation: 0 },
      { ...candidate, epoch: 0 },
      { ...candidate, evaluateName: null },
      { ...candidate, evaluateName: "   " },
      { ...candidate, evaluateName: "bad\npath" },
      { ...candidate, evaluateName: "x".repeat(4_097) },
      { ...candidate, adapterEvaluateName: null },
      { ...candidate, adapterEvaluateName: "   " },
      { ...candidate, adapterEvaluateName: "bad\npath" },
      { ...candidate, adapterEvaluateName: "x".repeat(4_097) },
      { ...candidate, displayedValue: "x".repeat(65_537) },
    ];
    for (const value of malformed) {
      expect(
        captureDebugCopyValueCandidate({ readDebugCopyValueCandidate: () => value }),
      ).toBeNull();
    }
    expect(
      captureDebugCopyValueCandidate({
        readDebugCopyValueCandidate: () => {
          throw new Error("hostile focus reader");
        },
      }),
    ).toBeNull();
    expect(
      captureDebugCopyValueCandidate({
        readDebugCopyValueCandidate: () =>
          new Proxy(candidate, {
            get() {
              throw new Error("hostile candidate getter");
            },
          }),
      }),
    ).toBeNull();
    expect(
      captureDebugCopyValueCandidate({
        readDebugCopyValueCandidate: () =>
          new Proxy(candidate, {
            ownKeys() {
              throw new Error("hostile ownKeys trap");
            },
          }),
      }),
    ).toBeNull();
    const withoutEvaluateName = Object.fromEntries(
      Object.entries(candidate).filter(([key]) => key !== "evaluateName"),
    );
    expect(
      captureDebugCopyValueCandidate({
        readDebugCopyValueCandidate: () =>
          new Proxy(withoutEvaluateName, {
            has() {
              throw new Error("hostile has trap");
            },
          }),
      }),
    ).toBeNull();
  });
});
