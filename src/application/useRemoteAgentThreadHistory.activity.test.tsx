// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { AGENT_TURN_LOG_LIMITS, type AgentTurnLogPage } from "../domain/agentTurnLog";
import type {
  RemoteRunnerDescriptor,
  RemoteRunnerEventPage,
  RemoteRunnerGateway,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import {
  emptyRemoteInventory,
  type RemoteAgentInventorySnapshot,
} from "./remoteAgentInventoryLoad";
import { projectRemoteAgentThreads } from "./remoteAgentProjection";
import { RemoteTurnReaderRevoked } from "./remoteAgentTurnRawPages";
import { REMOTE_TURN_ACTIVITY_TAIL_SEQ } from "./remoteAgentTurnSegments";
import { FakeRunnerEvents, claudeTextLine } from "./remoteAgentTurnActivityTestSupport";
import {
  agentHistoryActivitySourceIdentity,
  type AgentHistoryActivitySource,
} from "./useAgentHistoryActivity";
import type { AgentThreadHistorySurface } from "./useAgentThreadHistory";
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

function descriptor(eventBackwardPaging: boolean | undefined): RemoteRunnerDescriptor {
  return {
    protocolVersion: 1,
    runnerId: "runner",
    name: "Server",
    capabilities: {
      taskExecution: true,
      eventReplay: true,
      ...(eventBackwardPaging === undefined ? {} : { eventBackwardPaging }),
    },
  };
}

function harness(options: { capability?: boolean; backward?: boolean } = {}) {
  const runner = new FakeRunnerEvents();
  for (let index = 0; index < 120; index += 1)
    runner.output(TASK.id, claudeTextLine(`line ${index}`));
  let gate: Promise<void> | null = null;
  const listEventsBefore: RemoteRunnerGateway["listEventsBefore"] = async (request) => {
    const page: RemoteRunnerEventPage = await runner.listEventsBefore(request);
    if (gate !== null) await gate;
    return page;
  };
  const gateway = {
    ...(options.backward === false ? {} : { listEventsBefore }),
  } as unknown as RemoteRunnerGateway;
  let owner: object = {};
  let tasks: readonly RemoteRunnerTask[] = [TASK];
  let connected = true;
  let selected = true;
  let surface!: AgentThreadHistorySurface;
  const threadId = projectRemoteAgentThreads({
    ...emptyRemoteInventory("server", true),
    runnerId: "runner",
    tasks,
  })[0]!.thread.threadId;
  function Probe() {
    const snapshot: RemoteAgentInventorySnapshot = {
      ...emptyRemoteInventory("server", connected),
      descriptor: descriptor("capability" in options ? options.capability : true),
      tasks,
    };
    surface = useRemoteAgentThreadHistory({
      gateway,
      snapshots: [snapshot],
      views: projectRemoteAgentThreads({ ...snapshot, runnerId: "runner" }),
      selectedThreadId: selected ? threadId : null,
      owner,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  const render = async () => {
    await act(async () => root!.render(<Probe />));
  };
  return {
    runner,
    threadId,
    render,
    source: (turnId = TASK.id) => surface.activitySource?.(threadId, turnId) ?? null,
    replaceOwner: async () => {
      owner = {};
      await render();
    },
    connect: async (next: boolean) => {
      connected = next;
      await render();
    },
    select: async (next: boolean) => {
      selected = next;
      await render();
    },
    removeTask: async () => {
      tasks = [];
      await render();
    },
    hold: () => {
      let release!: () => void;
      gate = new Promise<void>((done) => {
        release = done;
      });
      return () => {
        gate = null;
        release();
      };
    },
  };
}

function tail(source: AgentHistoryActivitySource | null): Promise<AgentTurnLogPage> {
  expect(source).not.toBeNull();
  return source!.readPage({
    scope: source!.scope,
    anchor: { at: "tail" },
    maxEvents: AGENT_TURN_LOG_LIMITS.pageEvents,
    maxBytes: AGENT_TURN_LOG_LIMITS.pageBytes,
  });
}

it("offers no earlier-activity reader when the runner does not announce backward paging", async () => {
  for (const options of [
    { capability: undefined },
    { capability: false },
    { capability: true, backward: false },
  ]) {
    const h = harness(options);
    await h.render();
    expect(h.source()).toBeNull();
    await act(async () => root?.unmount());
    root = null;
  }
});

it("binds one stable reader per turn to the exact remote thread and task", async () => {
  const h = harness();
  await h.render();
  const first = h.source();
  await h.render();
  const second = h.source();

  expect(first).not.toBeNull();
  expect(second).toBe(first);
  expect(first?.scope).toEqual({
    rootKey: "remote:server:runner:project",
    ownerId: "remote:server:runner:project",
    threadId: h.threadId,
    turnId: TASK.id,
  });
  expect(first?.leaseToken).toBeNull();
  expect(h.source("task-unknown")).toBeNull();

  const page = await tail(first);
  expect(page.entries).toHaveLength(120);
  expect(page.lastSeq).toBe(REMOTE_TURN_ACTIVITY_TAIL_SEQ);
  expect(
    h.runner.calls.every((call) => call.serverId === "server" && call.taskId === TASK.id),
  ).toBe(true);
});

it("rejects a read for another turn through a bound source", async () => {
  const h = harness();
  await h.render();
  const source = h.source();

  await expect(
    source!.readPage({
      scope: { ...source!.scope, turnId: "task-2" },
      anchor: { at: "tail" },
      maxEvents: 200,
      maxBytes: 1_000,
    }),
  ).rejects.toBeInstanceOf(RemoteTurnReaderRevoked);
  expect(h.runner.calls).toEqual([]);
});

it.each([
  ["the connection authority was replaced", (h: ReturnType<typeof harness>) => h.replaceOwner()],
  [
    "the server reconnected",
    async (h: ReturnType<typeof harness>) => {
      await h.connect(false);
      await h.connect(true);
    },
  ],
  [
    "another thread was selected and this one selected again",
    async (h: ReturnType<typeof harness>) => {
      await h.select(false);
      await h.select(true);
    },
  ],
])("issues a new source identity and revokes the old reader after %s", async (_name, change) => {
  const h = harness();
  await h.render();
  const stale = h.source();
  await tail(stale);
  const calls = h.runner.calls.length;

  await change(h);
  const fresh = h.source();

  expect(fresh).not.toBeNull();
  expect(agentHistoryActivitySourceIdentity(fresh)).not.toBe(
    agentHistoryActivitySourceIdentity(stale),
  );
  await expect(tail(stale)).rejects.toBeInstanceOf(RemoteTurnReaderRevoked);
  expect(h.runner.calls).toHaveLength(calls);
  await expect(tail(fresh)).resolves.toMatchObject({ lastSeq: REMOTE_TURN_ACTIVITY_TAIL_SEQ });
});

it.each([
  ["the server is disconnected", (h: ReturnType<typeof harness>) => h.connect(false)],
  ["the thread is no longer selected", (h: ReturnType<typeof harness>) => h.select(false)],
  ["the task is gone", (h: ReturnType<typeof harness>) => h.removeTask()],
])("offers no source and fails the old reader closed while %s", async (_name, change) => {
  const h = harness();
  await h.render();
  const stale = h.source();

  await change(h);

  expect(h.source()).toBeNull();
  await expect(tail(stale)).rejects.toBeInstanceOf(RemoteTurnReaderRevoked);
  expect(h.runner.calls).toEqual([]);
});

it("drops a response that arrives after the authority was replaced", async () => {
  const h = harness();
  await h.render();
  const stale = h.source();
  const release = h.hold();
  const pending = tail(stale);
  const settled = pending.then(
    () => "published",
    (error: unknown) => error,
  );

  await h.replaceOwner();
  release();

  expect(await settled).toBeInstanceOf(RemoteTurnReaderRevoked);
  expect(h.runner.calls).toHaveLength(1);
});

it("fails every reader closed after the surface unmounted", async () => {
  const h = harness();
  await h.render();
  const source = h.source();
  await act(async () => root?.unmount());
  root = null;

  await expect(tail(source)).rejects.toBeInstanceOf(RemoteTurnReaderRevoked);
});
