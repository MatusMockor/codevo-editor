import { describe, expect, it } from "vitest";
import { projectAgentBackgroundActivity } from "../../domain/agentBackgroundActivity";
import { agentContextWindow } from "../../domain/agentContextWindow";
import { parseClaudeStreamJsonLine } from "../../domain/agentOutput/claudeStreamJson";
import { retainAgentSubagentLifecycle } from "../../domain/agentSubagentLifecycle";
import {
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  MAX_AGENT_EVENTS_PER_TURN,
  MAX_SUBAGENT_THREADS_PER_TURN,
  agentTurnEventUtf8Bytes,
  coalesceAgentTextEvents,
  mergeTurnEvents,
  type AgentThread,
  type AgentTurnEvent,
} from "../../domain/agentThread";
import type { AgentTurnEventRetentionPolicy } from "../../domain/agentTurnEventRetention";
import {
  canonicalJson,
  hostileAgentTurnStream,
  legacyMergeTurnEvents,
  longRunningAgentTurnStream,
  realisticAgentTurnStream,
} from "../../test/agentTurnEventStreams";
import { appServerGroups } from "./agentAppServerGroups";
import { agentTurnSubagentSummary } from "./agentModePresentation";
import { agentSubagentDisclosureEntries } from "./agentSubagentDisclosurePresentation";

const TURN_POLICY: AgentTurnEventRetentionPolicy = {
  maxEvents: MAX_AGENT_EVENTS_PER_TURN,
  maxBytes: MAX_AGENT_EVENT_BYTES_PER_TURN,
  maxSubagentThreads: MAX_SUBAGENT_THREADS_PER_TURN,
  eventBytes: agentTurnEventUtf8Bytes,
  coalesceText: coalesceAgentTextEvents,
};

type ConsumerName =
  "background" | "lifecycle" | "summary" | "context" | "groups" | "disclosure" | "retained";

function threadWith(events: ReadonlyArray<AgentTurnEvent>): AgentThread {
  return {
    provider: { kind: "claudeCode", sessionId: null },
    turns: [{ events, eventsTruncated: false, status: { kind: "running" } }],
  } as unknown as AgentThread;
}

function consumers(events: ReadonlyArray<AgentTurnEvent>): Record<ConsumerName, string> {
  const lifecycle = retainAgentSubagentLifecycle(undefined, events);
  return {
    background: canonicalJson(projectAgentBackgroundActivity(events, true, false)),
    lifecycle: canonicalJson(lifecycle),
    summary: canonicalJson(agentTurnSubagentSummary(events)),
    context: canonicalJson(agentContextWindow(threadWith(events))),
    groups: canonicalJson(
      [...appServerGroups(events).values()].map((group) => ({ ...group, sourceOffsets: [] })),
    ),
    disclosure: canonicalJson(agentSubagentDisclosureEntries(events)),
    retained: canonicalJson(agentSubagentDisclosureEntries(events, lifecycle, "settled")),
  };
}

function mergeInBatches(
  raw: ReadonlyArray<AgentTurnEvent>,
  size: number,
): ReadonlyArray<AgentTurnEvent> {
  let events: ReadonlyArray<AgentTurnEvent> = [];
  for (let index = 0; index < raw.length; index += size) {
    const merged = mergeTurnEvents(events, raw.slice(index, index + size));
    expect(merged.truncated).toBe(false);
    events = merged.events;
  }
  return events;
}

function divergences(raw: ReadonlyArray<AgentTurnEvent>, batch: number): ReadonlyArray<string> {
  const expected = consumers(legacyMergeTurnEvents([], raw, TURN_POLICY).events);
  const actual = consumers(mergeInBatches(raw, batch));
  return (Object.keys(expected) as ConsumerName[]).filter(
    (name) => expected[name] !== actual[name],
  );
}

