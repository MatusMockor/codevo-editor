// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { agentTurnEventUtf8Bytes } from "../domain/agentThread";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import {
  emptyRemoteInventory,
  type RemoteAgentInventorySnapshot,
} from "./remoteAgentInventoryLoad";
import { projectRemoteAgentThreads } from "./remoteAgentProjection";
import {
  FakeRunnerEvents,
  feedClaudeLines,
  loadedRemoteReplay,
} from "./remoteAgentTurnActivityTestSupport";
import {
  agentTurnActivityWindowOf,
  useAgentTurnEarlierActivity,
  type AgentTurnEarlierActivity,
} from "./useAgentHistoryActivity";
import { useRemoteAgentThreadHistory } from "./useRemoteAgentThreadHistory";

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

const TASK: RemoteRunnerTask = {
  id: "task-1",
  runnerId: "runner",
  sequence: 1,
  provider: "claude",
  status: "succeeded",
  projectId: "project",
  parts: [{ type: "text", text: "Prompt" }],
  createdAt: "2026-09-13T00:00:00Z",
  conversationId: "task-1",
};
const LINES = 1_620;

interface Scenario {
  readonly snapshotReplay: "loaded" | "evidenceOfServerRetention" | "none";
}

async function open(scenario: Scenario) {
  const runner = new FakeRunnerEvents();
  runner.lifecycle(TASK.id, "task.created");
  feedClaudeLines(
    runner,
    TASK.id,
    Array.from({ length: LINES }, (_, index) => `line ${String(index).padStart(5, "0")} `),
    97,
  );
  runner.lifecycle(TASK.id, "task.succeeded");
  const all = runner.eventsOf(TASK.id);
  const local = loadedRemoteReplay(all, 3_000_000);
  const evicted = all[all.indexOf(local[0]!) - 1]!;
  const loaded: RemoteAgentInventorySnapshot = {
    ...emptyRemoteInventory("server", true),
    descriptor: {
      protocolVersion: 1,
      runnerId: "runner",
      name: "Server",
      capabilities: { taskExecution: true, eventReplay: true, eventBackwardPaging: true },
    },
    tasks: [TASK],
    replays: new Map([[TASK.id, local]]),
    replayComplete: new Set([TASK.id]),
    replayTruncated: new Set([TASK.id]),
    replayGaps: new Map([
      [
        TASK.id,
        {
          throughSequence: evicted.sequence,
          startsAtLineBoundary: evicted.text?.endsWith("\n") === true,
        },
      ],
    ]),
  };
  const views = projectRemoteAgentThreads({ ...loaded, runnerId: "runner" });
  const turn = views[0]!.thread.turns[0]!;
  const snapshot: RemoteAgentInventorySnapshot = {
    ...loaded,
    ...(scenario.snapshotReplay === "none" ? { replays: new Map() } : {}),
    ...(scenario.snapshotReplay === "evidenceOfServerRetention"
      ? { replayServerEvictions: new Map([[TASK.id, 1]]) }
      : {}),
  };
  const gateway = { listEventsBefore: runner.listEventsBefore } as unknown as RemoteRunnerGateway;
  const owner = {};
  let earlier!: AgentTurnEarlierActivity;
  function Probe() {
    const history = useRemoteAgentThreadHistory({
      gateway,
      snapshots: [snapshot],
      views,
      selectedThreadId: views[0]!.thread.threadId,
      owner,
    });
    earlier = useAgentTurnEarlierActivity(
      history.activitySource?.(views[0]!.thread.threadId, TASK.id) ?? null,
    );
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Probe />));
  const callsAfterRender = runner.calls.length;
  const memoryBytes = turn.events.reduce((sum, event) => sum + agentTurnEventUtf8Bytes(event), 0);
  await act(async () => earlier.loadEarlier(memoryBytes));
  const window = agentTurnActivityWindowOf(earlier.state);
  const result = {
    truncated: turn.eventsTruncated,
    callsAfterRender,
    calls: runner.calls.map((call) => call.before),
    kind: earlier.state.kind,
    window,
    rawPages: Math.ceil(all.length / 50),
    localFiftyFirst: local[50]!.sequence,
  };
  await act(async () => root?.unmount());
  root = null;
  return result;
}

it("opens the window of a truncated turn with a handful of runner calls when its tail is in the snapshot", async () => {
  const local = await open({ snapshotReplay: "loaded" });
  const remote = await open({ snapshotReplay: "none" });

  expect(local.truncated).toBe(true);
  expect(local.callsAfterRender).toBe(0);
  expect(local.kind).toBe("ready");
  expect(remote.kind).toBe("ready");
  expect(local.window).toEqual(remote.window);
  expect(local.window?.entries.length).toBeGreaterThan(900);
  expect(remote.rawPages).toBe(28);
  expect(remote.calls).toHaveLength(remote.rawPages);
  expect(local.calls).toHaveLength(8);
  expect(local.calls[0]).toBe(Number.MAX_SAFE_INTEGER);
  expect(local.calls.slice(1).every((before) => before <= local.localFiftyFirst)).toBe(true);
});

it("keeps asking the runner for everything when the snapshot has server retention evidence", async () => {
  const guarded = await open({ snapshotReplay: "evidenceOfServerRetention" });

  expect(guarded.kind).toBe("ready");
  expect(guarded.calls).toHaveLength(guarded.rawPages);
});
