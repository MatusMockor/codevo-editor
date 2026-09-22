import { describe, expect, it } from "vitest";
import { agentContextWindow } from "./agentContextWindow";
import { parseAgentThread, serializeAgentThread } from "./agentThreadWire";
import type { AgentThread, AgentTurnEvent } from "./agentThread";

function thread(
  events: readonly AgentTurnEvent[],
  provider: "claudeCode" | "codex" = "claudeCode",
): AgentThread {
  return parseAgentThread({
    threadId: "agt-t1-0001",
    owner: { rootKey: "/repo", ownerId: "ws-1", repositoryRoot: "/repo" },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: provider, sessionId: null },
    title: "Context",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1,
    updatedAtEpochMs: 2,
    turnsTruncated: false,
    turns: [
      {
        turnId: "agt-1-0a1b",
        prompt: "test",
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs: 1,
        endedAtEpochMs: 2,
        events,
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
      },
    ],
  });
}
const input = (model: string, inputTokens: number): AgentTurnEvent => ({
  kind: "contextUsage",
  model,
  inputTokens,
  contextWindow: null,
});
const capacity = (model: string, contextWindow: number): AgentTurnEvent => ({
  kind: "contextUsage",
  model,
  inputTokens: null,
  contextWindow,
});

describe("agentContextWindow", () => {
  it("uses latest main request rather than summing requests or model capacities", () => {
    expect(
      agentContextWindow(
        thread([
          input("main", 100),
          input("main", 200),
          capacity("main", 1000),
          capacity("child", 500),
        ]),
      ),
    ).toEqual({ usedTokens: 200, contextWindow: 1000 });
  });
  it("never falls back to cumulative Claude result totals or a guessed model window", () => {
    expect(
      agentContextWindow(
        thread([
          {
            kind: "result",
            text: "",
            isError: false,
            usage: { inputTokens: 999, outputTokens: 1, contextTokens: 999 },
          },
        ]),
      ),
    ).toBeNull();
    expect(agentContextWindow(thread([input("main", 100), capacity("other", 1000)]))).toBeNull();
    expect(
      agentContextWindow(thread([input("old", 100), capacity("old", 1000), input("new", 200)])),
    ).toBeNull();
  });
  it.each<AgentTurnEvent>([
    { kind: "contextCompaction", beforeTokens: 100, afterTokens: 10 },
    { kind: "contextCompactionStatus", status: "compacting", message: null },
    { kind: "contextCompactionStatus", status: "failed", message: "error" },
    { kind: "result", text: "failed", isError: true, usage: null },
  ])("invalidates stale input on $kind", (event) => {
    expect(
      agentContextWindow(
        thread([input("main", 100), capacity("main", 1000), event, capacity("main", 1000)]),
      ),
    ).toBeNull();
  });
  it("recovers on fresh input after compaction and ignores idle", () => {
    expect(
      agentContextWindow(
        thread([
          capacity("main", 1000),
          input("main", 100),
          { kind: "contextCompaction", beforeTokens: 100, afterTokens: null },
          input("main", 20),
          capacity("main", 1000),
          { kind: "contextCompactionStatus", status: "idle", message: null },
        ]),
      ),
    ).toEqual({ usedTokens: 20, contextWindow: 1000 });
  });
  it("uses Codex last request total without counting cached input twice", () => {
    const last = {
      inputTokens: 100,
      cachedInputTokens: 80,
      cacheWriteInputTokens: 0,
      outputTokens: 10,
      reasoningOutputTokens: 5,
      totalTokens: 110,
    };
    expect(
      agentContextWindow(
        thread(
          [
            {
              kind: "result",
              text: "",
              isError: false,
              usage: {
                inputTokens: 900,
                outputTokens: 100,
                contextTokens: 1000,
                appServerUsage: {
                  last,
                  total: { ...last, totalTokens: 1000 },
                  contextWindow: 2000,
                },
              },
            },
          ],
          "codex",
        ),
      ),
    ).toEqual({ usedTokens: 110, contextWindow: 2000 });
  });
  it("roundtrips new event contracts and rejects unsafe wire metadata", () => {
    const original = thread([
      input("main", 100),
      capacity("main", 1000),
      { kind: "contextCompactionStatus", status: "failed", message: "failed" },
    ]);
    expect(parseAgentThread(serializeAgentThread(original))).toEqual(original);
    for (const event of [
      { ...capacity("main", 0) },
      { ...input("main", -1) },
      { ...input("a".repeat(257), 1) },
      { kind: "contextCompactionStatus", status: "unknown", message: null },
    ]) {
      expect(() => thread([event as AgentTurnEvent])).toThrow();
    }
    expect(agentContextWindow(null)).toBeNull();
  });
});

it("hides stale or truncated observations including pending compact and new launch", () => {
  const original = thread([input("main", 100), capacity("main", 1000)]);
  const last = original.turns[0]!;
  expect(
    agentContextWindow({ ...original, turns: [{ ...last, eventsTruncated: true }] }),
  ).toBeNull();
  expect(
    agentContextWindow({
      ...original,
      turns: [last, { ...last, prompt: "/compact", status: { kind: "running" }, events: [] }],
    }),
  ).toBeNull();
  expect(
    agentContextWindow({ ...original, turns: [last, { ...last, events: [input("main", 50)] }] }),
  ).toBeNull();
  expect(
    agentContextWindow({
      ...original,
      turns: [{ ...last, status: { kind: "failed", message: "failed" } }],
    }),
  ).toBeNull();
});

describe("agentContextWindow with an uncapped turn log", () => {
  const logged = { usedTokens: 4_242, contextWindow: 200_000 };

  it("reports the digest value for a window-truncated live turn", () => {
    const original = thread([input("main", 100), capacity("main", 1000)]);
    const last = original.turns[0]!;
    const truncated = {
      ...original,
      turns: [{ ...last, eventsTruncated: true, status: { kind: "running" } as const }],
    };
    expect(agentContextWindow(truncated)).toBeNull();
    expect(agentContextWindow(truncated, logged)).toEqual(logged);
  });

  it("still reports null for a failed, interrupted, stopped or non-zero exit turn", () => {
    const original = thread([input("main", 100), capacity("main", 1000)]);
    const last = original.turns[0]!;
    for (const status of [
      { kind: "failed", message: "boom" } as const,
      { kind: "interrupted" } as const,
      { kind: "stopped" } as const,
      { kind: "exited", exitCode: 2 } as const,
    ]) {
      expect(
        agentContextWindow(
          { ...original, turns: [{ ...last, eventsTruncated: true, status }] },
          logged,
        ),
      ).toBeNull();
      expect(agentContextWindow({ ...original, turns: [{ ...last, status }] }, logged)).toBeNull();
    }
  });

  it("keeps the in-turn fold when the turn was never truncated", () => {
    expect(
      agentContextWindow(thread([input("main", 100), capacity("main", 1000)]), logged),
    ).toEqual({ usedTokens: 100, contextWindow: 1000 });
  });
});

it("keeps occupancy observation time across later capacity metadata and serialization", () => {
  const measured = { ...input("main", 100), observedAtEpochMs: 1234 };
  const value = thread([measured, { ...capacity("main", 1000), observedAtEpochMs: 9999 }]);
  expect(agentContextWindow(parseAgentThread(serializeAgentThread(value)))).toEqual({
    usedTokens: 100,
    contextWindow: 1000,
    observedAtEpochMs: 1234,
  });
  expect(
    agentContextWindow(thread([measured, input("main", 200), capacity("main", 1000)])),
  ).toEqual({ usedTokens: 200, contextWindow: 1000 });
});
