import { describe, expect, it } from "vitest";
import { agentTurnLogWindowPolicy } from "../application/agentTurnLogWriter";
import {
  hostileAgentTurnStream,
  longRunningAgentTurnStream,
  realisticAgentTurnStream,
} from "../test/agentTurnEventStreams";
import { MAX_AGENT_EVENTS_PER_TURN, mergeTurnEvents, type AgentTurnEvent } from "./agentThread";
import { projectAgentBackgroundActivity } from "./agentBackgroundActivity";
import { retainAgentSubagentLifecycle } from "./agentSubagentLifecycle";
import { MAX_PERSISTED_AGENT_EVENTS_PER_TURN, capTurnTail } from "./agentThreadTailCap";
import { emptyAgentTurnDigest } from "./agentTurnDigest";
import {
  MAX_CARRIED_AGENT_TURN_SNAPSHOTS,
  MAX_CARRIED_AGENT_TURN_STEERS,
  carriedAgentTurnSnapshots,
  carriedAgentTurnSteers,
  planHydratedAgentTurnEvents,
} from "./agentTurnHydrationCarry";
import { createAgentTurnWindow } from "./agentTurnWindow";

const HYDRATED_LOG_ROWS = MAX_AGENT_EVENTS_PER_TURN;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

interface ReplayedTurn {
  readonly live: ReadonlyArray<AgentTurnEvent>;
  readonly jsonTail: ReadonlyArray<AgentTurnEvent>;
  readonly logRange: ReadonlyArray<AgentTurnEvent>;
}

function replayTurn(stream: ReadonlyArray<AgentTurnEvent>): ReplayedTurn {
  let live: ReadonlyArray<AgentTurnEvent> = [];
  const window = createAgentTurnWindow({
    policy: agentTurnLogWindowPolicy(),
    firstSeq: 1,
    digest: emptyAgentTurnDigest("claudeCode"),
  });
  const rows = new Map<number, AgentTurnEvent>();
  for (let index = 0; index < stream.length; index += 7) {
    const batch = stream.slice(index, index + 7);
    live = mergeTurnEvents(live, batch).events;
    window.accept(batch);
    for (;;) {
      const taken = window.take(256, 524_288);
      if (taken.ops.length === 0) break;
      for (const op of taken.ops) rows.set(op.seq, op.event);
      window.commit(taken);
    }
  }
  const seqs = [...rows.keys()].sort((left, right) => left - right);
  const logRange = seqs
    .slice(-HYDRATED_LOG_ROWS)
    .map((seq) => rows.get(seq))
    .filter((event): event is AgentTurnEvent => event !== undefined);
  return {
    live,
    jsonTail: capTurnTail(live, MAX_PERSISTED_AGENT_EVENTS_PER_TURN, Number.POSITIVE_INFINITY),
    logRange,
  };
}

function identities(events: ReadonlyArray<AgentTurnEvent>): ReadonlySet<string> {
  return new Set(events.map((event) => JSON.stringify(event)));
}

function backgroundTaskIds(events: ReadonlyArray<AgentTurnEvent>): ReadonlySet<string> {
  return new Set(
    projectAgentBackgroundActivity(events, true, true).tasks.map((task) => task.taskId),
  );
}

function subagentIds(events: ReadonlyArray<AgentTurnEvent>): ReadonlySet<string> {
  const lifecycle = retainAgentSubagentLifecycle(undefined, events);
  return new Set((lifecycle?.entries ?? []).map((entry) => entry.id));
}

function containsAll(superset: ReadonlySet<string>, subset: ReadonlySet<string>): string[] {
  return [...subset].filter((value) => !superset.has(value));
}

