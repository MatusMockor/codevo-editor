// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurn, AgentTurnEvent } from "../../domain/agentThread";
import { AgentAgentsPanel } from "./AgentAgentsPanel";
import {
  agentThreadSubagentGroups,
  useAgentThreadAgents,
  type AgentThreadAgents,
} from "./useAgentThreadAgents";

function turn(turnId: string, events: ReadonlyArray<AgentTurnEvent>): AgentTurn {
  return {
    turnId,
    prompt: "Delegate",
    status: { kind: "running" },
    startedAtEpochMs: 0,
    endedAtEpochMs: null,
    events,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

const spawn = (toolId: string, description: string): AgentTurnEvent => ({
  kind: "toolCall",
  toolId,
  name: "Agent",
  inputSummary: "prompt",
  description,
});
const tick = (toolId: string, description: string, totalTokens: number): AgentTurnEvent => ({
  kind: "subagent",
  status: "running",
  toolId,
  description,
  totalTokens,
});

describe("agentThreadSubagentGroups", () => {
  it("recomputes only the changed turn and keeps untouched agents identical across ticks", () => {
    const cache = new Map();
    const settled = turn("t1", [spawn("old", "Earlier job")]);
    const base = [spawn("a", "Stream A"), spawn("b", "Stream B"), tick("a", "Reading", 1)];
    const first = agentThreadSubagentGroups(cache, [settled, turn("t2", base)]);

    let previous = first;
    for (let index = 2; index < 12; index += 1) {
      const next = agentThreadSubagentGroups(cache, [
        settled,
        turn("t2", [...base, tick("b", `Running step ${index}`, index)]),
      ]);
      expect(next[0]?.subagents).toBe(first[0]?.subagents);
      expect(next[1]?.subagents).not.toBe(previous[1]?.subagents);
      expect(next[1]?.subagents.agents[0]).toBe(first[1]?.subagents.agents[0]);
      expect(next[1]?.subagents.agents[1]?.activity).toBe(`Running step ${index}`);
      previous = next;
    }
  });

  it("returns the identical model when a turn changes without touching its subagents", () => {
    const cache = new Map();
    const events = [spawn("a", "Stream A")];
    const first = agentThreadSubagentGroups(cache, [turn("t1", events)]);
    const second = agentThreadSubagentGroups(cache, [
      turn("t1", [...events, { kind: "assistantText", text: "Lead talks." }]),
    ]);

    expect(second[0]?.subagents).toBe(first[0]?.subagents);
  });

  it("evicts turns that left the thread", () => {
    const cache = new Map();
    agentThreadSubagentGroups(cache, [turn("t1", [spawn("a", "A")]), turn("t2", [])]);
    agentThreadSubagentGroups(cache, [turn("t2", [])]);

    expect([...cache.keys()]).toEqual(["t2"]);
  });
});

describe("useAgentThreadAgents", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AgentThreadAgents | null = null;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    latest = null;
  });

  function Probe({
    threadId,
    turns,
  }: {
    readonly threadId: string;
    readonly turns: ReadonlyArray<AgentTurn>;
  }) {
    const agents = useAgentThreadAgents(threadId, turns);
    latest = agents;
    return agents.panel === null ? null : <AgentAgentsPanel {...agents.panel} />;
  }

  const live = (turnId: string, durationMs: number) => [
    turn(turnId, [
      spawn("a", "Stream A"),
      { kind: "subagent", status: "running", toolId: "a", description: "Reading", durationMs },
    ]),
  ];

  it("resets the open panel when the thread changes, including A, B, A", () => {
    const turnsA = live("a-t1", 1_000);
    const turnsB = live("b-t1", 1_000);
    act(() => root.render(<Probe threadId="a" turns={turnsA} />));
    act(() => latest?.openPanel());
    expect(latest?.panel).toMatchObject({ autoFocus: true });

    act(() => root.render(<Probe threadId="b" turns={turnsB} />));
    expect(latest?.panel).toBeNull();
    act(() => root.render(<Probe threadId="a" turns={turnsA} />));
    expect(latest?.panel).toBeNull();
    expect(host.querySelector(".agents-panel")).toBeNull();
  });

  it("anchors staleness to the first sighting of a report, not to the panel opening", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const turns = live("a-t1", 60_000);
    act(() => root.render(<Probe threadId="a" turns={turns} />));
    vi.advanceTimersByTime(6 * 3_600_000);
    act(() => latest?.openPanel());

    expect(host.querySelector(".agents-panel__elapsed")?.textContent).toBe("3m 00s");
    expect(host.querySelector(".agents-panel__stale")?.textContent).toBe("no update for 6h 00m");
    expect(latest).toMatchObject({ working: 1, tracked: true, truncated: false });
  });
});
