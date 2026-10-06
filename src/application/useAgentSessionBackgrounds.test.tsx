// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_SESSION_FOLLOW_UP_GRACE_MS,
  type AgentSessionBackgrounds,
} from "../domain/agentSessionBackground";
import type {
  AgentSessionBackgroundTasksEvent,
  AgentSessionEndedEvent,
  AgentThreadSessionGateway,
} from "../domain/agentThreadSession";
import { waitForReact } from "../test/reactTestLifecycle";
import { useAgentSessionBackgrounds } from "./useAgentSessionBackgrounds";

const THREAD = "agt-mue1wenj-7ede";
const RESUMED: AgentSessionBackgroundTasksEvent = {
  workspaceId: "ws-1",
  threadId: THREAD,
  total: 1,
  agents: 1,
  tasks: [
    {
      taskId: "a4b355dcf6056a875",
      taskType: "agent",
      description: "Live Codex model catalog like Claude",
    },
  ],
  reply: "none",
};
const REPLYING: AgentSessionBackgroundTasksEvent = {
  ...RESUMED,
  total: 0,
  agents: 0,
  tasks: [],
  reply: "inProgress",
};
const DRAINED: AgentSessionBackgroundTasksEvent = { ...REPLYING, reply: "none" };

function gateway() {
  let levels: ((event: AgentSessionBackgroundTasksEvent) => void) | null = null;
  let ended: ((event: AgentSessionEndedEvent) => void) | null = null;
  const unsubscribeLevels = vi.fn();
  const unsubscribeEnded = vi.fn();
  const fake = {
    interruptAgentTask: vi.fn(async () => ({ kind: "unsupported" }) as const),
    inspectAgentThreadSession: vi.fn(async () => ({ kind: "none" }) as const),
    endAgentThreadSession: vi.fn(async () => false),
    stopAgentBackgroundTask: vi.fn(async () => ({ kind: "noSession" }) as const),
    subscribeAgentSessionEnded: vi.fn(async (handler: (event: AgentSessionEndedEvent) => void) => {
      ended = handler;
      return unsubscribeEnded;
    }),
    subscribeAgentSessionBackgroundTurn: vi.fn(async () => () => undefined),
    subscribeAgentSessionBackgroundTasks: vi.fn(
      async (handler: (event: AgentSessionBackgroundTasksEvent) => void) => {
        levels = handler;
        return unsubscribeLevels;
      },
    ),
  } satisfies AgentThreadSessionGateway;
  return {
    fake,
    unsubscribeLevels,
    unsubscribeEnded,
    level: (event: AgentSessionBackgroundTasksEvent) => {
      expect(levels).not.toBeNull();
      act(() => levels?.(event));
    },
    end: (event: AgentSessionEndedEvent) => {
      expect(ended).not.toBeNull();
      act(() => ended?.(event));
    },
  };
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
});

function render(fake: AgentThreadSessionGateway, now: () => number) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const reportFailure = vi.fn();
  const observed: { current: AgentSessionBackgrounds | null } = { current: null };
  function Harness() {
    observed.current = useAgentSessionBackgrounds(fake, now, reportFailure);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness)));
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
  };
  cleanups.push(unmount);
  return { observed, unmount, reportFailure };
}