function parseClaude(lines: ReadonlyArray<Record<string, unknown>>): AgentTurnEvent[] {
  return lines.flatMap((line) => {
    const parsed = parseClaudeStreamJsonLine(JSON.stringify(line));
    return parsed.kind === "events" ? [...parsed.events] : [];
  });
}

describe("supersession is invisible to every turn event consumer", () => {
  it("regression: aliased Claude task telemetry reports the newest step counter", () => {
    const raw = parseClaude([
      {
        type: "system",
        subtype: "task_started",
        tool_use_id: "toolu_01",
        task_id: "task_01",
        subagent_type: "Explore",
      },
      { type: "system", subtype: "task_progress", task_id: "task_01", usage: { tool_uses: 1 } },
      {
        type: "system",
        subtype: "task_notification",
        tool_use_id: "toolu_01",
        status: "running",
        usage: { tool_uses: 2, total_tokens: 100 },
      },
      {
        type: "system",
        subtype: "task_progress",
        task_id: "task_01",
        usage: { tool_uses: 7, total_tokens: 9_000 },
      },
    ]);
    const merged = mergeTurnEvents([], raw).events;
    expect(agentTurnSubagentSummary(raw)?.entries[0]).toMatchObject({ steps: 7 });
    expect(agentTurnSubagentSummary(merged)?.entries[0]).toMatchObject({
      steps: 7,
      totalTokens: 9_000,
    });
    expect(divergences(raw, 1)).toEqual([]);
  });

  it("regression: a tool-only tick after a task-only tick keeps the summary step counter", () => {
    const raw: AgentTurnEvent[] = [
      { kind: "subagent", status: "starting", taskId: "task-2", toolId: "tool-1" },
      { kind: "subagent", status: "running", taskId: "task-2" },
      { kind: "subagent", status: "running", toolId: "tool-1", toolUses: 2 },
      { kind: "subagent", status: "running", taskId: "task-2", toolUses: 5 },
    ];
    expect(agentTurnSubagentSummary(mergeTurnEvents([], raw).events)?.entries[0]?.steps).toBe(5);
    expect(divergences(raw, 1)).toEqual([]);
  });

  it("regression: usage ticks between codex child messages do not merge the messages", () => {
    const usage = { inputTokens: 1, outputTokens: 1, contextTokens: null };
    const raw: AgentTurnEvent[] = [
      { kind: "subagentUsage", agentThreadId: "c1", usage },
      { kind: "subagentEvent", agentThreadId: "c2", event: { kind: "assistantText", text: "s2" } },
      { kind: "subagentUsage", agentThreadId: "c1", usage },
      { kind: "subagentEvent", agentThreadId: "c2", event: { kind: "assistantText", text: "s2" } },
    ];
    expect(appServerGroups(mergeTurnEvents([], raw).events).get("c2")?.events).toHaveLength(2);
    expect(divergences(raw, 1)).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5, 6])("matches the raw stream for realistic seed block %i", (block) => {
    const failures: string[] = [];
    for (let seed = block * 1_000; seed < block * 1_000 + 400; seed += 1) {
      const raw = realisticAgentTurnStream(seed, 20 + (seed % 90));
      const diverging = divergences(raw, 1 + (seed % 7));
      if (diverging.length > 0) failures.push(`seed ${seed}: ${diverging.join(",")}`);
    }
    expect(failures).toEqual([]);
  });

  it("matches the raw stream for hostile id shapes", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 3_000; seed += 1) {
      const diverging = divergences(hostileAgentTurnStream(seed, 40), 1 + (seed % 5));
      if (diverging.length > 0) failures.push(`seed ${seed}: ${diverging.join(",")}`);
    }
    expect(failures).toEqual([]);
  });

  it("actually collapses progress snapshots in the streams it compares", () => {
    const retainedShare = (stream: (seed: number, length: number) => AgentTurnEvent[]): number => {
      let raw = 0;
      let merged = 0;
      for (let seed = 1_000; seed < 1_200; seed += 1) {
        const events = stream(seed, 100);
        raw += legacyMergeTurnEvents([], events, TURN_POLICY).events.length;
        merged += mergeTurnEvents([], events).events.length;
      }
      return merged / raw;
    };
    expect(retainedShare(realisticAgentTurnStream)).toBeLessThan(0.95);
    expect(retainedShare(longRunningAgentTurnStream)).toBeLessThan(0.5);
  });
});

