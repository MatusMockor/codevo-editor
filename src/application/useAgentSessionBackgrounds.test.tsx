// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
  agentSessionBackgroundOf,
} from "../domain/agentSessionBackground";
import type { AgentThread } from "../domain/agentThread";
import type {
  AgentSessionBackgroundTasksEvent,
  AgentSessionEndedEvent,
  AgentThreadSessionGateway,
} from "../domain/agentThreadSession";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  AGENT_SESSION_BACKGROUND_RECOVERY_TIMEOUT_MS,
  MAX_AGENT_SESSION_EVENTS_DURING_RECOVERY,
  useAgentSessionBackgrounds,
  type AgentSessionBackgroundsState,
} from "./useAgentSessionBackgrounds";

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
const EXPECTING: AgentSessionBackgroundTasksEvent = { ...REPLYING, reply: "expected" };
const REPLYING_ELSEWHERE: AgentSessionBackgroundTasksEvent = {
  ...REPLYING,
  threadId: "agt-other-0001",
};
const SHELL_ONLY: AgentSessionBackgroundTasksEvent = {
  ...RESUMED,
  agents: 0,
  tasks: [{ taskId: "b1", taskType: "shell" }],
};
const MONITORING: AgentSessionBackgroundTasksEvent = {
  ...SHELL_ONLY,
  tasks: [{ taskId: "bwatch01", taskType: "monitor" }],
};
const SETTLED_THREAD: AgentThread = {
  threadId: THREAD,
  owner: { rootKey: "/repo", ownerId: "ws-1", repositoryRoot: "/repo" },
  target: { isolation: "in-place", worktreePath: null },
  provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
  title: "Watch the build",
  pinned: false,
  archived: false,
  createdAtEpochMs: 1_790_716_525_713,
  updatedAtEpochMs: 1_790_716_525_713,
  turns: [],
  turnsTruncated: false,
  viewedAtEpochMs: null,
  externalOrigin: null,
  integration: null,
};