describe("useAgentSessionBackgrounds", () => {
  it("keeps a thread's live background level until its session ends or its drain is no longer awaited", async () => {
    const { fake, level, end } = gateway();
    let now = 1_790_718_781_369;
    const harness = render(fake, () => now);
    await waitForReact(() => {
      expect(fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1);
      expect(fake.subscribeAgentSessionEnded).toHaveBeenCalledTimes(1);
    });
    expect(fake.subscribeAgentSessionBackgroundTurn).not.toHaveBeenCalled();
    level(RESUMED);
    expect(harness.observed.current?.get(THREAD)).toEqual({
      ownerId: "ws-1",
      total: 1,
      agents: 1,
      tasks: RESUMED.tasks,
      sinceEpochMs: 1_790_718_781_369,
      taskSinceEpochMs: new Map([["a4b355dcf6056a875", 1_790_718_781_369]]),
      reply: { kind: "none" },
    });
    end({ workspaceId: "ws-1", threadId: THREAD, reason: "stopped", backgroundTasksLive: true });
    expect(harness.observed.current?.has(THREAD)).toBe(false);
    now = 1_790_718_900_000;
    level(RESUMED);
    expect(harness.observed.current?.get(THREAD)?.sinceEpochMs).toBe(1_790_718_900_000);
    level({ ...RESUMED, agents: 0, tasks: [{ taskId: "b1", taskType: "shell" }] });
    end({ workspaceId: "ws-1", threadId: THREAD, reason: "crashed", backgroundTasksLive: true });
    expect(harness.observed.current?.has(THREAD)).toBe(false);
    level({ ...RESUMED, agents: 0, tasks: [{ taskId: "b1", taskType: "shell" }] });
    level(DRAINED);
    expect(harness.observed.current?.has(THREAD)).toBe(false);
    expect(harness.reportFailure).not.toHaveBeenCalled();
  });

  it("keeps a drained agent's thread live for the grace period and then lets it go on one timer", async () => {
    const { fake, level } = gateway();
    let now = 1_790_718_781_369;
    const harness = render(fake, () => now);
    await waitForReact(() =>
      expect(fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1),
    );
    vi.useFakeTimers();
    const advance = (ms: number) =>
      act(() => {
        now += ms;
        vi.advanceTimersByTime(ms);
      });
    level(RESUMED);
    expect(vi.getTimerCount()).toBe(0);
    advance(1_000);
    level(DRAINED);
    const expected = {
      kind: "expected",
      sinceEpochMs: 1_790_718_782_369,
      untilEpochMs: 1_790_718_782_369 + AGENT_SESSION_FOLLOW_UP_GRACE_MS,
    };
    expect(harness.observed.current?.get(THREAD)).toMatchObject({ total: 0, reply: expected });
    expect(vi.getTimerCount()).toBe(1);
    advance(2_000);
    level(DRAINED);
    expect(harness.observed.current?.get(THREAD)?.reply).toEqual(expected);
    expect(vi.getTimerCount()).toBe(1);
    advance(AGENT_SESSION_FOLLOW_UP_GRACE_MS - 2_001);
    expect(harness.observed.current?.get(THREAD)?.reply).toEqual(expected);
    advance(1);
    expect(harness.observed.current?.has(THREAD)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.reportFailure).not.toHaveBeenCalled();
  });

  it("lets the grace period lapse on its timer even when the clock has not moved", async () => {
    const { fake, level } = gateway();
    const harness = render(fake, () => 1_790_718_781_369);
    await waitForReact(() =>
      expect(fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1),
    );
    vi.useFakeTimers();
    level(RESUMED);
    level(DRAINED);
    expect(harness.observed.current?.get(THREAD)?.reply.kind).toBe("expected");
    act(() => {
      vi.advanceTimersByTime(AGENT_SESSION_FOLLOW_UP_GRACE_MS);
    });
    expect(harness.observed.current?.has(THREAD)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the grace timer when the reply starts and keeps the thread live until the level closes it", async () => {
    const { fake, level } = gateway();
    let now = 1_790_718_781_369;
    const harness = render(fake, () => now);
    await waitForReact(() =>
      expect(fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1),
    );
    vi.useFakeTimers();
    const advance = (ms: number) =>
      act(() => {
        now += ms;
        vi.advanceTimersByTime(ms);
      });
    level(RESUMED);
    level(DRAINED);
    expect(vi.getTimerCount()).toBe(1);
    advance(3_000);
    level(REPLYING);
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.observed.current?.get(THREAD)?.reply).toEqual({
      kind: "inProgress",
      sinceEpochMs: 1_790_718_781_369,
    });
    advance(10 * AGENT_SESSION_FOLLOW_UP_GRACE_MS);
    expect(harness.observed.current?.get(THREAD)?.reply.kind).toBe("inProgress");
    level(REPLYING);
    expect(harness.observed.current?.get(THREAD)?.reply.kind).toBe("inProgress");
    level(DRAINED);
    expect(harness.observed.current?.has(THREAD)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-arms one timer for the nearest deadline across threads and drops it when agents return", async () => {
    const { fake, level } = gateway();
    let now = 1_790_718_781_369;
    const harness = render(fake, () => now);
    await waitForReact(() =>
      expect(fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1),
    );
    vi.useFakeTimers();
    const advance = (ms: number) =>
      act(() => {
        now += ms;
        vi.advanceTimersByTime(ms);
      });
    const other = "agt-other-0001";
    level(RESUMED);
    level({ ...RESUMED, threadId: other });
    level(DRAINED);
    advance(2_000);
    level({ ...DRAINED, threadId: other });
    expect(vi.getTimerCount()).toBe(1);
    advance(AGENT_SESSION_FOLLOW_UP_GRACE_MS - 2_000);
    expect(harness.observed.current?.has(THREAD)).toBe(false);
    expect(harness.observed.current?.get(other)?.reply.kind).toBe("expected");
    expect(vi.getTimerCount()).toBe(1);
    level({ ...RESUMED, threadId: other });
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.observed.current?.get(other)?.reply).toEqual({ kind: "none" });
    advance(10 * AGENT_SESSION_FOLLOW_UP_GRACE_MS);
    expect(harness.observed.current?.get(other)?.agents).toBe(1);
  });

  it("unsubscribes both channels and clears the grace timer on unmount", async () => {
    const { fake, level, unsubscribeLevels, unsubscribeEnded } = gateway();
    const harness = render(fake, () => 1);
    await waitForReact(() => {
      expect(fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1);
      expect(fake.subscribeAgentSessionEnded).toHaveBeenCalledTimes(1);
    });
    vi.useFakeTimers();
    level(RESUMED);
    level(DRAINED);
    expect(vi.getTimerCount()).toBe(1);
    const beforeUnmount = harness.observed.current;
    harness.unmount();
    expect(unsubscribeLevels).toHaveBeenCalledTimes(1);
    expect(unsubscribeEnded).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    level(REPLYING);
    act(() => {
      vi.advanceTimersByTime(10 * AGENT_SESSION_FOLLOW_UP_GRACE_MS);
    });
    expect(harness.observed.current).toBe(beforeUnmount);
  });
});