describe("capped consumers against the uncapped ground truth", () => {
  const UNCAPPED: AgentTurnEventRetentionPolicy = {
    ...TURN_POLICY,
    maxEvents: Number.MAX_SAFE_INTEGER,
    maxBytes: Number.MAX_SAFE_INTEGER,
    maxSubagentThreads: Number.MAX_SAFE_INTEGER,
  };

  function capped(
    raw: ReadonlyArray<AgentTurnEvent>,
    size: number,
  ): { readonly events: ReadonlyArray<AgentTurnEvent>; readonly truncated: boolean } {
    let events: ReadonlyArray<AgentTurnEvent> = [];
    let truncated = false;
    for (let index = 0; index < raw.length; index += size) {
      const merged = mergeTurnEvents(events, raw.slice(index, index + size));
      events = merged.events;
      truncated ||= merged.truncated;
    }
    return { events, truncated };
  }

  function longStream(seed: number): AgentTurnEvent[] {
    const length = 600 + ((seed * 37) % 1_400);
    if (seed % 2 === 0) return realisticAgentTurnStream(seed, length);
    return longRunningAgentTurnStream(seed, length);
  }

  it.each([0, 1, 2, 3, 4, 5])(
    "every consumer equals the raw stream while truncated stays false for seed block %i",
    { timeout: 180_000 },
    (block) => {
      const failures: string[] = [];
      let untruncated = 0;
      for (let seed = block * 50 + 1; seed <= block * 50 + 50; seed += 1) {
        const raw = longStream(seed);
        const expected = consumers(legacyMergeTurnEvents([], raw, UNCAPPED).events);
        for (const size of [1, 7, 64]) {
          const merged = capped(raw, size);
          if (merged.truncated) continue;
          untruncated += 1;
          const actual = consumers(merged.events);
          const diverging = (Object.keys(expected) as ConsumerName[]).filter(
            (name) => expected[name] !== actual[name],
          );
          if (diverging.length > 0)
            failures.push(`seed ${seed} size ${size}: ${diverging.join(",")}`);
        }
      }
      expect(failures).toEqual([]);
      expect(untruncated).toBeGreaterThanOrEqual(15);
    },
  );

  it("regression P1-A: losing absorbed subagent telemetry is always reported as truncation", () => {
    const raw: AgentTurnEvent[] = [
      { kind: "toolCall", toolId: "T", name: "Task", inputSummary: "explore" },
      {
        kind: "subagent",
        status: "running",
        toolId: "T",
        subagentType: "Explore",
        toolUses: 5,
        totalTokens: 900,
      },
      { kind: "subagent", status: "completed", toolId: "T" },
      { kind: "reasoning", text: "thinking" },
    ];
    expect(agentTurnSubagentSummary(raw)?.entries[0]).toMatchObject({
      name: "Explore",
      steps: 5,
      totalTokens: 900,
    });
    const withinCap = mergeTurnEvents([], raw);
    expect(withinCap.truncated).toBe(false);
    expect(consumers(withinCap.events)).toEqual(consumers(raw));

    const filler = Array.from(
      { length: MAX_AGENT_EVENTS_PER_TURN - 3 },
      (_, index): AgentTurnEvent => ({
        kind: "toolCall",
        toolId: `call-${index}`,
        name: "Bash",
        inputSummary: `echo ${index}`,
      }),
    );
    for (const size of [1, 64, 1_000]) {
      const overflow = capped([...raw, ...filler], size);
      expect(agentTurnSubagentSummary(overflow.events)).not.toEqual(agentTurnSubagentSummary(raw));
      expect(overflow.truncated).toBe(true);
    }
  });
});