function gateway() {
  let levels: ((event: AgentSessionBackgroundTasksEvent) => void) | null = null;
  let ended: ((event: AgentSessionEndedEvent) => void) | null = null;
  const unsubscribeLevels = vi.fn();
  const unsubscribeEnded = vi.fn();
  const fake = {
    listAgentSessionBackgrounds: vi.fn<AgentThreadSessionGateway["listAgentSessionBackgrounds"]>(
      async () => [],
    ),
    interruptAgentTask: vi.fn(async () => ({ kind: "unsupported" }) as const),
    inspectAgentThreadSession: vi.fn(async () => ({ kind: "none" }) as const),
    endAgentThreadSession: vi.fn(async () => false),
    stopAgentBackgroundTask: vi.fn(async () => ({ kind: "noSession" }) as const),
    subscribeAgentSessionEnded: vi.fn<AgentThreadSessionGateway["subscribeAgentSessionEnded"]>(
      async (handler) => {
        ended = handler;
        return unsubscribeEnded;
      },
    ),
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

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Value>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function render(fake: AgentThreadSessionGateway | undefined, now: () => number) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const reportFailure = vi.fn();
  const observed: { current: AgentSessionBackgroundsState | null } = { current: null };
  function Harness({
    gateway: current,
  }: {
    readonly gateway: AgentThreadSessionGateway | undefined;
  }) {
    observed.current = useAgentSessionBackgrounds(current, now, reportFailure);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness, { gateway: fake })));
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
  };
  cleanups.push(unmount);
  const entry = (threadId = THREAD, ownerId = "ws-1") =>
    observed.current === null
      ? undefined
      : agentSessionBackgroundOf(observed.current.backgrounds, ownerId, threadId);
  const watch = (workspaceId: string, threadId = THREAD) => {
    const reportMissing = observed.current?.watchSession({ workspaceId, threadId });
    expect(reportMissing).toBeDefined();
    return () => act(() => reportMissing?.());
  };
  const forget = (workspaceId: string, threadId = THREAD) => watch(workspaceId, threadId)();
  const recovered = () => observed.current?.recovered;
  const retains = (ownerId = "ws-1") =>
    observed.current?.ownerHasLiveSession([SETTLED_THREAD], ownerId);
  const rerender = (next: AgentThreadSessionGateway | undefined) =>
    act(() => root.render(createElement(Harness, { gateway: next })));
  return { observed, entry, watch, forget, recovered, retains, rerender, unmount, reportFailure };
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
    expect(harness.entry(THREAD)).toEqual({
      ownerId: "ws-1",
      total: 1,
      agents: 1,
      tasks: RESUMED.tasks,
      sinceEpochMs: 1_790_718_781_369,
      taskSinceEpochMs: new Map([["a4b355dcf6056a875", 1_790_718_781_369]]),
      reply: { kind: "none" },
    });
    end({ workspaceId: "ws-1", threadId: THREAD, reason: "stopped", backgroundTasksLive: true });
    expect(harness.entry(THREAD)).toBeUndefined();
    now = 1_790_718_900_000;
    level(RESUMED);
    expect(harness.entry(THREAD)?.sinceEpochMs).toBe(1_790_718_900_000);
    level({ ...RESUMED, agents: 0, tasks: [{ taskId: "b1", taskType: "shell" }] });
    end({ workspaceId: "ws-1", threadId: THREAD, reason: "crashed", backgroundTasksLive: true });
    expect(harness.entry(THREAD)).toBeUndefined();
    level(SHELL_ONLY);
    level(DRAINED);
    expect(harness.entry(THREAD)).toBeUndefined();
    expect(harness.reportFailure).not.toHaveBeenCalled();
  });

  it("keeps a thread whose shell finished live while its reply is expected and lets it go at the cap on one timer", async () => {
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
    level(SHELL_ONLY);
    expect(vi.getTimerCount()).toBe(0);
    advance(4 * 60_000);
    expect(harness.entry(THREAD)?.reply).toEqual({ kind: "none" });
    level(EXPECTING);
    const expected = {
      kind: "expected",
      sinceEpochMs: now,
      untilEpochMs: now + AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
    };
    expect(harness.entry(THREAD)).toMatchObject({ total: 0, reply: expected });
    expect(vi.getTimerCount()).toBe(1);
    advance(AGENT_SESSION_REPLY_EXPECTED_CAP_MS - 1);
    expect(harness.entry(THREAD)?.reply).toEqual(expected);
    advance(1);
    expect(harness.entry(THREAD)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.reportFailure).not.toHaveBeenCalled();
  });

  it("cancels the cap timer of a finished shell when its reply starts", async () => {
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
    level(SHELL_ONLY);
    level(EXPECTING);
    const drainedAt = now;
    advance(1_200);
    level(REPLYING);
    expect(vi.getTimerCount()).toBe(0);
    advance(10 * AGENT_SESSION_REPLY_EXPECTED_CAP_MS);
    expect(harness.entry(THREAD)?.reply).toEqual({
      kind: "inProgress",
      sinceEpochMs: drainedAt,
    });
    level(DRAINED);
    expect(harness.entry(THREAD)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a thread whose agent finished live while its reply is expected and lets it go at the cap on one timer", async () => {
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
    level(EXPECTING);
    const expected = {
      kind: "expected",
      sinceEpochMs: 1_790_718_782_369,
      untilEpochMs: 1_790_718_782_369 + AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
    };
    expect(harness.entry(THREAD)).toMatchObject({ total: 0, reply: expected });
    expect(vi.getTimerCount()).toBe(1);
    advance(2_000);
    level(EXPECTING);
    expect(harness.entry(THREAD)?.reply).toEqual(expected);
    expect(vi.getTimerCount()).toBe(1);
    advance(AGENT_SESSION_REPLY_EXPECTED_CAP_MS - 2_001);
    expect(harness.entry(THREAD)?.reply).toEqual(expected);
    advance(1);
    expect(harness.entry(THREAD)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.reportFailure).not.toHaveBeenCalled();
  });

  it("lets the expectation lapse on its timer even when the clock has not moved", async () => {
    const { fake, level } = gateway();
    const harness = render(fake, () => 1_790_718_781_369);
    await waitForReact(() =>
      expect(fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1),
    );
    vi.useFakeTimers();
    level(RESUMED);
    level(EXPECTING);
    expect(harness.entry(THREAD)?.reply.kind).toBe("expected");
    act(() => {
      vi.advanceTimersByTime(AGENT_SESSION_REPLY_EXPECTED_CAP_MS);
    });
    expect(harness.entry(THREAD)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the cap timer when the reply starts and keeps the thread live until the level closes it", async () => {
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
    level(EXPECTING);
    expect(vi.getTimerCount()).toBe(1);
    advance(3_000);
    level(REPLYING);
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.entry(THREAD)?.reply).toEqual({
      kind: "inProgress",
      sinceEpochMs: 1_790_718_781_369,
    });
    advance(10 * AGENT_SESSION_REPLY_EXPECTED_CAP_MS);
    expect(harness.entry(THREAD)?.reply.kind).toBe("inProgress");
    level(REPLYING);
    expect(harness.entry(THREAD)?.reply.kind).toBe("inProgress");
    level(DRAINED);
    expect(harness.entry(THREAD)).toBeUndefined();
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
    level(EXPECTING);
    advance(2_000);
    level({ ...EXPECTING, threadId: other });
    expect(vi.getTimerCount()).toBe(1);
    advance(AGENT_SESSION_REPLY_EXPECTED_CAP_MS - 2_000);
    expect(harness.entry(THREAD)).toBeUndefined();
    expect(harness.entry(other)?.reply.kind).toBe("expected");
    expect(vi.getTimerCount()).toBe(1);
    level({ ...RESUMED, threadId: other });
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.entry(other)?.reply).toEqual({ kind: "none" });
    advance(10 * AGENT_SESSION_REPLY_EXPECTED_CAP_MS);
    expect(harness.entry(other)?.agents).toBe(1);
  });

  it("keeps an owner's level when another owner reports, drains or ends the same thread", async () => {
    const { fake, level, end } = gateway();
    let now = 1_790_718_781_369;
    const harness = render(fake, () => now);
    await waitForReact(() => {
      expect(fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1);
      expect(fake.subscribeAgentSessionEnded).toHaveBeenCalledTimes(1);
    });
    level(SHELL_ONLY);
    const own = harness.entry();
    now += 60_000;
    level({ ...RESUMED, workspaceId: "ws-2" });
    expect(harness.entry()).toBe(own);
    expect(harness.entry(THREAD, "ws-2")).toMatchObject({
      ownerId: "ws-2",
      agents: 1,
      sinceEpochMs: now,
    });
    level({ ...EXPECTING, workspaceId: "ws-2" });
    expect(harness.entry()).toBe(own);
    expect(harness.entry(THREAD, "ws-2")?.reply.kind).toBe("expected");
    end({ workspaceId: "ws-2", threadId: THREAD, reason: "stopped", backgroundTasksLive: false });
    expect(harness.entry(THREAD, "ws-2")).toBeUndefined();
    expect(harness.entry()).toBe(own);
    level({ ...SHELL_ONLY, workspaceId: "ws-2" });
    end({ workspaceId: "ws-1", threadId: THREAD, reason: "stopped", backgroundTasksLive: true });
    expect(harness.entry()).toBeUndefined();
    expect(harness.entry(THREAD, "ws-2")).toMatchObject({ ownerId: "ws-2", total: 1 });
    expect(harness.reportFailure).not.toHaveBeenCalled();
  });

  it("forgets exactly the session reported missing and its cap timer, never another owner or thread", async () => {
    const { fake, level } = gateway();
    const harness = render(fake, () => 1_790_718_781_369);
    await waitForReact(() =>
      expect(fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1),
    );
    vi.useFakeTimers();
    level(SHELL_ONLY);
    level({ ...SHELL_ONLY, workspaceId: "ws-2" });
    const own = harness.entry();
    const foreign = harness.entry(THREAD, "ws-2");

    harness.forget("ws-3");
    harness.forget("ws-1", "agt-other-0001");
    expect(harness.entry()).toBe(own);
    expect(harness.entry(THREAD, "ws-2")).toBe(foreign);

    harness.forget("ws-1");
    expect(harness.entry()).toBeUndefined();
    expect(harness.entry(THREAD, "ws-2")).toBe(foreign);

    level({ ...EXPECTING, workspaceId: "ws-2" });
    expect(vi.getTimerCount()).toBe(1);
    harness.forget("ws-2");
    expect(harness.entry(THREAD, "ws-2")).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.reportFailure).not.toHaveBeenCalled();
  });

  it("keeps a level that arrived after the session was asked about, however late the missing answer is", async () => {
    const { fake, level, end } = gateway();
    const harness = render(fake, () => 1_790_718_781_369);
    await waitForReact(() => {
      expect(fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1);
      expect(fake.subscribeAgentSessionEnded).toHaveBeenCalledTimes(1);
    });
    level(SHELL_ONLY);

    const repeated = harness.watch("ws-1");
    level(SHELL_ONLY);
    repeated();
    expect(harness.entry()).toMatchObject({ total: 1, tasks: SHELL_ONLY.tasks });

    const replaced = harness.watch("ws-1");
    end({ workspaceId: "ws-1", threadId: THREAD, reason: "crashed", backgroundTasksLive: true });
    level(RESUMED);
    replaced();
    expect(harness.entry()).toMatchObject({ agents: 1, tasks: RESUMED.tasks });

    const drained = harness.watch("ws-1");
    level(EXPECTING);
    drained();
    expect(harness.entry()?.reply.kind).toBe("expected");

    const unseen = harness.watch("ws-1", "agt-later-0001");
    level({ ...SHELL_ONLY, threadId: "agt-later-0001" });
    unseen();
    expect(harness.entry("agt-later-0001")).toMatchObject({ total: 1 });

    const foreign = harness.watch("ws-2");
    level({ ...SHELL_ONLY, workspaceId: "ws-2" });
    foreign();
    expect(harness.entry(THREAD, "ws-2")).toMatchObject({ ownerId: "ws-2", total: 1 });
    expect(harness.reportFailure).not.toHaveBeenCalled();
  });

  it("clears a watched level once when nothing arrived for it before the missing answer", async () => {
    const { fake, level } = gateway();
    const harness = render(fake, () => 1_790_718_781_369);
    await waitForReact(() =>
      expect(fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1),
    );
    level(SHELL_ONLY);
    const first = harness.watch("ws-1");
    const second = harness.watch("ws-1");
    level({ ...SHELL_ONLY, threadId: "agt-other-0001" });
    level({ ...SHELL_ONLY, workspaceId: "ws-2" });

    first();
    expect(harness.entry()).toBeUndefined();
    expect(harness.entry("agt-other-0001")).toBeDefined();
    expect(harness.entry(THREAD, "ws-2")).toBeDefined();

    level(SHELL_ONLY);
    second();
    expect(harness.entry()).toMatchObject({ total: 1 });
  });

  it("unsubscribes both channels and clears the cap timer on unmount", async () => {
    const { fake, level, unsubscribeLevels, unsubscribeEnded } = gateway();
    const harness = render(fake, () => 1);
    await waitForReact(() => {
      expect(fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1);
      expect(fake.subscribeAgentSessionEnded).toHaveBeenCalledTimes(1);
    });
    vi.useFakeTimers();
    level(RESUMED);
    level(EXPECTING);
    expect(vi.getTimerCount()).toBe(1);
    const beforeUnmount = harness.observed.current;
    harness.unmount();
    expect(unsubscribeLevels).toHaveBeenCalledTimes(1);
    expect(unsubscribeEnded).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    level(REPLYING);
    act(() => {
      vi.advanceTimersByTime(10 * AGENT_SESSION_REPLY_EXPECTED_CAP_MS);
    });
    expect(harness.observed.current).toBe(beforeUnmount);
  });

  describe("recovering levels after the frontend reloaded", () => {
    type Levels = ReadonlyArray<AgentSessionBackgroundTasksEvent>;

    async function mounted(answer: Promise<Levels>) {
      const session = gateway();
      session.fake.listAgentSessionBackgrounds.mockReturnValueOnce(answer);
      const harness = render(session.fake, () => 1_790_718_781_369);
      await waitForReact(() => {
        expect(session.fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1);
        expect(session.fake.subscribeAgentSessionEnded).toHaveBeenCalledTimes(1);
        expect(session.fake.listAgentSessionBackgrounds).toHaveBeenCalledTimes(1);
      });
      return { ...session, harness };
    }

    async function settled(work: () => void) {
      await act(async () => {
        work();
        await Promise.resolve();
      });
    }

    it("recovers the sessions that are live when it mounts and only then reports itself recovered", async () => {
      const answer = deferred<Levels>();
      const { harness } = await mounted(answer.promise);
      expect(harness.recovered()).toBe(false);
      expect(harness.entry()).toBeUndefined();

      await settled(() =>
        answer.resolve([SHELL_ONLY, { ...EXPECTING, workspaceId: "ws-2" }, REPLYING_ELSEWHERE]),
      );

      expect(harness.recovered()).toBe(true);
      expect(harness.entry()).toMatchObject({ ownerId: "ws-1", total: 1, tasks: SHELL_ONLY.tasks });
      expect(harness.entry(THREAD, "ws-2")?.reply.kind).toBe("expected");
      expect(harness.entry("agt-other-0001")?.reply.kind).toBe("inProgress");
      expect(harness.reportFailure).not.toHaveBeenCalled();
    });

    it("never lets an older recovered level overwrite what a session reported or ended meanwhile", async () => {
      const answer = deferred<Levels>();
      const { harness, level, end } = await mounted(answer.promise);
      level(RESUMED);
      level({ ...SHELL_ONLY, workspaceId: "ws-2" });
      end({ workspaceId: "ws-2", threadId: THREAD, reason: "crashed", backgroundTasksLive: true });
      level({ ...SHELL_ONLY, threadId: "agt-drained-0001" });
      level({ ...DRAINED, threadId: "agt-drained-0001" });

      await settled(() =>
        answer.resolve([
          SHELL_ONLY,
          { ...SHELL_ONLY, workspaceId: "ws-2" },
          { ...SHELL_ONLY, threadId: "agt-drained-0001" },
          REPLYING_ELSEWHERE,
        ]),
      );

      expect(harness.entry()).toMatchObject({ agents: 1, tasks: RESUMED.tasks });
      expect(harness.entry(THREAD, "ws-2")).toBeUndefined();
      expect(harness.entry("agt-drained-0001")).toBeUndefined();
      expect(harness.entry("agt-other-0001")?.reply.kind).toBe("inProgress");
      expect(harness.recovered()).toBe(true);
    });

    it("applies events after the recovery as usual", async () => {
      const { harness, level } = await mounted(Promise.resolve([SHELL_ONLY]));
      await waitForReact(() => expect(harness.recovered()).toBe(true));
      expect(harness.entry()).toMatchObject({ total: 1 });

      level(DRAINED);
      expect(harness.entry()).toBeUndefined();
      level(RESUMED);
      expect(harness.entry()).toMatchObject({ agents: 1 });
    });

    it("reports a failed recovery once, counts as recovered and keeps following events", async () => {
      const answer = deferred<Levels>();
      const { harness, level } = await mounted(answer.promise);
      const failure = new Error("ipc unavailable");

      await settled(() => answer.reject(failure));

      expect(harness.recovered()).toBe(true);
      expect(harness.reportFailure).toHaveBeenCalledExactlyOnceWith(failure);
      level(SHELL_ONLY);
      expect(harness.entry()).toMatchObject({ total: 1 });
    });

    it("stops waiting for an answer that never comes and still adopts it if it arrives late", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const answer = deferred<Levels>();
      const { harness } = await mounted(answer.promise);
      expect(harness.recovered()).toBe(false);

      act(() => {
        vi.advanceTimersByTime(AGENT_SESSION_BACKGROUND_RECOVERY_TIMEOUT_MS / 2);
      });
      expect(harness.recovered()).toBe(false);
      act(() => {
        vi.advanceTimersByTime(AGENT_SESSION_BACKGROUND_RECOVERY_TIMEOUT_MS / 2);
      });
      expect(harness.recovered()).toBe(true);
      expect(AGENT_SESSION_BACKGROUND_RECOVERY_TIMEOUT_MS).toBe(5_000);
      expect(harness.entry()).toBeUndefined();

      await settled(() => answer.resolve([SHELL_ONLY]));
      expect(harness.entry()).toMatchObject({ total: 1 });
      expect(harness.reportFailure).not.toHaveBeenCalled();
    });

    it("drops the recovered levels when more sessions reported meanwhile than it can tell apart", async () => {
      const answer = deferred<Levels>();
      const { harness, level } = await mounted(answer.promise);
      for (let index = 0; index <= MAX_AGENT_SESSION_EVENTS_DURING_RECOVERY; index += 1) {
        level({ ...DRAINED, threadId: `agt-${index}-0001` });
      }

      await settled(() => answer.resolve([SHELL_ONLY]));

      expect(harness.entry()).toBeUndefined();
      expect(harness.recovered()).toBe(true);
    });

    it("needs no recovery without a gateway and recovers again for a new one", async () => {
      const without = render(undefined, () => 1);
      expect(without.recovered()).toBe(true);

      const first = await mounted(Promise.resolve([SHELL_ONLY]));
      await waitForReact(() => expect(first.harness.recovered()).toBe(true));
      expect(first.harness.entry()).toMatchObject({ total: 1 });
      const next = gateway();
      const answer = deferred<Levels>();
      next.fake.listAgentSessionBackgrounds.mockReturnValueOnce(answer.promise);
      first.harness.rerender(next.fake);
      expect(first.harness.recovered()).toBe(false);
      expect(first.harness.entry()).toBeUndefined();
      await waitForReact(() =>
        expect(next.fake.listAgentSessionBackgrounds).toHaveBeenCalledTimes(1),
      );

      await settled(() => answer.resolve([{ ...RESUMED, workspaceId: "ws-2" }]));

      expect(first.harness.recovered()).toBe(true);
      expect(first.harness.entry(THREAD, "ws-2")).toMatchObject({ agents: 1 });
      expect(first.harness.entry()).toBeUndefined();
    });

    it("lets nothing of a replaced gateway write into the levels of the new one", async () => {
      const first = await mounted(Promise.resolve([SHELL_ONLY]));
      await waitForReact(() => expect(first.harness.recovered()).toBe(true));
      const reportMissing = first.harness.watch("ws-1");
      const next = gateway();
      first.harness.rerender(next.fake);
      await waitForReact(() => expect(first.harness.recovered()).toBe(true));

      next.level(SHELL_ONLY);
      const replacement = first.harness.entry();
      expect(replacement).toMatchObject({ total: 1 });

      reportMissing();
      expect(first.harness.entry()).toBe(replacement);
      expect(first.unsubscribeLevels).toHaveBeenCalledTimes(1);
      expect(first.unsubscribeEnded).toHaveBeenCalledTimes(1);
    });

    it("lists the sessions only after it hears both their levels and their ends", async () => {
      const session = gateway();
      const hearing = deferred<() => void>();
      session.fake.subscribeAgentSessionEnded.mockReturnValueOnce(hearing.promise);
      const harness = render(session.fake, () => 1_790_718_781_369);
      await waitForReact(() =>
        expect(session.fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1),
      );
      await settled(() => undefined);
      session.level(SHELL_ONLY);
      expect(harness.entry()).toMatchObject({ total: 1 });
      expect(session.fake.listAgentSessionBackgrounds).not.toHaveBeenCalled();
      expect(harness.recovered()).toBe(false);

      await settled(() => hearing.resolve(() => undefined));
      await waitForReact(() => expect(harness.recovered()).toBe(true));

      expect(session.fake.listAgentSessionBackgrounds).toHaveBeenCalledTimes(1);
      expect(harness.entry()).toBeUndefined();
      expect(harness.reportFailure).not.toHaveBeenCalled();
    });

    it("still recovers when one subscription fails and reports that failure", async () => {
      const session = gateway();
      const failure = new Error("listen failed");
      session.fake.subscribeAgentSessionEnded.mockRejectedValueOnce(failure);
      session.fake.listAgentSessionBackgrounds.mockResolvedValueOnce([SHELL_ONLY]);
      const harness = render(session.fake, () => 1_790_718_781_369);

      await waitForReact(() => expect(harness.recovered()).toBe(true));

      expect(harness.reportFailure).toHaveBeenCalledExactlyOnceWith(failure);
      expect(session.fake.listAgentSessionBackgrounds).toHaveBeenCalledTimes(1);
      expect(harness.entry()).toMatchObject({ total: 1 });
    });

    it("retains an owner for session-level work only while it hears that owner's sessions end", async () => {
      const session = gateway();
      session.fake.listAgentSessionBackgrounds.mockResolvedValueOnce([MONITORING]);
      const harness = render(session.fake, () => 1_790_718_781_369);
      expect(harness.retains()).toBe(false);
      await waitForReact(() => expect(harness.recovered()).toBe(true));

      expect(harness.entry()).toMatchObject({ total: 1 });
      expect(harness.retains()).toBe(true);
      expect(harness.retains("ws-2")).toBe(false);
      session.end({
        workspaceId: "ws-1",
        threadId: THREAD,
        reason: "crashed",
        backgroundTasksLive: true,
      });
      expect(harness.retains()).toBe(false);
    });

    it("never retains an owner for a level whose session end it cannot hear", async () => {
      const session = gateway();
      const failure = new Error("listen failed");
      session.fake.subscribeAgentSessionEnded.mockRejectedValueOnce(failure);
      session.fake.listAgentSessionBackgrounds.mockResolvedValueOnce([MONITORING]);
      const harness = render(session.fake, () => 1_790_718_781_369);
      await waitForReact(() => expect(harness.recovered()).toBe(true));

      expect(harness.reportFailure).toHaveBeenCalledExactlyOnceWith(failure);
      expect(harness.entry()).toMatchObject({ total: 1 });
      expect(harness.retains()).toBe(false);
      session.level(SHELL_ONLY);
      expect(harness.entry()).toMatchObject({ total: 1 });
      expect(harness.retains()).toBe(false);
    });

    it("still retains an owner when only the level subscription failed", async () => {
      const session = gateway();
      session.fake.subscribeAgentSessionBackgroundTasks.mockRejectedValueOnce(
        new Error("listen failed"),
      );
      session.fake.listAgentSessionBackgrounds.mockResolvedValueOnce([MONITORING]);
      const harness = render(session.fake, () => 1_790_718_781_369);
      await waitForReact(() => expect(harness.recovered()).toBe(true));

      expect(harness.retains()).toBe(true);
    });

    it("retains nothing for a replaced gateway until the new one hears session ends", async () => {
      const first = gateway();
      first.fake.listAgentSessionBackgrounds.mockResolvedValueOnce([MONITORING]);
      const harness = render(first.fake, () => 1_790_718_781_369);
      await waitForReact(() => expect(harness.recovered()).toBe(true));
      expect(harness.retains()).toBe(true);

      const next = gateway();
      const hearing = deferred<() => void>();
      next.fake.subscribeAgentSessionEnded.mockReturnValueOnce(hearing.promise);
      harness.rerender(next.fake);
      await waitForReact(() =>
        expect(next.fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1),
      );
      await settled(() => undefined);
      next.level(MONITORING);
      expect(harness.entry()).toMatchObject({ total: 1 });
      expect(harness.retains()).toBe(false);

      await settled(() => hearing.resolve(() => undefined));
      await waitForReact(() => expect(harness.recovered()).toBe(true));
      next.level(MONITORING);
      expect(harness.retains()).toBe(true);
    });

    it("stops waiting when a subscription never settles and then lists nothing", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const session = gateway();
      session.fake.subscribeAgentSessionEnded.mockReturnValueOnce(
        new Promise<() => void>(() => undefined),
      );
      const harness = render(session.fake, () => 1_790_718_781_369);
      await waitForReact(() =>
        expect(session.fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1),
      );
      expect(harness.recovered()).toBe(false);

      act(() => {
        vi.advanceTimersByTime(AGENT_SESSION_BACKGROUND_RECOVERY_TIMEOUT_MS);
      });

      expect(harness.recovered()).toBe(true);
      expect(session.fake.listAgentSessionBackgrounds).not.toHaveBeenCalled();
    });

    it("ignores an answer that arrives after it unmounted", async () => {
      const answer = deferred<Levels>();
      const { harness } = await mounted(answer.promise);
      const before = harness.observed.current;
      harness.unmount();

      await settled(() => answer.reject(new Error("too late")));

      expect(harness.observed.current).toBe(before);
      expect(harness.reportFailure).not.toHaveBeenCalled();
    });
  });
});
