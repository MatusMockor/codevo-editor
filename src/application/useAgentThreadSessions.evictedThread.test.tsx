// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAgentLaunchOptions } from "../domain/agentLaunch";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import {
  agentThreadsReducer,
  emptyAgentThreadsState,
  type AgentThread,
  type AgentThreadsState,
  type AgentTurn,
} from "../domain/agentThread";
import type {
  AgentSessionBackgroundTurnEvent,
  AgentThreadSessionGateway,
} from "../domain/agentThreadSession";
import { waitForReact } from "../test/reactTestLifecycle";
import type { AgentHistoryCatalogGateway } from "./useAgentHistoryCatalog";
import { useAgentThreadSessions } from "./useAgentThreadSessions";

const ROOT_KEY = "/workspace/app";
const OWNER_ID = "ws-live-1";
const THREAD_ID = "agt-1-0a1c";

function project(): AgentProjectDescriptor {
  return {
    rootKey: ROOT_KEY,
    rootPath: ROOT_KEY,
    ownerId: OWNER_ID,
    label: "app",
    generation: 1,
    trust: "trusted",
    origin: "active-tab",
    repositories: [],
    isolationPolicy: "auto",
    leaseToken: null,
  };
}

const promptedTurn: AgentTurn = {
  turnId: "agt-1-t1",
  prompt: "start the build in the background",
  status: { kind: "exited", exitCode: 0 },
  startedAtEpochMs: 1,
  endedAtEpochMs: 2,
  events: [],
  eventsTruncated: false,
  lastStatusSequence: 1,
  lastOutputSequence: 1,
  launch: defaultAgentLaunchOptions("claudeCode"),
  cliVersion: null,
};

function thread(ownerId: string): AgentThread {
  return {
    threadId: THREAD_ID,
    owner: { rootKey: ROOT_KEY, ownerId, repositoryRoot: ROOT_KEY },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "sess-fixture-0001" },
    title: "Nightly build",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1,
    updatedAtEpochMs: 2,
    turns: [promptedTurn],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
    historyRevision: 7,
  };
}

function reply(text: string): string {
  return [
    { type: "system", subtype: "init", session_id: "sess-fixture-0001" },
    { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text }] } },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: text,
      origin: { kind: "task-notification" },
    },
  ]
    .map((line) => `${JSON.stringify(line)}\n`)
    .join("");
}

function sessionGateway() {
  let handler: ((event: AgentSessionBackgroundTurnEvent) => void) | null = null;
  const fake = {
    interruptAgentTask: vi.fn(async () => ({ kind: "interrupting" }) as const),
    inspectAgentThreadSession: vi.fn(async () => ({ kind: "none" }) as const),
    endAgentThreadSession: vi.fn(async () => true),
    stopAgentBackgroundTask: vi.fn(async () => ({ kind: "noSession" }) as const),
    subscribeAgentSessionEnded: vi.fn(async () => () => undefined),
    subscribeAgentSessionBackgroundTurn: vi.fn(
      async (next: (event: AgentSessionBackgroundTurnEvent) => void) => {
        handler = next;
        return () => undefined;
      },
    ),
    subscribeAgentSessionBackgroundTasks: vi.fn(async () => () => undefined),
  } satisfies AgentThreadSessionGateway;
  return {
    fake,
    emit(event: AgentSessionBackgroundTurnEvent) {
      expect(handler).not.toBeNull();
      act(() => handler?.(event));
    },
  };
}

function savedHistory(): AgentHistoryCatalogGateway {
  return {
    readAgentHistoryThreads: vi.fn(async () => ({
      threads: [thread(agentRootOwnerId(ROOT_KEY))],
      hasEarlier: false,
      beforeThreadId: null,
    })),
    readAgentHistoryTurns: vi.fn(async () => ({
      revision: 7,
      turns: [promptedTurn],
      hasEarlier: false,
      beforeTurnId: null,
    })),
  };
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function render(catalog: AgentHistoryCatalogGateway, fake: AgentThreadSessionGateway) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const box: { state: AgentThreadsState } = { state: emptyAgentThreadsState() };
  box.state = agentThreadsReducer(box.state, { kind: "threadCreated", thread: thread(OWNER_ID) });
  box.state = agentThreadsReducer(box.state, { kind: "historyThreadEvicted", threadId: THREAD_ID });
  const setNotice = vi.fn();
  const reportError = vi.fn();
  const store = {
    currentState: () => box.state,
    dispatchAction: (action: Parameters<typeof agentThreadsReducer>[1]) => {
      box.state = agentThreadsReducer(box.state, action);
    },
    restoreThread: async (restored: AgentThread) => {
      box.state = agentThreadsReducer(box.state, {
        kind: "historyThreadOpened",
        thread: restored,
        evictThreadId: null,
      });
      return box.state.threads.has(restored.threadId);
    },
  };
  const projects = [project()];
  const dispatch = {
    current: { resumeSessionIdFor: () => null, mintUnreservedTurnId: () => "agt-bg-0001" },
  };

  function Harness() {
    useAgentThreadSessions({
      gateway: fake,
      projects,
      store,
      historyCatalog: catalog,
      dispatch,
      setNotice,
      reportError,
      now: () => 1_800_000_000_000,
    });
    return null;
  }

  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness)));
  cleanups.push(() => act(() => root.unmount()));
  return { box, setNotice, reportError };
}

describe("useAgentThreadSessions replies for threads evicted from memory", () => {
  it("reopens the evicted thread from saved history and records the reply into it", async () => {
    const { fake, emit } = sessionGateway();
    const catalog = savedHistory();
    const harness = render(catalog, fake);
    expect(harness.box.state.threads.has(THREAD_ID)).toBe(false);
    await waitForReact(() =>
      expect(fake.subscribeAgentSessionBackgroundTurn).toHaveBeenCalledTimes(1),
    );

    emit({
      workspaceId: OWNER_ID,
      threadId: THREAD_ID,
      output: reply("build is green"),
      truncated: false,
      complete: true,
    });

    await waitForReact(() =>
      expect(harness.box.state.threads.get(THREAD_ID)?.turns).toHaveLength(2),
    );
    const restored = harness.box.state.threads.get(THREAD_ID);
    expect(restored?.owner.ownerId).toBe(OWNER_ID);
    expect(restored?.turns[1]).toMatchObject({ turnId: "agt-bg-0001", origin: "background" });
    expect(restored?.turns[1]?.events).toContainEqual({
      kind: "assistantText",
      text: "build is green",
    });
    expect(harness.setNotice).not.toHaveBeenCalled();
    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it("never reads saved history for a workspace this window does not own", async () => {
    const { fake, emit } = sessionGateway();
    const catalog = savedHistory();
    const harness = render(catalog, fake);
    await waitForReact(() =>
      expect(fake.subscribeAgentSessionBackgroundTurn).toHaveBeenCalledTimes(1),
    );

    emit({
      workspaceId: "ws-other",
      threadId: THREAD_ID,
      output: reply("foreign"),
      truncated: false,
      complete: true,
    });
    await act(async () => Promise.resolve());

    expect(catalog.readAgentHistoryThreads).not.toHaveBeenCalled();
    expect(harness.box.state.threads.has(THREAD_ID)).toBe(false);
    expect(harness.setNotice).not.toHaveBeenCalled();
  });
});
