// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentThreadsReducer,
  emptyAgentThreadsState,
  type AgentThread,
  type AgentThreadsState,
} from "../../domain/agentThread";
import {
  agentLiveThreadSource,
  createAgentThreadStateStore,
  type AgentThreadStateStore,
} from "./agentThreadStateStore";
import {
  AgentLiveThreadContext,
  useLiveAgentThread,
  useLiveAgentThreads,
} from "./useLiveAgentThread";

const ROOT = "/workspace-a";

function thread(): AgentThread {
  return {
    threadId: "thread-a",
    owner: { rootKey: ROOT, ownerId: "workspace-a", repositoryRoot: ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "codex", sessionId: null },
    title: "A",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1,
    updatedAtEpochMs: 1,
    turns: [
      {
        turnId: "turn-a",
        prompt: "go",
        status: { kind: "running" },
        startedAtEpochMs: 1,
        endedAtEpochMs: null,
        events: [{ kind: "assistantText", text: "a" }],
        eventsTruncated: false,
        foregroundSettled: false,
        queueBoundarySequence: 0,
        lastStatusSequence: 1,
        lastOutputSequence: 1,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: 1,
    externalOrigin: null,
  };
}

function streamText(store: AgentThreadStateStore, sequence: number): void {
  const next: AgentThreadsState = agentThreadsReducer(store.current(), {
    kind: "turnEventsAppended",
    threadId: "thread-a",
    turnId: "turn-a",
    workspaceId: "workspace-a",
    repositoryRoot: ROOT,
    isolation: "in-place",
    worktreePath: null,
    outputSequence: sequence,
    events: [{ kind: "assistantText", text: `+${sequence}` }],
    sessionId: null,
    supervisorTruncated: false,
  });
  store.stage(next);
  store.notify();
}

const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function render(element: Parameters<ReturnType<typeof createRoot>["render"]>[0]) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  act(() => root.render(element));
  return () => act(() => root.unmount());
}

describe("live agent thread hooks", () => {
  it("re-renders a live reader per streamed frame and leaves a disabled reader alone", () => {
    const store = createAgentThreadStateStore(
      agentThreadsReducer(emptyAgentThreadsState(), { kind: "threadCreated", thread: thread() }),
    );
    const shown = store.structural().threads.get("thread-a")!;
    const seen: string[] = [];
    let disabledRenders = 0;
    function Live() {
      const live = useLiveAgentThread(shown);
      const event = live?.turns[0]?.events[0];
      seen.push(event?.kind === "assistantText" ? event.text : "");
      return null;
    }
    function Disabled() {
      disabledRenders += 1;
      useLiveAgentThreads([shown], false);
      return null;
    }
    const unmount = render(
      createElement(
        AgentLiveThreadContext.Provider,
        { value: agentLiveThreadSource(store) },
        createElement(Live),
        createElement(Disabled),
      ),
    );

    act(() => streamText(store, 2));
    act(() => streamText(store, 3));

    expect(seen).toEqual(["a", "a+2", "a+2+3"]);
    expect(disabledRenders).toBe(1);
    expect(store.structural().threads.get("thread-a")).toBe(shown);
    unmount();
  });

  it("falls back to the shown thread without a live source", () => {
    const shown = thread();
    let read: AgentThread | null = null;
    function Reader() {
      read = useLiveAgentThread(shown);
      return null;
    }
    const unmount = render(createElement(Reader));
    expect(read).toBe(shown);
    unmount();
  });
});