describe("hydration carries what the JSON tail was already showing", () => {
  const generators = [
    ["realistic", realisticAgentTurnStream],
    ["long running", longRunningAgentTurnStream],
    ["hostile", hostileAgentTurnStream],
  ] as const;

  for (const [name, generate] of generators) {
    it(`never loses an event of the ${name} JSON tail when the log window starts later`, () => {
      for (const seed of SEEDS) {
        const replay = replayTurn(generate(seed, 5_000));
        const planned = planHydratedAgentTurnEvents(replay.jsonTail, replay.logRange);
        const hydrated = mergeTurnEvents([], planned).events;
        expect({
          seed,
          missing: containsAll(identities(hydrated), identities(replay.jsonTail)),
        }).toEqual({ seed, missing: [] });
      }
    });

    it(`never makes a ${name} consumer projection less complete than the JSON tail`, () => {
      for (const seed of SEEDS) {
        const replay = replayTurn(generate(seed, 5_000));
        const planned = planHydratedAgentTurnEvents(replay.jsonTail, replay.logRange);
        const hydrated = mergeTurnEvents([], planned).events;
        const withoutCarry = mergeTurnEvents([], replay.logRange).events;
        const lostTasks = containsAll(
          backgroundTaskIds(hydrated),
          backgroundTaskIds(replay.jsonTail),
        );
        const lostSubagents = containsAll(subagentIds(hydrated), subagentIds(replay.jsonTail));
        const unexplainedTasks = containsAll(
          backgroundTaskIds(withoutCarry),
          backgroundTaskIds(replay.jsonTail),
        );
        const unexplainedSubagents = containsAll(
          subagentIds(withoutCarry),
          subagentIds(replay.jsonTail),
        );
        expect({
          seed,
          tasks: lostTasks.filter((taskId) => !unexplainedTasks.includes(taskId)),
          subagents: lostSubagents.filter((id) => !unexplainedSubagents.includes(id)),
        }).toEqual({ seed, tasks: [], subagents: [] });
      }
    });

    it(`never narrows the persisted ${name} tail through hydration`, () => {
      for (const seed of SEEDS) {
        const replay = replayTurn(generate(seed, 5_000));
        const planned = planHydratedAgentTurnEvents(replay.jsonTail, replay.logRange);
        const hydrated = mergeTurnEvents([], planned).events;
        const persistedAfter = capTurnTail(
          hydrated,
          MAX_PERSISTED_AGENT_EVENTS_PER_TURN,
          Number.POSITIVE_INFINITY,
        );
        expect({
          seed,
          dropped: containsAll(identities(persistedAfter), identities(replay.jsonTail)),
        }).toEqual({ seed, dropped: [] });
      }
    });
  }

  it("carries a bounded number of events on top of the hydrated range", () => {
    const replay = replayTurn(realisticAgentTurnStream(1, 5_000));
    const planned = planHydratedAgentTurnEvents(replay.jsonTail, replay.logRange);
    expect(planned.length - replay.logRange.length).toBeLessThanOrEqual(
      MAX_CARRIED_AGENT_TURN_STEERS + MAX_CARRIED_AGENT_TURN_SNAPSHOTS,
    );
    expect(mergeTurnEvents([], planned).events.length).toBeLessThanOrEqual(
      MAX_AGENT_EVENTS_PER_TURN,
    );
  });
});

describe("carriedAgentTurnSnapshots", () => {
  const runningTask = (taskId: string, description?: string): AgentTurnEvent =>
    description === undefined
      ? { kind: "backgroundTask", taskId, status: "running", taskType: "shell" }
      : { kind: "backgroundTask", taskId, status: "running", taskType: "shell", description };

  const tool = (index: number): AgentTurnEvent => ({
    kind: "toolCall",
    toolId: `tool-${index}`,
    name: "Bash",
    inputSummary: `run ${index}`,
  });

  it("carries a snapshot whose identity the hydrated range never mentions", () => {
    expect(carriedAgentTurnSnapshots([runningTask("task_a"), tool(1)], [tool(2)])).toEqual([
      runningTask("task_a"),
    ]);
  });

  it("never carries a snapshot the hydrated range already holds", () => {
    expect(
      carriedAgentTurnSnapshots([runningTask("task_a")], [runningTask("task_a", "newer")]),
    ).toEqual([]);
  });

  it("never carries a snapshot the hydrated range already closed", () => {
    const finished: AgentTurnEvent = {
      kind: "backgroundTask",
      taskId: "task_a",
      status: "completed",
      taskType: "shell",
    };
    expect(carriedAgentTurnSnapshots([runningTask("task_a")], [finished])).toEqual([]);
  });

  it("keeps only the newest snapshot of one identity", () => {
    const carried = carriedAgentTurnSnapshots(
      [runningTask("task_a", "old"), runningTask("task_a", "new")],
      [tool(1)],
    );
    expect(carried).toEqual([runningTask("task_a", "new")]);
  });

  it("carries at most a bounded number of snapshots", () => {
    const current = Array.from({ length: MAX_CARRIED_AGENT_TURN_SNAPSHOTS + 5 }, (_unused, index) =>
      runningTask(`task-${index}`),
    );
    expect(carriedAgentTurnSnapshots(current, [tool(1)])).toHaveLength(
      MAX_CARRIED_AGENT_TURN_SNAPSHOTS,
    );
  });

  it("leaves the hydrated range untouched when nothing has to be carried", () => {
    const hydrated = [tool(1), tool(2)];
    expect(planHydratedAgentTurnEvents([tool(2)], hydrated)).toBe(hydrated);
  });

  it("places a carried snapshot before the closing result so the turn still ends with it", () => {
    const closing: AgentTurnEvent = { kind: "result", text: "done", isError: false, usage: null };
    const planned = planHydratedAgentTurnEvents([runningTask("task_a")], [tool(1), closing]);
    expect(planned).toEqual([tool(1), runningTask("task_a"), closing]);
  });

  it("keeps the steers ahead of the hydrated range", () => {
    const steer: AgentTurnEvent = { kind: "userMessage", text: "keep going" };
    expect(carriedAgentTurnSteers([steer], [tool(1)])).toEqual([steer]);
    expect(planHydratedAgentTurnEvents([steer], [tool(1)])).toEqual([steer, tool(1)]);
  });
});
