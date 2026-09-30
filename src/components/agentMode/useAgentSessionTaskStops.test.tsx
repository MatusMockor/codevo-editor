// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSessionTaskStopResult,
  AgentTasksNotice,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import type { AgentSessionBackground } from "../../domain/agentSessionBackground";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  AGENT_SESSION_TASK_STOP_TIMEOUT_MS,
  agentSessionEndSuggested,
  agentSessionPendingTaskIds,
  useAgentSessionTaskStops,
  type AgentSessionTaskStops,
  type AgentSessionTaskStopSurface,
} from "./useAgentSessionTaskStops";

const THREAD_ID = "agt-1";
const OWNER_ID = "agent-root:app";

const watch: AgentSessionBackground = {
  ownerId: OWNER_ID,
  total: 1,
  agents: 0,
  tasks: [
    { taskId: "b8kzpiexm", taskType: "shell", description: "Watch beta.75 release workflow" },
  ],
  sinceEpochMs: 1,
};

function view(sessionBackground: AgentSessionBackground | undefined, ownerId = OWNER_ID) {
  const base = surfaceThreadView();
  return surfaceThreadView({
    ...(sessionBackground === undefined ? {} : { sessionBackground }),
    thread: { ...base.thread, owner: { ...base.thread.owner, ownerId } },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
});

function render(initial: ReadonlyArray<AgentThreadView>) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const stop = vi.fn<NonNullable<AgentSessionTaskStopSurface["stopSessionBackgroundTask"]>>(
    async () => ({ kind: "stopping" }),
  );
  const notices: Array<AgentTasksNotice> = [];
  const reportNotice = vi.fn((notice: AgentTasksNotice) => {
    notices.push(notice);
  });
  let threads = initial;
  let latest: AgentSessionTaskStops | null = null;

  function Harness() {
    latest = useAgentSessionTaskStops({ threads, stopSessionBackgroundTask: stop }, reportNotice);
    return null;
  }

  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  cleanups.push(() => act(() => root.unmount()));
  return {
    stop,
    notices,
    reportNotice,
    setThreads(next: ReadonlyArray<AgentThreadView>) {
      threads = next;
      act(() => root.render(createElement(Harness)));
    },
    hook(): AgentSessionTaskStops {
      expect(latest).not.toBeNull();
      return latest as unknown as AgentSessionTaskStops;
    },
    pendingFor(target: AgentThreadView): ReadonlyArray<string> {
      return [...agentSessionPendingTaskIds(this.hook().pending, target)];
    },
    suggestsEndSession(target: AgentThreadView): boolean {
      return agentSessionEndSuggested(this.hook().endSessionSuggestion, target);
    },
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useAgentSessionTaskStops", () => {
  it("stops the live task left behind by an interrupted turn and clears once the level no longer lists it", async () => {
    const live = view(watch);
    const harness = render([live]);

    act(() => harness.hook().stopTask(THREAD_ID, "b8kzpiexm"));
    await settle();

    expect(harness.stop).toHaveBeenCalledTimes(1);
    expect(harness.stop).toHaveBeenCalledWith(THREAD_ID, "b8kzpiexm");
    expect(harness.pendingFor(live)).toEqual(["b8kzpiexm"]);

    act(() => harness.hook().stopTask(THREAD_ID, "b8kzpiexm"));
    expect(harness.stop).toHaveBeenCalledTimes(1);

    const cleared = view(undefined);
    harness.setThreads([cleared]);
    expect(harness.pendingFor(cleared)).toEqual([]);
    expect(harness.notices).toEqual([]);
  });

  it("clears the pending stop when the session ends", async () => {
    const harness = render([view(watch)]);
    act(() => harness.hook().stopTask(THREAD_ID, "b8kzpiexm"));
    await settle();
    harness.setThreads([view(undefined)]);
    harness.setThreads([view(watch)]);
    expect(harness.pendingFor(view(watch))).toEqual([]);
  });

  it("names Claude's refusal, clears the pending state and offers End session", async () => {
    const harness = render([view(watch)]);
    harness.stop.mockResolvedValueOnce({
      kind: "refused",
      reason: "No task found with ID: b8kzpiexm",
    });

    act(() => harness.hook().stopTask(THREAD_ID, "b8kzpiexm"));
    await settle();

    expect(harness.pendingFor(view(watch))).toEqual([]);
    expect(harness.notices).toEqual([
      {
        kind: "error",
        message:
          'Claude could not stop "Watch beta.75 release workflow": No task found with ID: b8kzpiexm. You can end Claude\'s session instead.',
        action: null,
      },
    ]);
    expect(harness.suggestsEndSession(view(watch))).toBe(true);
    const foreign = view({ ...watch, ownerId: "agent-root:other" }, "agent-root:other");
    harness.setThreads([foreign]);
    expect(harness.suggestsEndSession(foreign)).toBe(false);
  });

  it.each<[AgentSessionTaskStopResult, AgentTasksNotice, boolean]>([
    [
      { kind: "unconfirmed" },
      {
        kind: "warning",
        message:
          'Claude did not confirm that it is stopping "Watch beta.75 release workflow". It may still be running. You can end Claude\'s session instead.',
        action: null,
      },
      true,
    ],
    [
      { kind: "notLive" },
      {
        kind: "info",
        message: '"Watch beta.75 release workflow" had already finished.',
        action: null,
      },
      false,
    ],
    [
      { kind: "noSession" },
      {
        kind: "info",
        message:
          'Claude\'s session for this thread is no longer running, so Codevo could not ask it to stop "Watch beta.75 release workflow".',
        action: null,
      },
      false,
    ],
    [
      { kind: "unavailable" },
      {
        kind: "error",
        message:
          'Codevo could not send the stop request for "Watch beta.75 release workflow" to Claude. You can end Claude\'s session instead.',
        action: null,
      },
      true,
    ],
  ])(
    "reports the %j outcome truthfully and clears the pending state",
    async (outcome, notice, suggested) => {
      const harness = render([view(watch)]);
      harness.stop.mockResolvedValueOnce(outcome);

      act(() => harness.hook().stopTask(THREAD_ID, "b8kzpiexm"));
      await settle();

      expect(harness.pendingFor(view(watch))).toEqual([]);
      expect(harness.notices).toEqual([notice]);
      expect(harness.suggestsEndSession(view(watch))).toBe(suggested);
    },
  );

  it("drops a late outcome and the pending state once the thread moved to another owner", async () => {
    const harness = render([view(watch)]);
    const pending = deferred<AgentSessionTaskStopResult>();
    harness.stop.mockImplementationOnce(() => pending.promise);

    act(() => harness.hook().stopTask(THREAD_ID, "b8kzpiexm"));
    expect(harness.pendingFor(view(watch))).toEqual(["b8kzpiexm"]);

    const foreign = view({ ...watch, ownerId: "agent-root:other" }, "agent-root:other");
    harness.setThreads([foreign]);
    expect(harness.pendingFor(foreign)).toEqual([]);
    await act(async () => {
      pending.resolve({ kind: "refused", reason: "No task found with ID: b8kzpiexm" });
      await pending.promise;
    });

    harness.setThreads([view(watch)]);
    expect(harness.pendingFor(view(watch))).toEqual([]);
    expect(harness.notices).toEqual([]);
  });

  it("gives up waiting after a bounded time and says Claude has not reported the task stopped", async () => {
    vi.useFakeTimers();
    const harness = render([view(watch)]);

    act(() => harness.hook().stopTask(THREAD_ID, "b8kzpiexm"));
    await settle();
    act(() => vi.advanceTimersByTime(AGENT_SESSION_TASK_STOP_TIMEOUT_MS - 1));
    expect(harness.pendingFor(view(watch))).toEqual(["b8kzpiexm"]);
    expect(harness.notices).toEqual([]);

    act(() => vi.advanceTimersByTime(1));
    expect(AGENT_SESSION_TASK_STOP_TIMEOUT_MS).toBe(15_000);
    expect(harness.pendingFor(view(watch))).toEqual([]);
    expect(harness.notices).toEqual([
      {
        kind: "warning",
        message:
          'Claude has not reported that "Watch beta.75 release workflow" stopped. It may still be running. You can end Claude\'s session instead.',
        action: null,
      },
    ]);
    expect(harness.suggestsEndSession(view(watch))).toBe(true);
  });

  it("stays quiet at the deadline when the task already left the level", async () => {
    vi.useFakeTimers();
    const harness = render([view(watch)]);
    act(() => harness.hook().stopTask(THREAD_ID, "b8kzpiexm"));
    await settle();
    harness.setThreads([view(undefined)]);
    act(() => vi.advanceTimersByTime(AGENT_SESSION_TASK_STOP_TIMEOUT_MS));
    expect(harness.notices).toEqual([]);
  });

  it("stops every listed task of the thread at once and ignores tasks that are not live", async () => {
    const two: AgentSessionBackground = {
      ...watch,
      total: 2,
      tasks: [...watch.tasks, { taskId: "c9", taskType: "monitor", description: "Tail logs" }],
    };
    const harness = render([view(two)]);

    act(() => harness.hook().stopTask(THREAD_ID, "unknown"));
    act(() => harness.hook().stopAllTasks(THREAD_ID));
    await settle();

    expect(harness.stop.mock.calls).toEqual([
      [THREAD_ID, "b8kzpiexm"],
      [THREAD_ID, "c9"],
    ]);
    expect(harness.pendingFor(view(two))).toEqual(["b8kzpiexm", "c9"]);
  });
});
