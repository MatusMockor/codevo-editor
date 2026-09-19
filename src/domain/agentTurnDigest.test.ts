import { describe, expect, it } from "vitest";
import { agentTurnStream, batchedAgentTurnStream } from "../test/agentTurnEventStreams";
import { agentContextWindow } from "./agentContextWindow";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  agentTurnEventUtf8Bytes,
  coalesceAgentTextEvents,
  mergeTurnEvents,
  type AgentThread,
  type AgentTurnEvent,
} from "./agentThread";
import type { AgentCliKind } from "./agentTask";
import {
  MAX_AGENT_TURN_DIGEST_CAPACITIES,
  agentTurnDigestContextWindow,
  emptyAgentTurnDigest,
  foldAgentTurnDigest,
  type AgentTurnDigestWire,
} from "./agentTurnDigest";
import { retainAgentTurnEvents } from "./agentTurnEventRetention";
import { AGENT_TURN_LOG_LIMITS } from "./agentTurnLog";
import { parseAgentTurnDigest } from "./agentTurnLogWire";

const UTF8_ENCODER = new TextEncoder();

const UNCAPPED = {
  maxEvents: Number.MAX_SAFE_INTEGER,
  maxBytes: Number.MAX_SAFE_INTEGER,
  maxSubagentThreads: Number.MAX_SAFE_INTEGER,
  eventBytes: agentTurnEventUtf8Bytes,
  coalesceText: coalesceAgentTextEvents,
};

function threadWith(
  events: ReadonlyArray<AgentTurnEvent>,
  provider: AgentCliKind,
  eventsTruncated = false,
): AgentThread {
  return {
    provider: { kind: provider, sessionId: null },
    turns: [{ events, eventsTruncated, status: { kind: "running" } }],
  } as unknown as AgentThread;
}

function foldBatches(
  batches: ReadonlyArray<ReadonlyArray<AgentTurnEvent>>,
  provider: AgentCliKind,
): AgentTurnDigestWire {
  let digest = emptyAgentTurnDigest(provider);
  for (const batch of batches) digest = foldAgentTurnDigest(digest, batch);
  return digest;
}

function codexResult(totalTokens: number, contextWindow: number): AgentTurnEvent {
  return {
    kind: "result",
    text: "done",
    isError: false,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      contextTokens: null,
      appServerUsage: {
        last: {
          inputTokens: totalTokens,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens,
        },
        total: {
          inputTokens: totalTokens,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens,
        },
        contextWindow,
      },
    },
  };
}

