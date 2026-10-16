// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentLiveThreadSource,
  createAgentThreadStateStore,
  type AgentThreadStateStore,
} from "../../application/agentThreads/agentThreadStateStore";
import { AgentLiveThreadContext } from "../../application/agentThreads/useLiveAgentThread";
import {
  agentThreadAttention,
  agentThreadsReducer,
  agentThreadUnread,
  emptyAgentThreadsState,
  type AgentThread,
  type AgentTurnEvent,
} from "../../domain/agentThread";
import { AgentClockProvider } from "./agentClock";
import { AgentThreadRow } from "./AgentThreadRow";
import { AGENT_FOREGROUND_QUIESCENCE_MS } from "./useAgentBackgroundActivity";

const ROOT = "/workspace/app";
const OWNER_ID = `agent-root:${ROOT}`;
const THREAD_ID = "agt-1";
const TURN_ID = "agt-1-t1";
const NOW = 1_700_000_600_000;

const spawn: AgentTurnEvent = {
  kind: "backgroundTask",
  taskId: "agent-1",
  taskType: "agent",
  status: "starting",
};

describe("AgentThreadRow over streamed thread state", () => {
  let host: HTMLDivElement;
  let root: Root;
  let store: AgentThreadStateStore;
  let sequence = 0;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
    });
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    sequence = 0;
    store = createAgentThreadStateStore(
      agentThreadsReducer(emptyAgentThreadsState(), {
        kind: "threadCreated",
        thread: runningThread(),
      }),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const append = (...events: AgentTurnEvent[]): void => {
    sequence += 1;
    act(() => {
      store.stage(
        agentThreadsReducer(store.current(), {
          kind: "turnEventsAppended",
          threadId: THREAD_ID,
          turnId: TURN_ID,
          workspaceId: OWNER_ID,
          repositoryRoot: ROOT,
          isolation: "in-place",
          worktreePath: null,
          outputSequence: sequence,
          events,
          sessionId: null,
          supervisorTruncated: false,
        }),
      );
      store.notify();
    });
  };

  const renderShownRow = (): AgentThread => {
    const shown = store.structural().threads.get(THREAD_ID)!;
    act(() => {
      root.render(
        <AgentLiveThreadContext.Provider value={agentLiveThreadSource(store)}>
          <AgentClockProvider>
            <ul role="listbox">
              <AgentThreadRow
                focused={false}
                jumpLabel={null}
                on={false}
                onMenuCommand={() => undefined}
                onSelect={() => undefined}
                pending={null}
                projectLabel="app"
                selected={false}
                view={viewOf(shown)}
              />
            </ul>
          </AgentClockProvider>
        </AgentLiveThreadContext.Provider>,
      );
    });
    return shown;
  };

  const statusLabel = (): string | null | undefined =>
    host.querySelector(".cv-card-row__status-label")?.textContent;

  it("settles into background waiting after quiet text that follows a root tool call", () => {
    append(spawn, { kind: "toolCall", toolId: "tool-1", name: "Bash", inputSummary: "ls" });
    append({ kind: "toolResult", toolId: "tool-1", isError: false, outputSummary: "ok" });
    const shown = renderShownRow();
    append({ kind: "assistantText", text: "The reviewer keeps running in the background." });

    expect(store.structural().threads.get(THREAD_ID)).toBe(shown);
    expect(statusLabel()).toBe("Working");
    act(() => vi.advanceTimersByTime(AGENT_FOREGROUND_QUIESCENCE_MS));
    expect(statusLabel()).toBe("1 agent running");
  });

  it("stays working while quiet text keeps streaming after a progress event", () => {
    append(spawn, { kind: "assistantText", text: "Starting a long reply." });
    const shown = renderShownRow();

    for (let chunk = 0; chunk < 4; chunk += 1) {
      act(() => vi.advanceTimersByTime(AGENT_FOREGROUND_QUIESCENCE_MS - 1_000));
      append({ kind: "assistantText", text: ` more ${chunk}` });
      expect(statusLabel()).toBe("Working");
    }
    expect(store.structural().threads.get(THREAD_ID)).toBe(shown);
    act(() => vi.advanceTimersByTime(AGENT_FOREGROUND_QUIESCENCE_MS));
    expect(statusLabel()).toBe("1 agent running");
  });
});

function runningThread(): AgentThread {
  return {
    threadId: THREAD_ID,
    owner: { rootKey: ROOT, ownerId: OWNER_ID, repositoryRoot: ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Review the invoice totals",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 60_000,
    updatedAtEpochMs: NOW - 60_000,
    turns: [
      {
        turnId: TURN_ID,
        prompt: "Review the invoice totals",
        status: { kind: "running" },
        startedAtEpochMs: NOW - 60_000,
        endedAtEpochMs: null,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 1,
        lastOutputSequence: 0,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    viewedAtEpochMs: NOW - 60_000,
    externalOrigin: null,
    integration: null,
  };
}

function viewOf(thread: AgentThread): AgentThreadView {
  return {
    thread,
    lifecycle: "running",
    projectOrigin: "active-tab",
    repositoryLabel: "app",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
    ship: { kind: "idle", status: null, loadingStatus: false },
    fileNavigationAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
  };
}
