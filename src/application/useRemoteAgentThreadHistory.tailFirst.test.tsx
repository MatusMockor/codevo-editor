// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { agentTurnEventUtf8Bytes } from "../domain/agentThread";
import {
  MAX_AGENT_TURN_ACTIVITY_WINDOW_BYTES,
  MAX_AGENT_TURN_ACTIVITY_WINDOW_ENTRIES,
  agentTurnActivityWindowEvents,
} from "../domain/agentTurnActivityWindow";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { projectRemoteAgentThreads } from "./remoteAgentProjection";
import {
  emitStreamTurn,
  fakeRunnerGateway,
  lineNumbers,
  loadUntilSettled,
  numberedLines,
  remoteTurn,
  TAIL_FIRST_THREAD,
  turnText,
} from "./remoteAgentTailFirstTestSupport";
import { claudeTextLine, FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";
import {
  agentTurnActivityWindowOf,
  useAgentTurnEarlierActivity,
  type AgentTurnEarlierActivity,
} from "./useAgentHistoryActivity";
import { useRemoteAgentThreadHistory } from "./useRemoteAgentThreadHistory";

const TAIL = Number.MAX_SAFE_INTEGER;
const TASK = "turn-1";

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

function upTo(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

type Stage = "newest page" | "settled";

async function open(runner: FakeRunnerEvents, stage: Stage = "newest page") {
  const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
  const progress: RemoteAgentInventorySnapshot[] = [];
  const settled = await loadUntilSettled(h.gateway, runner, (reported) => progress.push(reported));
  const opened = progress.find((reported) => reported.replays.has(TASK)) ?? settled;
  const snapshot = stage === "settled" ? settled : opened;
  h.calls.listEventsBefore.mockClear();
  const views = projectRemoteAgentThreads({ ...snapshot, runnerId: "runner" });
  const turn = views[0]!.thread.turns[0]!;
  const owner = {};
  let earlier!: AgentTurnEarlierActivity;
  let offered = false;
  function Probe() {
    const history = useRemoteAgentThreadHistory({
      gateway: h.gateway,
      snapshots: [snapshot],
      views,
      selectedThreadId: TAIL_FIRST_THREAD,
      owner,
    });
    const source = turn.eventsTruncated
      ? (history.activitySource?.(TAIL_FIRST_THREAD, TASK) ?? null)
      : null;
    offered = source !== null;
    earlier = useAgentTurnEarlierActivity(source);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Probe />));
  const memoryBytes = turn.events.reduce((sum, event) => sum + agentTurnEventUtf8Bytes(event), 0);
  const window = () => agentTurnActivityWindowOf(earlier.state);
  const loadEarlier = () => act(async () => earlier.loadEarlier(memoryBytes));
  const loadEverything = async () => {
    for (let click = 0; click < 40 && window()?.hasEarlier !== false; click += 1)
      await loadEarlier();
  };
  return {
    h,
    snapshot,
    turn,
    window,
    loadEarlier,
    loadEverything,
    offered: () => offered,
    state: () => earlier.state.kind,
    shown: () => {
      const loaded = window();
      return loaded === null ? "" : turnText(agentTurnActivityWindowEvents(loaded).events);
    },
  };
}

it.each(["newest event of the earlier page", "oldest event of the newest page"] as const)(
  "stitches a split line and a steering message that is the %s",
  async (placement) => {
    const runner = new FakeRunnerEvents();
    const split = claudeTextLine("line 0150 ");
    const tailLines = placement === "oldest event of the newest page" ? 47 : 48;
    runner.lifecycle(TASK, "task.created");
    for (const line of numberedLines(150)) runner.output(TASK, claudeTextLine(line));
    runner.output(TASK, split.slice(0, 40));
    runner.input(TASK, "steer-1", "steer");
    runner.output(TASK, split.slice(40));
    for (const line of numberedLines(151 + tailLines).slice(151))
      runner.output(TASK, claudeTextLine(line));
    runner.lifecycle(TASK, "task.succeeded");
    const lines = 151 + tailLines;
    const view = await open(runner);
    const loaded = view.snapshot.replays.get(TASK)!;
    const steeringLoaded = placement === "oldest event of the newest page";

    expect(loaded).toHaveLength(50);
    expect(loaded[0]?.type).toBe(steeringLoaded ? "task.input" : "task.output");
    expect(view.turn.eventsTruncated).toBe(true);
    expect(view.offered()).toBe(true);
    expect(lineNumbers(turnText(view.turn.events))).toEqual(upTo(lines).slice(151));
    expect(turnText(view.turn.events).includes("<user:steer>")).toBe(steeringLoaded);
    expect(view.h.backward()).toEqual([]);

    await view.loadEarlier();

    expect(view.state()).toBe("ready");
    expect(
      view.h
        .backward()
        .slice(0, 2)
        .map((request) => request.before),
    ).toEqual([TAIL, loaded[0]!.sequence]);
    expect(view.h.forward()).toEqual([]);
    expect(view.shown()).toContain("line 0149 <user:steer>line 0150 line 0151 ");
    expect(view.window()?.gap).toBe(false);

    await view.loadEverything();

    expect(view.window()?.hasEarlier).toBe(false);
    expect(view.window()?.clipped).toBe(false);
    expect(lineNumbers(view.shown())).toEqual(upTo(lines));
    expect(view.shown().split("<user:steer>")).toHaveLength(2);
    expect(view.snapshot.replays.get(TASK)).toBe(loaded);
  },
);

it.each([
  { startsAtLineBoundary: true, first: 41 },
  { startsAtLineBoundary: false, first: 42 },
])(
  "pages down to output the server discarded (line boundary $startsAtLineBoundary)",
  async ({ startsAtLineBoundary, first }) => {
    const runner = new FakeRunnerEvents();
    for (const line of numberedLines(200)) runner.output(TASK, claudeTextLine(line));
    runner.lifecycle(TASK, "task.succeeded");
    runner.discardOutputThrough(TASK, runner.eventsOf(TASK)[40]!.sequence, startsAtLineBoundary);
    const view = await open(runner);

    expect(view.turn.eventsTruncated).toBe(true);
    expect(view.turn.eventsRetention).toBe("serverGap");
    expect(view.offered()).toBe(true);

    await view.loadEverything();

    expect(view.window()?.hasEarlier).toBe(false);
    expect(view.window()?.earlierDiscarded).toBe(true);
    expect(lineNumbers(view.shown())).toEqual(upTo(200).slice(first));
  },
);

it("offers nothing earlier when the newest page is the whole turn", async () => {
  const runner = new FakeRunnerEvents();
  for (const line of numberedLines(20)) runner.output(TASK, claudeTextLine(line));
  runner.lifecycle(TASK, "task.succeeded");
  const view = await open(runner);

  expect(view.turn.eventsTruncated).toBe(false);
  expect(view.offered()).toBe(false);
  expect(lineNumbers(turnText(view.turn.events))).toEqual(upTo(20));

  await view.loadEarlier();

  expect(view.state()).toBe("latest");
  expect(view.h.backward()).toEqual([]);
});

it("stops offering earlier activity once the backfill has loaded the whole turn", async () => {
  const runner = new FakeRunnerEvents();
  emitStreamTurn(runner, TASK, { lines: 400, steerFromEnd: [49, 50, 120] });
  const opened = await open(runner);
  await act(async () => root?.unmount());
  const settled = await open(runner, "settled");

  expect(opened.turn.eventsTruncated).toBe(true);
  expect(opened.offered()).toBe(true);
  expect(settled.turn.eventsTruncated).toBe(false);
  expect(settled.turn.eventsRetention).toBeUndefined();
  expect(settled.offered()).toBe(false);
  expect(lineNumbers(turnText(settled.turn.events))).toEqual(upTo(400));
  expect(turnText(settled.turn.events).split("<user:steer").length).toBe(4);
});

it("keeps on-demand loading for a turn larger than the retained window", async () => {
  const runner = new FakeRunnerEvents();
  emitStreamTurn(runner, TASK, { lines: 1_700 });
  const view = await open(runner, "settled");
  const inline = lineNumbers(turnText(view.turn.events));

  expect(view.snapshot.replayBackfill?.get(TASK)).toEqual({ kind: "retained" });
  expect(view.turn.eventsTruncated).toBe(true);
  expect(view.turn.eventsRetention).toBe("clientWindow");
  expect(view.offered()).toBe(true);
  expect(inline[0]).toBeGreaterThan(0);
  expect(inline[inline.length - 1]).toBe(1_699);

  await view.loadEverything();

  expect(view.window()?.hasEarlier).toBe(false);
  expect(lineNumbers(view.shown())[0]).toBe(0);
});

it("keeps the replay and the opened window bounded after many earlier pages", async () => {
  const runner = new FakeRunnerEvents();
  const lines = 3_000;
  for (let index = 0; index < lines; index += 1)
    runner.output(
      TASK,
      claudeTextLine(`line ${String(index).padStart(4, "0")} ${"x".repeat(900)}`),
    );
  runner.lifecycle(TASK, "task.succeeded");
  const view = await open(runner);
  const loaded = view.snapshot.replays.get(TASK)!;

  await view.loadEverything();
  const window = view.window();
  const shown = lineNumbers(view.shown());

  expect(window?.hasEarlier).toBe(false);
  expect(window?.hasLater).toBe(true);
  expect(view.h.backward().length).toBeGreaterThanOrEqual(lines / 50);
  expect(shown[0]).toBe(0);
  expect(shown).toEqual(upTo(shown.length));
  expect(window?.entries.length).toBeLessThanOrEqual(MAX_AGENT_TURN_ACTIVITY_WINDOW_ENTRIES);
  expect(window?.bytes).toBeLessThanOrEqual(MAX_AGENT_TURN_ACTIVITY_WINDOW_BYTES);
  expect(view.snapshot.replays.get(TASK)).toBe(loaded);
  expect(loaded).toHaveLength(50);
});
