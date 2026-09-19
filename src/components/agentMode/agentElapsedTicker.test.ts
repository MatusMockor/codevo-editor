// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_ELAPSED_STALE_AFTER_MS,
  MAX_AGENT_ELAPSED_OBSERVATIONS,
  agentElapsedReading,
  createAgentElapsedTicker,
  type AgentElapsedTarget,
} from "./agentElapsedTicker";

const HOUR_MS = 3_600_000;

function target(): AgentElapsedTarget {
  return {
    clock: document.createElement("span"),
    stale: document.createElement("span"),
    description: document.createElement("span"),
  };
}

describe("agentElapsedReading", () => {
  it("runs the clock while reports are fresh and freezes it once they stop", () => {
    expect(agentElapsedReading(60_000, 1_000, 31_000)).toEqual({
      displayMs: 90_000,
      silentForMs: null,
    });
    expect(agentElapsedReading(60_000, 1_000, 1_000 + AGENT_ELAPSED_STALE_AFTER_MS)).toEqual({
      displayMs: 180_000,
      silentForMs: null,
    });
    expect(agentElapsedReading(60_000, 1_000, 1_000 + 6 * HOUR_MS)).toEqual({
      displayMs: 180_000,
      silentForMs: 6 * HOUR_MS,
    });
    expect(agentElapsedReading(60_000, 5_000, 1_000).displayMs).toBe(60_000);
  });
});

describe("createAgentElapsedTicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops looking precisely alive after one report and six silent hours", () => {
    const ticker = createAgentElapsedTicker();
    const row = target();
    ticker.register("t1:a", 60_000, row);
    expect(row.clock.textContent).toBe("1m 00s");
    expect(row.stale?.textContent).toBe("");

    vi.advanceTimersByTime(6 * HOUR_MS);
    expect(row.clock.textContent).toBe("3m 00s");
    expect(row.stale?.textContent).toBe("no update for 6h 00m");

    ticker.register("t1:a", 75_000, row);
    expect(row.clock.textContent).toBe("1m 15s");
    expect(row.stale?.textContent).toBe("");
    ticker.dispose();
  });

  it("keeps the first observation of a report as the anchor across re-registration", () => {
    const ticker = createAgentElapsedTicker();
    ticker.observe("t1:a", 60_000);
    vi.advanceTimersByTime(5 * 60_000);
    const row = target();
    const unregister = ticker.register("t1:a", 60_000, row);

    expect(row.clock.textContent).toBe("3m 00s");
    expect(row.stale?.textContent).toBe("no update for 5m");
    unregister();
    expect(row.stale?.textContent).toBe("");
    expect(vi.getTimerCount()).toBe(0);
    ticker.dispose();
  });

  it("rewrites the accessible description at most every thirty seconds", () => {
    const ticker = createAgentElapsedTicker();
    const row = target();
    const writes: string[] = [];
    const description = row.description!;
    const original = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
    Object.defineProperty(description, "textContent", {
      configurable: true,
      get: () => original.get!.call(description),
      set: (value: string) => {
        writes.push(value);
        original.set!.call(description, value);
      },
    });
    ticker.register("t1:a", 58_000, row);
    vi.advanceTimersByTime(65_000);

    expect(writes).toEqual(["Elapsed 58s", "Elapsed 1m 28s", "Elapsed 1m 58s"]);
    ticker.dispose();
  });

  it("never evicts the anchor of a row that is still on screen", () => {
    const ticker = createAgentElapsedTicker();
    const row = target();
    ticker.register("t1:a", 60_000, row);
    for (let index = 0; index <= MAX_AGENT_ELAPSED_OBSERVATIONS; index += 1)
      ticker.observe(`agent-${index}`, 1_000);

    vi.advanceTimersByTime(30_000);

    expect(row.clock.textContent).toBe("1m 30s");
    expect(row.stale?.textContent).toBe("");
    ticker.dispose();
  });

  it("refreshes recency on an unchanged observation without moving the anchor", () => {
    const ticker = createAgentElapsedTicker();
    ticker.observe("stable", 60_000);
    for (let index = 0; index < MAX_AGENT_ELAPSED_OBSERVATIONS - 1; index += 1)
      ticker.observe(`agent-${index}`, 1_000);
    vi.advanceTimersByTime(5 * 60_000);
    ticker.observe("stable", 60_000);
    ticker.observe("newcomer", 1_000);
    const row = target();
    ticker.register("stable", 60_000, row);

    expect(row.clock.textContent).toBe("3m 00s");
    expect(row.stale?.textContent).toBe("no update for 5m");
    ticker.dispose();
  });

  it("bounds retained observations with oldest-first eviction", () => {
    const ticker = createAgentElapsedTicker();
    ticker.observe("first", 1_000);
    vi.advanceTimersByTime(10 * 60_000);
    for (let index = 0; index < MAX_AGENT_ELAPSED_OBSERVATIONS; index += 1)
      ticker.observe(`agent-${index}`, 1_000);
    const row = target();
    ticker.register("first", 1_000, row);

    expect(row.stale?.textContent).toBe("");
    ticker.dispose();
  });
});
