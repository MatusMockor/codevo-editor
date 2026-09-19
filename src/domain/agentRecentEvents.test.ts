import { describe, expect, it } from "vitest";
import { MAX_AGENT_STEERS_PER_TURN } from "./agentTask";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  MAX_AGENT_EVENT_TEXT_BYTES,
  agentTurnEventUtf8Bytes,
  mergeTurnEvents,
  type AgentTurnEvent,
} from "./agentThread";

const text = (value: string): AgentTurnEvent => ({ kind: "assistantText", text: value });
const bytes = (events: readonly AgentTurnEvent[]) =>
  events.reduce((total, event) => total + agentTurnEventUtf8Bytes(event), 0);
const FULL_BYTE_WINDOW = Math.floor(MAX_AGENT_EVENT_BYTES_PER_TURN / MAX_AGENT_EVENT_TEXT_BYTES);

describe("recent turn event window", () => {
  it("retains the same newest window across burst and incremental delivery", () => {
    const events: AgentTurnEvent[] = Array.from({ length: 10_000 }, (_, i) => ({
      kind: "error",
      message: `event-${i}`,
    }));
    const burst = mergeTurnEvents([], events);
    let incremental: readonly AgentTurnEvent[] = [];
    for (let index = 0; index < events.length; index += 71)
      incremental = mergeTurnEvents(incremental, events.slice(index, index + 71)).events;
    expect(burst.events).toEqual(events.slice(-MAX_AGENT_EVENTS_PER_TURN));
    expect(incremental).toEqual(burst.events);
    expect(burst.truncated).toBe(true);
    expect(bytes(burst.events)).toBeLessThanOrEqual(MAX_AGENT_EVENT_BYTES_PER_TURN);
  });

  it("keeps final result, image reference, usage and failure after aggregate byte eviction", () => {
    const noise: AgentTurnEvent[] = Array.from({ length: FULL_BYTE_WINDOW + 8 }, (_, i) => ({
      kind: i % 2 ? "reasoning" : "assistantText",
      text: "x".repeat(MAX_AGENT_EVENT_TEXT_BYTES),
    }));
    const recent: AgentTurnEvent[] = [
      { kind: "contextUsage", model: "test", inputTokens: 123, contextWindow: 1000 },
      { kind: "result", text: "![Preview](preview.png)", usage: null, isError: false },
      { kind: "error", message: "Final failure" },
    ];
    const first = mergeTurnEvents([], noise);
    const last = mergeTurnEvents(first.events, recent);
    expect(first.truncated).toBe(true);
    expect(last.events.slice(-3)).toEqual(recent);
    expect(bytes(last.events)).toBeLessThanOrEqual(MAX_AGENT_EVENT_BYTES_PER_TURN);
    expect(last.events.length).toBeLessThanOrEqual(MAX_AGENT_EVENTS_PER_TURN);
  });

  it("coalesces only within the per-event text bound at the byte limit", () => {
    const initial = Array.from({ length: FULL_BYTE_WINDOW }, () =>
      text("x".repeat(MAX_AGENT_EVENT_TEXT_BYTES)),
    );
    const result = mergeTurnEvents(initial, [text("€"), text("suffix")]);
    expect(result.truncated).toBe(true);
    expect(result.events[result.events.length - 1]).toEqual(text("€suffix"));
    expect(result.events).toHaveLength(FULL_BYTE_WINDOW);
    expect(
      result.events.every((event) => agentTurnEventUtf8Bytes(event) <= MAX_AGENT_EVENT_TEXT_BYTES),
    ).toBe(true);
    expect(bytes(result.events)).toBeLessThanOrEqual(MAX_AGENT_EVENT_BYTES_PER_TURN);
  });

  it("skips an individually oversized record but accepts the following record", () => {
    const result = mergeTurnEvents(
      [],
      [text("x".repeat(MAX_AGENT_EVENT_BYTES_PER_TURN + 1)), text("new")],
    );
    expect(result).toEqual({ events: [text("new")], truncated: true });
  });
  it("preserves accepted steering messages while old output rolls off", () => {
    const steer: AgentTurnEvent = { kind: "userMessage", text: "Keep this instruction" };
    const noise: AgentTurnEvent[] = Array.from(
      { length: MAX_AGENT_EVENTS_PER_TURN * 2 },
      (_, i) => ({ kind: "error", message: String(i) }),
    );
    const result = mergeTurnEvents([steer], noise);
    expect(result.events[0]).toBe(steer);
    expect(result.events.slice(1)).toEqual(noise.slice(-(MAX_AGENT_EVENTS_PER_TURN - 1)));
    expect(result.truncated).toBe(true);
  });

  it("terminates within bounds when pinned steering consumes the byte budget", () => {
    const steers: AgentTurnEvent[] = Array.from({ length: MAX_AGENT_STEERS_PER_TURN }, () => ({
      kind: "userMessage" as const,
      text: "x".repeat(MAX_AGENT_EVENT_TEXT_BYTES),
    }));
    const filler: AgentTurnEvent[] = Array.from({ length: FULL_BYTE_WINDOW }, () =>
      text("y".repeat(MAX_AGENT_EVENT_TEXT_BYTES)),
    );
    const result = mergeTurnEvents(
      [...steers, ...filler],
      [text("new output"), { kind: "error", message: "failure" }],
    );
    expect(result.events.filter((event) => event.kind === "userMessage")).toEqual(steers);
    expect(result.events.slice(-1)).toEqual([{ kind: "error", message: "failure" }]);
    expect(bytes(result.events)).toBeLessThanOrEqual(MAX_AGENT_EVENT_BYTES_PER_TURN);
    expect(result.truncated).toBe(true);
  });
});