describe("agent turn digest", () => {
  it.each<AgentCliKind>(["claudeCode", "codex"])(
    "derives the same context window as the uncapped fold for %s streams",
    { timeout: 60_000 },
    (provider) => {
      const divergences: string[] = [];
      for (let seed = 1; seed <= 60; seed += 1) {
        const length = 200 + ((seed * 29) % 900);
        const raw = agentTurnStream(seed, length);
        const uncapped = retainAgentTurnEvents([], raw, UNCAPPED).events;
        const expected = agentContextWindow(threadWith(uncapped, provider));
        for (const batchSize of [1, 9, 0]) {
          const digest = foldBatches(batchedAgentTurnStream(seed, length, batchSize), provider);
          if (JSON.stringify(agentTurnDigestContextWindow(digest)) !== JSON.stringify(expected))
            divergences.push(`${provider} seed ${seed} batch ${batchSize}`);
        }
      }
      expect(divergences).toEqual([]);
    },
  );

  it("keeps reporting context after the in-memory window truncates the turn", () => {
    const raw = agentTurnStream(4, MAX_AGENT_EVENTS_PER_TURN * 12);
    const uncapped = retainAgentTurnEvents([], raw, UNCAPPED).events;
    const merged = mergeTurnEvents([], raw);
    expect(merged.truncated).toBe(true);
    expect(agentContextWindow(threadWith(merged.events, "claudeCode", true))).toBeNull();

    const digest = foldAgentTurnDigest(emptyAgentTurnDigest("claudeCode"), raw);
    expect(agentTurnDigestContextWindow(digest)).toEqual(
      agentContextWindow(threadWith(uncapped, "claudeCode")),
    );
  });

  it("folds codex app server usage", () => {
    const events: AgentTurnEvent[] = [codexResult(48_000, 272_000)];
    const digest = foldAgentTurnDigest(emptyAgentTurnDigest("codex"), events);
    expect(agentTurnDigestContextWindow(digest)).toEqual({
      usedTokens: 48_000,
      contextWindow: 272_000,
    });
    expect(agentContextWindow(threadWith(events, "codex"))).toEqual(
      agentTurnDigestContextWindow(digest),
    );
  });

  it("resumes from a previously folded digest", () => {
    const head: AgentTurnEvent[] = [
      { kind: "contextUsage", model: "m", inputTokens: null, contextWindow: 1_000 },
    ];
    const tail: AgentTurnEvent[] = [
      { kind: "contextUsage", model: "m", inputTokens: 400, contextWindow: null },
    ];
    const resumed = foldAgentTurnDigest(
      foldAgentTurnDigest(emptyAgentTurnDigest("claudeCode"), head),
      tail,
    );
    const once = foldAgentTurnDigest(emptyAgentTurnDigest("claudeCode"), [...head, ...tail]);
    expect(resumed).toEqual(once);
    expect(agentTurnDigestContextWindow(resumed)).toEqual({
      usedTokens: 400,
      contextWindow: 1_000,
    });
  });

  it("clears the fold on an invalidating event", () => {
    const digest = foldAgentTurnDigest(emptyAgentTurnDigest("claudeCode"), [
      { kind: "contextUsage", model: "m", inputTokens: null, contextWindow: 1_000 },
      { kind: "contextUsage", model: "m", inputTokens: 400, contextWindow: null },
      { kind: "contextCompaction", beforeTokens: 400, afterTokens: 10 },
    ]);
    expect(digest.context.current).toBeNull();
    expect(digest.context.primary).toBeNull();
    expect(digest.context.capacities).toEqual([]);
  });

  it("returns the same digest for an empty batch", () => {
    const digest = emptyAgentTurnDigest("claudeCode");
    expect(foldAgentTurnDigest(digest, [])).toBe(digest);
  });

  it("bounds retained model capacities and stays inside the digest byte budget", () => {
    const events: AgentTurnEvent[] = Array.from({ length: 40 }, (_, index) => ({
      kind: "contextUsage",
      model: `model-${index}`,
      inputTokens: null,
      contextWindow: 1_000 + index,
    }));
    const digest = foldAgentTurnDigest(emptyAgentTurnDigest("claudeCode"), events);
    expect(digest.context.capacities).toHaveLength(MAX_AGENT_TURN_DIGEST_CAPACITIES);
    expect(digest.context.bounded).toBe(true);
    expect(UTF8_ENCODER.encode(JSON.stringify(digest)).byteLength).toBeLessThanOrEqual(
      AGENT_TURN_LOG_LIMITS.digestBytes,
    );
    expect(parseAgentTurnDigest(digest)).toEqual(digest);
  });

  it("drops a model name above the digest bound and says so", () => {
    const digest = foldAgentTurnDigest(emptyAgentTurnDigest("claudeCode"), [
      { kind: "contextUsage", model: "m".repeat(400), inputTokens: null, contextWindow: 1_000 },
      { kind: "contextUsage", model: "m".repeat(400), inputTokens: 5, contextWindow: null },
    ]);
    expect(digest.context.capacities).toEqual([]);
    expect(digest.context.primary).toBeNull();
    expect(digest.context.bounded).toBe(true);
    expect(digest.context.current).toEqual({ usedTokens: 5, contextWindow: 1_000 });
    expect(parseAgentTurnDigest(digest)).toEqual(digest);
  });
});
