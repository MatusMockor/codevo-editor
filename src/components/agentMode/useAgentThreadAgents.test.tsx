// @vitest-environment jsdom
import { act, memo, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurn, AgentTurnEvent } from "../../domain/agentThread";
import { AgentAgentsPanelProvider } from "./agents/agentAgentsPanelContext";
import { usePublishAgentThreadAgents } from "./agents/agentAgentsPanelHooks";
import { AgentAgentsPanelSurface } from "./agents/AgentAgentsPanelSurface";
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

  it("returns the previous groups array when no turn's subagents changed", () => {
    const cache = new Map();
    const events = [spawn("a", "Stream A")];
    const first = agentThreadSubagentGroups(cache, [turn("t1", events)]);
    const second = agentThreadSubagentGroups(
      cache,
      [turn("t1", [...events, { kind: "assistantText", text: "Lead talks." }])],
      first,
    );

    expect(second).toBe(first);
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
    usePublishAgentThreadAgents(agents);
    latest = agents;
    return null;
  }

  function Harness({
    threadId,
    turns,
  }: {
    readonly threadId: string;
    readonly turns: ReadonlyArray<AgentTurn>;
  }) {
    const [open, setOpen] = useState(false);
    const onOpen = useCallback(() => setOpen(true), []);
    const onToggle = useCallback(() => setOpen((current) => !current), []);
    return (
      <AgentAgentsPanelProvider isOpen={open} onOpen={onOpen} onToggle={onToggle}>
        <Probe threadId={threadId} turns={turns} />
        {open && <AgentAgentsPanelSurface />}
      </AgentAgentsPanelProvider>
    );
  }

  const live = (turnId: string, durationMs: number) => [
    turn(turnId, [
      spawn("a", "Stream A"),
      { kind: "subagent", status: "running", toolId: "a", description: "Reading", durationMs },
    ]),
  ];

  it("opens the panel through the provider and shows only the current thread, including A, B, A", () => {
    const turnsA = live("a-t1", 1_000);
    const turnsB = [
      turn("b-t1", [
        spawn("z", "Stream Z"),
        { kind: "subagent", status: "running", toolId: "z", description: "Z", durationMs: 1 },
      ]),
    ];
    const names = () =>
      [...host.querySelectorAll(".cv-agents-row__name")].map((node) => node.textContent);
    act(() => root.render(<Harness threadId="a" turns={turnsA} />));
    expect(host.querySelector(".cv-agents")).toBeNull();
    const first = latest;
    act(() => root.render(<Harness threadId="a" turns={turnsA} />));
    expect(latest).toBe(first);

    act(() => latest?.openPanel());
    expect(names()).toEqual(["Stream A"]);

    act(() => root.render(<Harness threadId="b" turns={turnsB} />));
    expect(names()).toEqual(["Stream Z"]);
    act(() => root.render(<Harness threadId="a" turns={turnsA} />));
    expect(names()).toEqual(["Stream A"]);
  });

  it("does not re-render agent consumers on a streaming flush that leaves subagents unchanged", () => {
    let renders = 0;
    const Consumer = memo(function Consumer({ agents }: { readonly agents: AgentThreadAgents }) {
      renders += 1;
      return <span>{agents.working}</span>;
    });
    function Streaming({ turns }: { readonly turns: ReadonlyArray<AgentTurn> }) {
      const agents = useAgentThreadAgents("a", turns);
      return <Consumer agents={agents} />;
    }
    const base = [
      spawn("a", "Stream A"),
      { kind: "subagent", status: "running", toolId: "a", description: "Reading" } as const,
    ];
    act(() => root.render(<Streaming turns={[turn("t1", base)]} />));
    expect(renders).toBe(1);
    for (let index = 0; index < 5; index += 1) {
      act(() =>
        root.render(
          <Streaming
            turns={[turn("t1", [...base, { kind: "assistantText", text: `chunk ${index}` }])]}
          />,
        ),
      );
    }
    expect(renders).toBe(1);
    act(() =>
      root.render(
        <Streaming
          turns={[
            turn("t1", [
              ...base,
              { kind: "subagent", status: "completed", toolId: "a", description: "Done" },
            ]),
          ]}
        />,
      ),
    );
    expect(renders).toBe(2);
  });

  it("anchors staleness to the first sighting of a report, not to the panel opening", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const turns = live("a-t1", 60_000);
    act(() => root.render(<Harness threadId="a" turns={turns} />));
    vi.advanceTimersByTime(6 * 3_600_000);
    act(() => latest?.openPanel());

    expect(host.querySelector(".cv-agents-row__elapsed")?.textContent).toBe("3m 00s");
    expect(host.querySelector(".cv-agents-row__stale")?.textContent).toBe("no update for 6h 00m");
    expect(latest).toMatchObject({ working: 1, tracked: true, truncated: false });
  });

  it("ticks a live timer for a running Codex child that reports no duration until it settles", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const codexSpawn: AgentTurnEvent = {
      kind: "subagentSpawn",
      callId: "call-a",
      status: "inProgress",
      taskTitle: "Map the routes",
      model: null,
      reasoningEffort: null,
      agentThreadIds: ["child-a"],
    };
    const started: AgentTurnEvent = {
      kind: "subagentActivity",
      agentThreadId: "child-a",
      agentPath: "explorer",
      activity: "started",
    };
    const running = [turn("codex-t1", [codexSpawn, started])];
    act(() => root.render(<Harness threadId="codex" turns={running} />));
    act(() => latest?.openPanel());
    const elapsed = () => host.querySelector(".cv-agents-row__elapsed")?.textContent;
    expect(host.querySelector(".cv-agents-row__name")?.textContent).toBe("Map the routes");
    expect(elapsed()).toBe("0s");

    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(elapsed()).toBe("1m 05s");
    act(() => {
      vi.advanceTimersByTime(180_000);
    });
    expect(elapsed()).toBe("4m 05s");
    expect(host.querySelector(".cv-agents-row__stale")?.textContent).toBe("");

    const done = [
      turn("codex-t1", [
        codexSpawn,
        started,
        { kind: "subagentTurnDone", agentThreadId: "child-a", durationMs: 250_000, isError: false },
      ]),
    ];
    act(() => root.render(<Harness threadId="codex" turns={done} />));
    expect(elapsed()).toBe("4m 10s");
  });
});
