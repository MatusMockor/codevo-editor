import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE as RECORDS,
  MAX_AGENT_THREAD_REQUESTS_RETAINED,
  MAX_AGENT_THREAD_REQUEST_FENCES,
  type AgentRuntimeRequest,
} from "../domain/agentRuntimeRequest";
import {
  agentRuntimeRequestOf,
  agentThreadRequestFeedFake,
  agentThreadRequestsCursorOf,
  agentThreadRequestsOf,
  agentThreadRequestsPageOf as pulled,
} from "../test/agentThreadRequestFeedFake";
import {
  MAX_AGENT_THREAD_REQUEST_TURN_IDS_PER_PULL as PAGE,
  type AgentThreadRequestScope,
  type AgentThreadRequestsPage,
} from "./agentThreadRequestPorts";
import {
  AGENT_THREAD_REQUEST_FAILURE_NOTICE_THRESHOLD as FAILURE_THRESHOLD,
  AGENT_THREAD_REQUEST_MAX_RETRIES,
  AGENT_THREAD_REQUEST_OPERATION_DEADLINE_MS as DEADLINE,
  AGENT_THREAD_REQUEST_RETRY_BASE_MS,
  AGENT_THREAD_REQUEST_RETRY_CAP_MS,
  MAX_AGENT_THREAD_REQUEST_CURSOR_PAGES_PER_TURN_PAGE as CHAIN_PAGES,
  MAX_AGENT_THREAD_REQUEST_EPOCH_CHANGES_PER_SYNC as EPOCH_CHANGES,
  MAX_AGENT_THREAD_REQUEST_PULLS_PER_SYNC,
  MAX_AGENT_THREAD_REQUEST_RACED_PULLS_PER_SYNC as RACED_PULLS,
  MAX_AGENT_THREAD_REQUEST_RETIRED_EPOCHS,
  MAX_AGENT_THREAD_REQUEST_TURN_IDS,
  MAX_AGENT_THREAD_REQUEST_WATCHED_SCOPES,
  agentThreadRequestStore,
  type AgentThreadRequestObservation,
} from "./agentThreadRequestStore";

const A: AgentThreadRequestScope = {
  rootKey: "/repo/a",
  ownerId: "agent-root:a",
  threadId: "agt-thread-a",
  workspaceId: "workspace-a",
};
const B: AgentThreadRequestScope = {
  rootKey: "/repo/b",
  ownerId: "agent-root:b",
  threadId: "agt-thread-b",
  workspaceId: "workspace-b",
};
const T1 = "agt-turn-0001";
const T2 = "agt-turn-0002";
const CREATED = 1_760_000_000_000;

interface View {
  readonly epoch: string;
  readonly truncated: boolean;
  readonly requests: readonly string[];
  readonly pending: readonly string[];
}

function pendingRequest(turnId: string, id: string, version = 1): AgentRuntimeRequest {
  return agentRuntimeRequestOf("pendingApproval", {
    turnId,
    id,
    version,
    createdAtEpochMs: CREATED,
    order: 0,
  });
}

function resolvedRequest(turnId: string, id: string, version = 2): AgentRuntimeRequest {
  return agentRuntimeRequestOf("resolvedApproval", {
    turnId,
    id,
    version,
    createdAtEpochMs: CREATED,
    resolvedAtEpochMs: CREATED + 1,
    order: 0,
  });
}

function view(requests: readonly string[], overrides: Partial<View> = {}): View {
  return { epoch: "boot-0001", truncated: false, requests, pending: [], ...overrides };
}

function shown(observation: AgentThreadRequestObservation): View | "pending" | "unavailable" {
  if (observation.kind !== "observed") return observation.kind;
  const { state } = observation;
  return {
    pending: observation.pendingTurnIds,
    epoch: state.epoch,
    truncated: state.truncated,
    requests: state.requests.map(
      (request) => `${request.turnId}/${request.id}@${request.version}:${request.status}`,
    ),
  };
}

function recorder() {
  const seen: AgentThreadRequestObservation[] = [];
  return {
    seen,
    views: () => seen.map(shown),
    listener: (observation: AgentThreadRequestObservation) => {
      seen.push(observation);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((settlePromise, fail) => {
    resolve = settlePromise;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function released(): Promise<void> {
  await Promise.resolve();
}

async function drain(): Promise<void> {
  for (let round = 0; round < 200; round += 1) await settle();
}

function closedRequests(turnId: string, count: number): readonly AgentRuntimeRequest[] {
  return Array.from({ length: count }, (_unused, index) =>
    agentRuntimeRequestOf("timedOutApproval", {
      turnId,
      id: `req-closed-${String(index).padStart(3, "0")}`,
      createdAtEpochMs: CREATED,
      resolvedAtEpochMs: CREATED + 1,
      order: 0,
    }),
  );
}

function cursorAt(turnIds: readonly string[], offset: number, epoch = "boot-0001"): string | null {
  return agentThreadRequestsCursorOf(A, turnIds, epoch, offset);
}

function cursorsOf(feed: ReturnType<typeof agentThreadRequestFeedFake>): readonly unknown[] {
  return feed.currentThreadRequests.mock.calls.map(([, , cursor]) => cursor);
}

function requestCount(observation: AgentThreadRequestObservation | undefined): number {
  if (observation?.kind !== "observed") return -1;
  return observation.state.requests.length;
}

function pendingOf(observation: AgentThreadRequestObservation | undefined): readonly string[] {
  if (observation?.kind !== "observed") return ["not observed"];
  return observation.pendingTurnIds;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
}

function retryDelay(retry: number): number {
  return Math.min(
    AGENT_THREAD_REQUEST_RETRY_BASE_MS * 2 ** retry,
    AGENT_THREAD_REQUEST_RETRY_CAP_MS,
  );
}

async function failUntilNoticed(): Promise<void> {
  await settle();
  for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
    await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
}

function epochOf(generation: number): string {
  return `boot-${String(generation).padStart(4, "0")}`;
}

function hanging<T>(): Promise<T> {
  return deferred<T>().promise;
}

function turnIdsOf(count: number): readonly string[] {
  return Array.from(
    { length: count },
    (_unused, index) => `turn-${String(index).padStart(3, "0")}`,
  );
}

describe("agentThreadRequestStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns one store per feed instance", () => {
    const feed = agentThreadRequestFeedFake();
    expect(agentThreadRequestStore(feed)).toBe(agentThreadRequestStore(feed));
    expect(agentThreadRequestStore(agentThreadRequestFeedFake())).not.toBe(
      agentThreadRequestStore(feed),
    );
  });

  it("subscribes before the first pull and reports pending synchronously", async () => {
    const feed = agentThreadRequestFeedFake();
    const subscription = deferred<() => void>();
    feed.subscribeThreadRequests.mockImplementationOnce(() => subscription.promise);
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    const first = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], first.listener);
    expect(first.views()).toEqual(["pending"]);
    await settle();
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(1);
    expect(feed.currentThreadRequests).not.toHaveBeenCalled();
    subscription.resolve(() => undefined);
    await settle();
    expect(feed.currentThreadRequests.mock.calls).toEqual([[A, [T1], null]]);
    expect(first.views()).toEqual(["pending", view([`${T1}/req-1@1:pending`])]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("observes a thread without turns through one empty pull", async () => {
    const feed = agentThreadRequestFeedFake();
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [], watcher.listener);
    await settle();
    expect(feed.currentThreadRequests.mock.calls).toEqual([[A, [], null]]);
    expect(watcher.views()).toEqual(["pending", view([])]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("shares one subscription and one pull per scope across watchers and releases it last", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    const first = recorder();
    const second = recorder();
    const other = recorder();
    const late = recorder();
    const unwatchFirst = store.watch(A, [T1], first.listener);
    const unwatchSecond = store.watch(A, [T1], second.listener);
    const unwatchOther = store.watch(B, [T1], other.listener);
    await settle();
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(1);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(2);
    expect(second.views()).toEqual(["pending", view([`${T1}/req-1@1:pending`])]);
    const unwatchLate = store.watch(A, [T1], late.listener);
    expect(late.seen).toEqual([first.seen[1]]);
    expect(late.seen[0]).toBe(first.seen[1]);
    await settle();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(2);
    unwatchFirst();
    unwatchFirst();
    unwatchSecond();
    unwatchLate();
    expect(feed.unsubscribed).not.toHaveBeenCalled();
    expect(feed.subscribers()).toBe(1);
    unwatchOther();
    expect(feed.unsubscribed).not.toHaveBeenCalled();
    await released();
    expect(feed.unsubscribed).toHaveBeenCalledTimes(1);
    expect(feed.subscribers()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("converges when the pull settles before the push", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(
      agentThreadRequestsOf(A, [pendingRequest(T1, "req-1"), pendingRequest(T1, "req-2")]),
    );
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    feed.push(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-1")]));
    expect(watcher.views()).toEqual([
      "pending",
      view([`${T1}/req-1@1:pending`, `${T1}/req-2@1:pending`]),
      view([`${T1}/req-1@2:resolved`, `${T1}/req-2@1:pending`]),
    ]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1);
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(1);
    unwatch();
  });

  it("converges when the push arrives before the pull settles", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(
      agentThreadRequestsOf(A, [pendingRequest(T1, "req-1"), pendingRequest(T1, "req-2")]),
    );
    const pull = deferred<AgentThreadRequestsPage>();
    feed.currentThreadRequests.mockImplementationOnce(() => pull.promise);
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    feed.push(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-1")]));
    expect(watcher.views()).toEqual(["pending"]);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1);
    pull.resolve(pulled(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")])));
    await settle();
    expect(watcher.views()).toEqual([
      "pending",
      view([`${T1}/req-1@2:resolved`, `${T1}/req-2@1:pending`]),
    ]);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("never shows the older epoch of a pull that started before the first push", async () => {
    const feed = agentThreadRequestFeedFake();
    const older = deferred<AgentThreadRequestsPage>();
    feed.currentThreadRequests.mockImplementationOnce(() => older.promise);
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    feed.publish(agentThreadRequestsOf(A, [pendingRequest(T1, "req-9")], { epoch: "boot-0002" }));
    older.resolve(pulled(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")])));
    await settle();
    expect(watcher.views()).toEqual([
      "pending",
      view([`${T1}/req-9@1:pending`], { epoch: "boot-0002" }),
    ]);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(2);
    feed.push(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-9")], { epoch: "boot-0002" }));
    expect(watcher.views()[2]).toEqual(view([`${T1}/req-9@2:resolved`], { epoch: "boot-0002" }));
    unwatch();
  });

  it("keeps earlier pages and pushes when a pulled page claims to be a reset", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    const watcher = recorder();
    const unwatch = store.watch(A, [T1], watcher.listener);
    await settle();
    feed.push(agentThreadRequestsOf(A, [pendingRequest("agt-turn-0003", "req-5")]));
    const page = deferred<AgentThreadRequestsPage>();
    feed.currentThreadRequests.mockImplementationOnce(() => page.promise);
    const unwatchWide = store.watch(A, [T1, T2], () => undefined);
    page.resolve(pulled(agentThreadRequestsOf(A, [pendingRequest(T2, "req-4")], { reset: true })));
    await settle();
    expect(watcher.views()[watcher.seen.length - 1]).toEqual(
      view([`${T1}/req-1@1:pending`, `${T2}/req-4@1:pending`, "agt-turn-0003/req-5@1:pending"]),
    );
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(2);
    unwatchWide();
    unwatch();
  });

  it("merges pulled pages as authoritative and pushed messages as possibly stale", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const watcher = recorder();
    const unwatch = store.watch(A, [T1], watcher.listener);
    await settle();
    const closed = Array.from(
      { length: MAX_AGENT_THREAD_REQUESTS_RETAINED + MAX_AGENT_THREAD_REQUEST_FENCES + 2 },
      (_unused, index) =>
        agentRuntimeRequestOf("timedOutApproval", {
          turnId: "agt-turn-closed",
          id: `req-${index}`,
          createdAtEpochMs: CREATED + index,
          resolvedAtEpochMs: CREATED + index,
        }),
    );
    feed.push(agentThreadRequestsOf(A, closed));
    const forgotten = agentThreadRequestsOf(A, [pendingRequest(T2, "req-forgotten")]);
    const shownBefore = watcher.seen.length;
    feed.push(forgotten);
    expect(watcher.seen).toHaveLength(shownBefore);
    feed.record(forgotten);
    const unwatchWide = store.watch(A, [T1, T2], () => undefined);
    await settle();
    const last = watcher.views()[watcher.seen.length - 1];
    expect(typeof last === "string" ? [] : last?.requests).toContain(
      `${T2}/req-forgotten@1:pending`,
    );
    unwatchWide();
    unwatch();
  });

  it("never shows a closed request as live when its terminal push races the pull and its fence is forgotten at once", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const watcher = recorder();
    const unwatch = store.watch(A, [T1], watcher.listener);
    await settle();
    const newer = Array.from(
      { length: MAX_AGENT_THREAD_REQUESTS_RETAINED + MAX_AGENT_THREAD_REQUEST_FENCES },
      (_unused, index) =>
        agentRuntimeRequestOf("timedOutApproval", {
          turnId: "agt-turn-closed",
          id: `req-${index}`,
          createdAtEpochMs: CREATED + 1 + index,
          resolvedAtEpochMs: CREATED + 1 + index,
        }),
    );
    feed.push(agentThreadRequestsOf(A, newer));
    const snapshot = deferred<AgentThreadRequestsPage>();
    feed.currentThreadRequests.mockImplementationOnce(() => snapshot.promise);
    const unwatchWide = store.watch(A, [T1, T2], () => undefined);
    const closed = agentRuntimeRequestOf("timedOutApproval", {
      turnId: T2,
      id: "req-x",
      version: 2,
      createdAtEpochMs: CREATED,
      resolvedAtEpochMs: CREATED + 1,
    });
    feed.publish(agentThreadRequestsOf(A, [closed]));
    snapshot.resolve(pulled(agentThreadRequestsOf(A, [pendingRequest(T2, "req-x")])));
    await settle();
    const live = watcher
      .views()
      .flatMap((shownView) => (typeof shownView === "string" ? [] : shownView.requests))
      .filter((request) => request.startsWith(`${T2}/req-x`) && request.endsWith(":pending"));
    const last = watcher.views()[watcher.seen.length - 1];
    expect(live).toEqual([]);
    expect(typeof last === "string" ? null : last?.pending).toEqual([]);
    expect(feed.currentThreadRequests.mock.calls).toEqual([
      [A, [T1], null],
      [A, [T2], null],
      [A, [T2], null],
    ]);
    expect(vi.getTimerCount()).toBe(0);
    unwatchWide();
    unwatch();
  });

  it("stays truthfully pending while every pull is raced by a push and converges once the thread is quiet", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    const answer = feed.currentThreadRequests.getMockImplementation();
    const busy = { pushes: 0, racing: true };
    feed.currentThreadRequests.mockImplementation((scope, turnIds, cursor) => {
      if (busy.racing) {
        busy.pushes += 1;
        feed.publish(agentThreadRequestsOf(A, [pendingRequest(T2, `req-busy-${busy.pushes}`)]));
      }
      return answer?.(scope, turnIds, cursor) ?? hanging();
    });
    const watcher = recorder();
    const unwatch = store.watch(A, [T1], watcher.listener);
    await settle();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(RACED_PULLS);
    expect(watcher.views()).toEqual(["pending"]);
    expect(vi.getTimerCount()).toBe(1);
    const joined = recorder();
    const unwatchJoined = store.watch(A, [T1], joined.listener);
    await settle();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(RACED_PULLS);
    for (let run = 1; run <= 2 * FAILURE_THRESHOLD; run += 1) {
      await vi.advanceTimersByTimeAsync(retryDelay(run - 1));
      expect(feed.currentThreadRequests).toHaveBeenCalledTimes((run + 1) * RACED_PULLS);
      expect(vi.getTimerCount()).toBe(1);
    }
    expect(watcher.views()).toEqual(["pending"]);
    expect(joined.views()).toEqual(["pending"]);
    busy.racing = false;
    await vi.advanceTimersByTimeAsync(AGENT_THREAD_REQUEST_RETRY_CAP_MS);
    const last = watcher.views()[watcher.seen.length - 1];
    expect(typeof last === "string" ? null : last?.pending).toEqual([]);
    expect(typeof last === "string" ? [] : last?.requests).toHaveLength(1 + busy.pushes);
    expect(watcher.seen).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    unwatchJoined();
    unwatch();
  });

  it("drops the race backoff with the scope and restarts it from the base delay after a complete pull", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const answer = feed.currentThreadRequests.getMockImplementation();
    const busy = { racing: true, pushes: 0 };
    feed.currentThreadRequests.mockImplementation((scope, turnIds, cursor) => {
      if (busy.racing) {
        busy.pushes += 1;
        feed.publish(agentThreadRequestsOf(A, [pendingRequest(T2, `req-busy-${busy.pushes}`)]));
      }
      return answer?.(scope, turnIds, cursor) ?? hanging();
    });
    const unwatch = store.watch(A, [T1], () => undefined);
    await settle();
    await vi.advanceTimersByTimeAsync(retryDelay(0));
    await vi.advanceTimersByTimeAsync(retryDelay(1));
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(3 * RACED_PULLS);
    busy.racing = false;
    await vi.advanceTimersByTimeAsync(retryDelay(2));
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(3 * RACED_PULLS + 1);
    expect(vi.getTimerCount()).toBe(0);
    busy.racing = true;
    const unwatchWide = store.watch(A, [T1, T2], () => undefined);
    await settle();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(4 * RACED_PULLS + 1);
    await vi.advanceTimersByTimeAsync(retryDelay(0) - 1);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(4 * RACED_PULLS + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(5 * RACED_PULLS + 1);
    expect(vi.getTimerCount()).toBe(1);
    unwatchWide();
    unwatch();
    await released();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(AGENT_THREAD_REQUEST_RETRY_CAP_MS);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(5 * RACED_PULLS + 1);
  });

  it("keeps raced turns uncovered on an observed thread and covers them after the backoff", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const watcher = recorder();
    const unwatch = store.watch(A, [T1], watcher.listener);
    await settle();
    const answer = feed.currentThreadRequests.getMockImplementation();
    const busy = { pushes: 0 };
    feed.currentThreadRequests.mockImplementation((scope, turnIds, cursor) => {
      if (busy.pushes < RACED_PULLS) {
        busy.pushes += 1;
        feed.publish(agentThreadRequestsOf(A, [pendingRequest(T2, `req-busy-${busy.pushes}`)]));
      }
      return answer?.(scope, turnIds, cursor) ?? hanging();
    });
    const unwatchWide = store.watch(A, [T1, T2], () => undefined);
    await settle();
    const raced = watcher.views().slice(2);
    expect(raced).toHaveLength(1 + RACED_PULLS);
    expect(
      raced.map((shownView) => (typeof shownView === "string" ? null : shownView.pending)),
    ).toEqual(Array.from({ length: 1 + RACED_PULLS }, () => [T2]));
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(retryDelay(0));
    const last = watcher.views()[watcher.seen.length - 1];
    expect(typeof last === "string" ? null : last?.pending).toEqual([]);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1 + RACED_PULLS + 1);
    expect(vi.getTimerCount()).toBe(0);
    unwatchWide();
    unwatch();
    await released();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats stale, duplicate and empty messages as no-ops without a new emission", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    feed.record(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-1", 3)]));
    const watcher = recorder();
    const unwatch = store.watch(A, [T1], watcher.listener);
    await settle();
    const settledObservation = watcher.seen[1];
    watcher.seen.length = 0;
    feed.push(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-1", 3)]));
    feed.push(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-1", 2)]));
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1", 1)]));
    feed.push(agentThreadRequestsOf(A));
    expect(watcher.seen).toEqual([]);
    const late = recorder();
    const unwatchLate = store.watch(A, [T1], late.listener);
    expect(late.seen[0]).toBe(settledObservation);
    feed.push(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-1", 4)]));
    feed.push(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-1", 3)]));
    expect(watcher.views()).toEqual([view([`${T1}/req-1@4:resolved`])]);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1);
    unwatchLate();
    unwatch();
  });

  it.each([
    { name: "an epoch change", overrides: { epoch: "boot-0002" } },
    { name: "a reset", overrides: { reset: true } },
  ])(
    "replaces the state on $name at once and reports every watched turn as uncovered until the fresh pull",
    async ({ overrides }) => {
      const feed = agentThreadRequestFeedFake();
      const store = agentThreadRequestStore(feed);
      feed.record(
        agentThreadRequestsOf(A, [pendingRequest(T1, "req-1"), pendingRequest(T1, "req-2")]),
      );
      const watcher = recorder();
      const unwatch = store.watch(A, [T1], watcher.listener);
      await settle();
      const before = view([`${T1}/req-1@1:pending`, `${T1}/req-2@1:pending`]);
      const epoch = overrides.epoch ?? "boot-0001";
      const pull = deferred<AgentThreadRequestsPage>();
      feed.currentThreadRequests.mockImplementationOnce(() => pull.promise);
      feed.publish(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-2")], overrides));
      expect(feed.currentThreadRequests.mock.calls).toEqual([
        [A, [T1], null],
        [A, [T1], null],
      ]);
      const replaced = view([`${T1}/req-2@2:resolved`], { epoch, pending: [T1] });
      expect(watcher.views()).toEqual(["pending", before, replaced]);
      const joined = recorder();
      const unwatchJoined = store.watch(A, [T1], joined.listener);
      expect(joined.seen).toHaveLength(1);
      expect(joined.seen[0]).toBe(watcher.seen[2]);
      feed.publish(agentThreadRequestsOf(A, [pendingRequest(T1, "req-7")], { epoch }));
      const grown = view([`${T1}/req-2@2:resolved`, `${T1}/req-7@1:pending`], {
        epoch,
        pending: [T1],
      });
      expect(watcher.views()).toEqual(["pending", before, replaced, grown]);
      feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-9")], { epoch }));
      pull.resolve(pulled(agentThreadRequestsOf(A, [pendingRequest(T1, "req-raced")], { epoch })));
      await settle();
      expect(watcher.views()).toEqual([
        "pending",
        before,
        replaced,
        grown,
        view([`${T1}/req-2@2:resolved`, `${T1}/req-7@1:pending`, `${T1}/req-9@1:pending`], {
          epoch,
        }),
      ]);
      expect(feed.currentThreadRequests).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
      unwatchJoined();
      unwatch();
    },
  );

  it("drops a delayed push of a superseded epoch without pulling again", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    feed.publish(agentThreadRequestsOf(A, [pendingRequest(T1, "req-2")], { epoch: epochOf(2) }));
    await settle();
    const current = view([`${T1}/req-2@1:pending`], { epoch: epochOf(2) });
    expect(watcher.views()).toEqual([
      "pending",
      view([`${T1}/req-1@1:pending`]),
      view([`${T1}/req-2@1:pending`], { epoch: epochOf(2), pending: [T1] }),
      current,
    ]);
    feed.push(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-1", 9)]));
    feed.push(agentThreadRequestsOf(A, [], { reset: true }));
    await settle();
    expect(watcher.views()).toHaveLength(4);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(2);
    feed.push(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-2")], { epoch: epochOf(2) }));
    expect(watcher.views()[4]).toEqual(view([`${T1}/req-2@2:resolved`], { epoch: epochOf(2) }));
    const page = deferred<AgentThreadRequestsPage>();
    feed.currentThreadRequests.mockImplementationOnce(() => page.promise);
    const unwatchWide = agentThreadRequestStore(feed).watch(A, [T1, T2], () => undefined);
    feed.push(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-1", 9)]));
    page.resolve(
      pulled(agentThreadRequestsOf(A, [pendingRequest(T2, "req-6")], { epoch: epochOf(2) })),
    );
    await settle();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(3);
    expect(watcher.views()[watcher.seen.length - 1]).toEqual(
      view([`${T1}/req-2@2:resolved`, `${T2}/req-6@1:pending`], { epoch: epochOf(2) }),
    );
    expect(vi.getTimerCount()).toBe(0);
    unwatchWide();
    unwatch();
  });

  it("forgets the oldest superseded epoch beyond the bound and lets the pull restore the live one", async () => {
    const feed = agentThreadRequestFeedFake();
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    const live = MAX_AGENT_THREAD_REQUEST_RETIRED_EPOCHS + 2;
    for (let generation = 2; generation <= live; generation += 1) {
      feed.publish(agentThreadRequestsOf(A, [], { epoch: epochOf(generation) }));
      await settle();
    }
    const pulls = feed.currentThreadRequests.mock.calls.length;
    const shownBefore = watcher.seen.length;
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T1, "req-old")], { epoch: epochOf(2) }));
    await settle();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(pulls);
    expect(watcher.seen).toHaveLength(shownBefore);
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T1, "req-old")], { epoch: epochOf(1) }));
    await settle();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(pulls + 1);
    expect(watcher.views().slice(shownBefore)).toEqual([
      view([`${T1}/req-old@1:pending`], { epoch: epochOf(1), pending: [T1] }),
      view([], { epoch: epochOf(live) }),
    ]);
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T1, "req-old")], { epoch: epochOf(1) }));
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")], { epoch: epochOf(live) }));
    await settle();
    expect(watcher.views().slice(shownBefore + 2)).toEqual([
      view([`${T1}/req-1@1:pending`], { epoch: epochOf(live) }),
    ]);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(pulls + 1);
    unwatch();
  });

  it("discards a page that was requested before a reset and pulls the turns again", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    const first = recorder();
    const unwatchFirst = store.watch(A, [T1], first.listener);
    await settle();
    const stale = deferred<AgentThreadRequestsPage>();
    feed.currentThreadRequests.mockImplementationOnce(() => stale.promise);
    const second = recorder();
    const unwatchSecond = store.watch(A, [T1, T2], second.listener);
    feed.publish(agentThreadRequestsOf(A, [pendingRequest(T2, "req-5")], { reset: true }));
    stale.resolve(pulled(agentThreadRequestsOf(A, [pendingRequest(T2, "req-stale")])));
    await settle();
    expect(feed.currentThreadRequests.mock.calls).toEqual([
      [A, [T1], null],
      [A, [T2], null],
      [A, [T1, T2], null],
    ]);
    expect(second.views()).toEqual([
      view([`${T1}/req-1@1:pending`], { pending: [T2] }),
      view([`${T2}/req-5@1:pending`], { pending: [T1, T2] }),
      view([`${T2}/req-5@1:pending`]),
    ]);
    unwatchFirst();
    unwatchSecond();
  });

  it("discards the first page when a reset arrives before it settles", async () => {
    const feed = agentThreadRequestFeedFake();
    const stale = deferred<AgentThreadRequestsPage>();
    feed.currentThreadRequests.mockImplementationOnce(() => stale.promise);
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    feed.publish(agentThreadRequestsOf(A, [pendingRequest(T1, "req-5")], { reset: true }));
    stale.resolve(pulled(agentThreadRequestsOf(A, [pendingRequest(T1, "req-stale")])));
    await settle();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(2);
    expect(watcher.views()).toEqual(["pending", view([`${T1}/req-5@1:pending`])]);
    unwatch();
  });

  it("drops pushes of foreign threads and foreign workspaces and retains nothing for them", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const watcher = recorder();
    const unwatch = store.watch(A, [T1], watcher.listener);
    await settle();
    watcher.seen.length = 0;
    feed.push(agentThreadRequestsOf(B, [pendingRequest(T1, "req-b")]));
    feed.push(
      agentThreadRequestsOf({ ...A, workspaceId: B.workspaceId }, [pendingRequest(T1, "req-x")]),
    );
    feed.push(
      agentThreadRequestsOf({ ...B, workspaceId: A.workspaceId }, [pendingRequest(T1, "req-y")]),
    );
    expect(watcher.seen).toEqual([]);
    feed.push(agentThreadRequestsOf({ ...A, workspaceId: null }, [pendingRequest(T1, "req-1")]));
    expect(watcher.views()).toEqual([view([`${T1}/req-1@1:pending`])]);
    const other = recorder();
    const unwatchOther = store.watch(B, [T1], other.listener);
    expect(other.views()).toEqual(["pending"]);
    await settle();
    expect(other.views()).toEqual(["pending", view([])]);
    unwatchOther();
    unwatch();
  });

  it("merges messages without a workspace and messages of the scope workspace into one state", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.currentThreadRequests.mockResolvedValueOnce(
      pulled(agentThreadRequestsOf({ ...A, workspaceId: null }, [pendingRequest(T1, "req-1")])),
    );
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    feed.push(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-1")]));
    feed.push(agentThreadRequestsOf({ ...A, workspaceId: null }, [pendingRequest(T1, "req-2")]));
    expect(watcher.views()).toEqual([
      "pending",
      view([`${T1}/req-1@1:pending`]),
      view([`${T1}/req-1@2:resolved`]),
      view([`${T1}/req-1@2:resolved`, `${T1}/req-2@1:pending`]),
    ]);
    const last = watcher.seen[3];
    expect(last?.kind === "observed" ? last.state.threadId : undefined).toBe(A.threadId);
    unwatch();
  });

  it.each([
    { name: "another thread", answer: agentThreadRequestsOf(B) },
    { name: "another workspace", answer: agentThreadRequestsOf({ ...A, workspaceId: "other" }) },
  ])("treats a pull answered for $name as a failed pull", async ({ answer }) => {
    const feed = agentThreadRequestFeedFake();
    feed.currentThreadRequests.mockResolvedValue(pulled(answer));
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await failUntilNoticed();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(watcher.views()).toEqual(["pending", "unavailable"]);
    unwatch();
    expect(vi.getTimerCount()).toBe(1);
    await released();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isolates workspace A, then B, then A again as separate generations", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const stale = deferred<AgentThreadRequestsPage>();
    feed.currentThreadRequests.mockImplementationOnce(() => stale.promise);
    const first = recorder();
    const unwatchFirst = store.watch(A, [T1], first.listener);
    await settle();
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T1, "req-pushed")]));
    unwatchFirst();
    const between = recorder();
    const unwatchBetween = store.watch(B, [T1], between.listener);
    await settle();
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T1, "req-while-away")]));
    expect(between.views()).toEqual(["pending", view([])]);
    unwatchBetween();
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    const second = recorder();
    const unwatchSecond = store.watch(A, [T1], second.listener);
    expect(second.views()).toEqual(["pending"]);
    await settle();
    stale.resolve(pulled(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-1", 99)])));
    await settle();
    expect(first.views()).toEqual(["pending"]);
    expect(second.views()).toEqual(["pending", view([`${T1}/req-1@1:pending`])]);
    const reregistered = recorder();
    const unwatchReregistered = store.watch(
      { ...A, workspaceId: "workspace-a2" },
      [T1],
      reregistered.listener,
    );
    await settle();
    feed.push(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-1")]));
    expect(second.views()).toEqual([
      "pending",
      view([`${T1}/req-1@1:pending`]),
      view([`${T1}/req-1@2:resolved`]),
    ]);
    expect(reregistered.views()).toEqual(["pending", view([`${T1}/req-1@1:pending`])]);
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(1);
    unwatchSecond();
    unwatchReregistered();
    await released();
    expect(feed.subscribers()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does no work after an unwatch during a pending pull or a pending subscription", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const pull = deferred<AgentThreadRequestsPage>();
    feed.currentThreadRequests.mockImplementationOnce(() => pull.promise);
    const pulling = recorder();
    const unwatchPulling = store.watch(A, [T1], pulling.listener);
    await settle();
    unwatchPulling();
    pull.reject(new Error("offline"));
    await settle();
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    expect(pulling.views()).toEqual(["pending"]);
    expect(vi.getTimerCount()).toBe(0);
    expect(feed.subscribers()).toBe(0);

    const subscription = deferred<() => void>();
    const release = vi.fn();
    feed.subscribeThreadRequests.mockImplementationOnce(() => subscription.promise);
    const subscribing = recorder();
    const unwatchSubscribing = store.watch(B, [T1], subscribing.listener);
    unwatchSubscribing();
    subscription.resolve(release);
    await settle();
    expect(release).toHaveBeenCalledTimes(1);
    expect(subscribing.views()).toEqual(["pending"]);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops paging once the thread is unwatched between two pages", async () => {
    const feed = agentThreadRequestFeedFake();
    const page = deferred<AgentThreadRequestsPage>();
    feed.currentThreadRequests.mockImplementationOnce(() => page.promise);
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, turnIdsOf(PAGE + 1), watcher.listener);
    await settle();
    unwatch();
    page.resolve(pulled(agentThreadRequestsOf(A)));
    await settle();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1);
    expect(watcher.views()).toEqual(["pending"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a push delivered through a released subscription", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const unwatchFirst = store.watch(A, [T1], () => undefined);
    await settle();
    const stale = feed.subscribeThreadRequests.mock.calls[0]?.[0];
    unwatchFirst();
    await released();
    const second = recorder();
    const unwatchSecond = store.watch(A, [T1], second.listener);
    await settle();
    stale?.(agentThreadRequestsOf(A, [pendingRequest(T1, "req-late")]));
    expect(stale).toBeTypeOf("function");
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(2);
    expect(second.views()).toEqual(["pending", view([])]);
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    expect(second.views()).toEqual(["pending", view([]), view([`${T1}/req-1@1:pending`])]);
    unwatchSecond();
  });

  it.each([
    { name: "the new watch starts before the old one is released", releaseFirst: false },
    { name: "the old watch is released before the new one starts", releaseFirst: true },
  ])(
    "keeps the state across a turn list change when $name in the same tick",
    async ({ releaseFirst }) => {
      const feed = agentThreadRequestFeedFake();
      const store = agentThreadRequestStore(feed);
      feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
      const first = recorder();
      const unwatchFirst = store.watch(A, [T1], first.listener);
      await settle();
      const pull = deferred<AgentThreadRequestsPage>();
      feed.currentThreadRequests.mockImplementationOnce(() => pull.promise);
      if (releaseFirst) unwatchFirst();
      const second = recorder();
      const unwatchSecond = store.watch(A, [T1, T2], second.listener);
      unwatchFirst();
      const settledFirst = first.seen[1];
      const joined = second.seen[0];
      expect(second.views()).toEqual([view([`${T1}/req-1@1:pending`], { pending: [T2] })]);
      expect(joined?.kind === "observed" ? joined.state : null).toBe(
        settledFirst?.kind === "observed" ? settledFirst.state : undefined,
      );
      feed.publish(agentThreadRequestsOf(A, [pendingRequest(T2, "req-5")]));
      expect(second.views()).toEqual([
        view([`${T1}/req-1@1:pending`], { pending: [T2] }),
        view([`${T1}/req-1@1:pending`, `${T2}/req-5@1:pending`], { pending: [T2] }),
      ]);
      feed.record(agentThreadRequestsOf(A, [pendingRequest(T2, "req-4")]));
      pull.resolve(pulled(agentThreadRequestsOf(A, [pendingRequest(T2, "req-raced")])));
      await settle();
      expect(feed.currentThreadRequests.mock.calls).toEqual([
        [A, [T1], null],
        [A, [T2], null],
        [A, [T2], null],
      ]);
      expect(second.views()).toEqual([
        view([`${T1}/req-1@1:pending`], { pending: [T2] }),
        view([`${T1}/req-1@1:pending`, `${T2}/req-5@1:pending`], { pending: [T2] }),
        view([`${T1}/req-1@1:pending`, `${T2}/req-4@1:pending`, `${T2}/req-5@1:pending`]),
      ]);
      expect(first.views()).toEqual(
        ["pending", view([`${T1}/req-1@1:pending`])].concat(
          releaseFirst ? [] : [view([`${T1}/req-1@1:pending`], { pending: [T2] })],
        ),
      );
      expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(1);
      expect(feed.unsubscribed).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      unwatchSecond();
      expect(feed.subscribers()).toBe(1);
      await released();
      expect(feed.subscribers()).toBe(0);
    },
  );

  it("frees the scope one tick after its last watcher and starts a fresh generation after that", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    const first = recorder();
    const unwatchFirst = store.watch(A, [T1], first.listener);
    await settle();
    const stale = feed.subscribeThreadRequests.mock.calls[0]?.[0];
    unwatchFirst();
    await released();
    expect(feed.subscribers()).toBe(0);
    stale?.(agentThreadRequestsOf(A, [pendingRequest(T1, "req-away")]));
    const second = recorder();
    const unwatchSecond = store.watch(A, [T1, T2], second.listener);
    expect(second.views()).toEqual(["pending"]);
    feed.publish(agentThreadRequestsOf(A, [pendingRequest(T2, "req-5")]));
    await settle();
    expect(second.views()).toEqual([
      "pending",
      view([`${T1}/req-1@1:pending`, `${T2}/req-5@1:pending`]),
    ]);
    expect(feed.currentThreadRequests.mock.calls).toEqual([
      [A, [T1], null],
      [A, [T1, T2], null],
    ]);
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(2);
    expect(first.views()).toEqual(["pending", view([`${T1}/req-1@1:pending`])]);
    unwatchSecond();
  });

  it("adopts the pull in flight when the scope is released and watched again in the same tick", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const pull = deferred<AgentThreadRequestsPage>();
    feed.currentThreadRequests.mockImplementationOnce(() => pull.promise);
    const first = recorder();
    const unwatchFirst = store.watch(A, [T1], first.listener);
    await settle();
    unwatchFirst();
    const second = recorder();
    const unwatchSecond = store.watch(A, [T1], second.listener);
    await released();
    pull.resolve(pulled(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")])));
    await settle();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1);
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(1);
    expect(first.views()).toEqual(["pending"]);
    expect(second.views()).toEqual(["pending", view([`${T1}/req-1@1:pending`])]);
    unwatchSecond();
  });

  it("frees the scope when it is released, watched and released again in the same tick", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    feed.currentThreadRequests.mockRejectedValueOnce(new Error("offline"));
    const unwatchFirst = store.watch(A, [T1], () => undefined);
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    unwatchFirst();
    const unwatchSecond = store.watch(A, [T1], () => undefined);
    unwatchSecond();
    expect(feed.subscribers()).toBe(1);
    await released();
    expect(feed.subscribers()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const third = recorder();
    const unwatchThird = store.watch(A, [T1], third.listener);
    expect(third.views()).toEqual(["pending"]);
    await settle();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(2);
    expect(third.views()).toEqual(["pending", view([])]);
    unwatchThird();
  });

  it("keeps the backoff and the failure count across same-tick releases and re-watches", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    feed.currentThreadRequests.mockRejectedValue(new Error("offline"));
    const current = { unwatch: store.watch(A, [T1], () => undefined) };
    await settle();
    const last = recorder();
    for (let render = 0; render < 5; render += 1) {
      current.unwatch();
      current.unwatch = store.watch(A, [T1], last.listener);
      await released();
    }
    expect(last.views()).toEqual(Array.from({ length: 5 }, () => "pending"));
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(last.views()[5]).toBe("unavailable");
    current.unwatch();
    await released();
    expect(vi.getTimerCount()).toBe(0);
    expect(feed.subscribers()).toBe(0);
  });

  it("pulls a turn again once it left the watched list and came back", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const unwatchWide = store.watch(A, [T1, T2], () => undefined);
    const unwatchNarrow = store.watch(A, [T1], () => undefined);
    await settle();
    unwatchWide();
    const unwatchAgain = store.watch(A, [T1, T2], () => undefined);
    await settle();
    expect(feed.currentThreadRequests.mock.calls).toEqual([
      [A, [T1, T2], null],
      [A, [T2], null],
    ]);
    unwatchNarrow();
    unwatchAgain();
  });

  it("stops retrying turns that nobody watches anymore", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const narrow = recorder();
    const unwatchNarrow = store.watch(A, [T1], narrow.listener);
    await settle();
    feed.currentThreadRequests.mockRejectedValue(new Error("offline"));
    const unwatchWide = store.watch(A, [T1, T2], () => undefined);
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    unwatchWide();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * AGENT_THREAD_REQUEST_RETRY_CAP_MS);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(2);
    expect(narrow.views()).toEqual(["pending", view([]), view([], { pending: [T2] }), view([])]);
    unwatchNarrow();
  });

  it("bounds the epoch changes of one sync when the backend keeps changing its epoch", async () => {
    const feed = agentThreadRequestFeedFake();
    const turnIds = turnIdsOf(PAGE + 1);
    const unstable = 1 + 2 * EPOCH_CHANGES;
    feed.currentThreadRequests.mockImplementation(() => {
      const pulls = feed.currentThreadRequests.mock.calls.length;
      const epoch = pulls > unstable ? "boot-stable" : `boot-${pulls}`;
      return Promise.resolve(pulled(agentThreadRequestsOf(A, [], { epoch })));
    });
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, turnIds, watcher.listener);
    await settle();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1 + EPOCH_CHANGES);
    expect(vi.getTimerCount()).toBe(1);
    expect(watcher.views()).toEqual(["pending"]);
    await vi.advanceTimersByTimeAsync(retryDelay(0));
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1 + 2 * EPOCH_CHANGES);
    await vi.advanceTimersByTimeAsync(retryDelay(1));
    expect(watcher.views()).toEqual(["pending", view([], { epoch: "boot-stable" })]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("follows a cursor chain and covers the turns only when it ends, open requests first", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    feed.record(
      agentThreadRequestsOf(A, [
        ...closedRequests(T1, RECORDS + 5),
        pendingRequest(T1, "req-open"),
      ]),
    );
    const watcher = recorder();
    const unwatch = store.watch(A, [], watcher.listener);
    await settle();
    const unwatchWide = store.watch(A, [T1], () => undefined);
    await settle();
    expect(feed.currentThreadRequests.mock.calls).toEqual([
      [A, [], null],
      [A, [T1], null],
      [A, [T1], cursorAt([T1], RECORDS)],
    ]);
    expect(watcher.seen.slice(1).map(requestCount)).toEqual([0, 0, RECORDS, RECORDS + 6]);
    expect(watcher.seen.slice(1).map(pendingOf)).toEqual([[], [T1], [T1], []]);
    const first = watcher.views()[3];
    expect(typeof first === "string" ? [] : first?.requests).toContain(`${T1}/req-open@1:pending`);
    expect(vi.getTimerCount()).toBe(0);
    unwatchWide();
    unwatch();
  });

  it("merges a chain of many cursor pages without loss in one first observation", async () => {
    const feed = agentThreadRequestFeedFake();
    const records = closedRequests(T1, 3 * RECORDS + 8);
    feed.record(agentThreadRequestsOf(A, records));
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    expect(cursorsOf(feed)).toEqual([
      null,
      cursorAt([T1], RECORDS),
      cursorAt([T1], 2 * RECORDS),
      cursorAt([T1], 3 * RECORDS),
    ]);
    expect(watcher.views()).toEqual([
      "pending",
      view(records.map((request) => `${T1}/${request.id}@2:timedOut`)),
    ]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it.each([
    { name: "a push", overrides: {} },
    { name: "a reset", overrides: { reset: true } },
  ])(
    "restarts the turn page from the start when $name lands between cursor pages",
    async ({ overrides }) => {
      const feed = agentThreadRequestFeedFake();
      const closed = closedRequests(T1, RECORDS + 5);
      const pushed = agentThreadRequestsOf(
        A,
        [...closed, pendingRequest(T1, "req-pushed")],
        overrides,
      );
      feed.record(agentThreadRequestsOf(A, closed));
      const answer = feed.currentThreadRequests.getMockImplementation();
      const interrupted = { done: false };
      feed.currentThreadRequests.mockImplementation((scope, turnIds, cursor) => {
        if (cursor !== null && !interrupted.done) {
          interrupted.done = true;
          feed.record(pushed);
          feed.push(agentThreadRequestsOf(A, [pendingRequest(T1, "req-pushed")], overrides));
        }
        return answer?.(scope, turnIds, cursor) ?? hanging();
      });
      const watcher = recorder();
      const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
      await settle();
      expect(cursorsOf(feed)).toEqual([
        null,
        cursorAt([T1], RECORDS),
        null,
        cursorAt([T1], RECORDS),
      ]);
      expect(watcher.seen.map(requestCount)).toEqual([-1, RECORDS + 6]);
      expect(pendingOf(watcher.seen[1])).toEqual([]);
      const last = watcher.views()[1];
      expect(typeof last === "string" ? [] : last?.requests).toContain(
        `${T1}/req-pushed@1:pending`,
      );
      expect(vi.getTimerCount()).toBe(0);
      unwatch();
    },
  );

  it("restarts a chain once when a continuation fails and counts a second failure", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, closedRequests(T1, RECORDS + 5)));
    const answer = feed.currentThreadRequests.getMockImplementation();
    const stale = { failures: 3 };
    feed.currentThreadRequests.mockImplementation((scope, turnIds, cursor) => {
      if (cursor === null || stale.failures === 0)
        return answer?.(scope, turnIds, cursor) ?? hanging();
      stale.failures -= 1;
      return Promise.reject(new Error("The cursor is stale."));
    });
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    const continued = cursorAt([T1], RECORDS);
    expect(cursorsOf(feed)).toEqual([null, continued, null, continued]);
    expect(watcher.views()).toEqual(["pending"]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(retryDelay(0));
    expect(cursorsOf(feed)).toEqual([
      null,
      continued,
      null,
      continued,
      null,
      continued,
      null,
      continued,
    ]);
    expect(watcher.seen.map(requestCount)).toEqual([-1, RECORDS + 5]);
    expect(pendingOf(watcher.seen[1])).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("restarts a chain from the start when the journal changes its epoch behind a cursor", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, closedRequests(T1, RECORDS + 5)));
    const next = [pendingRequest(T1, "req-next"), ...closedRequests(T1, RECORDS)];
    const answer = feed.currentThreadRequests.getMockImplementation();
    const rotated = { done: false };
    feed.currentThreadRequests.mockImplementation((scope, turnIds, cursor) => {
      if (cursor !== null && !rotated.done) {
        rotated.done = true;
        feed.record(agentThreadRequestsOf(A, next, { epoch: epochOf(2) }));
      }
      return answer?.(scope, turnIds, cursor) ?? hanging();
    });
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    expect(cursorsOf(feed)).toEqual([
      null,
      cursorAt([T1], RECORDS, epochOf(1)),
      null,
      cursorAt([T1], RECORDS, epochOf(2)),
    ]);
    expect(watcher.seen.map(requestCount)).toEqual([-1, RECORDS + 1]);
    const last = watcher.views()[1];
    expect(typeof last === "string" ? null : last?.epoch).toBe(epochOf(2));
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("abandons a chain whose continuation answers from another epoch and pulls the turn page again", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const watcher = recorder();
    const unwatch = store.watch(A, [], watcher.listener);
    await settle();
    const next = [pendingRequest(T1, "req-next"), ...closedRequests(T1, RECORDS)];
    feed.currentThreadRequests
      .mockResolvedValueOnce(
        pulled(agentThreadRequestsOf(A, closedRequests(T1, RECORDS)), "boot-0001:64"),
      )
      .mockImplementationOnce(() => {
        feed.record(agentThreadRequestsOf(A, next, { epoch: epochOf(2) }));
        return Promise.resolve(
          pulled(agentThreadRequestsOf(A, next.slice(RECORDS), { epoch: epochOf(2) })),
        );
      });
    const unwatchWide = store.watch(A, [T1], () => undefined);
    await settle();
    expect(cursorsOf(feed)).toEqual([
      null,
      null,
      "boot-0001:64",
      null,
      cursorAt([T1], RECORDS, epochOf(2)),
    ]);
    const last = watcher.seen[watcher.seen.length - 1];
    expect(requestCount(last)).toBe(RECORDS + 1);
    expect(pendingOf(last)).toEqual([]);
    expect(watcher.seen.slice(2).map(pendingOf)).toEqual([[T1], [T1], [T1], [T1], []]);
    expect(vi.getTimerCount()).toBe(0);
    unwatchWide();
    unwatch();
  });

  it("keeps the turn list a chain started with when the watched turns change during a continuation", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    feed.record(
      agentThreadRequestsOf(A, [...closedRequests(T1, RECORDS + 5), pendingRequest(T2, "req-2")]),
    );
    const watcher = recorder();
    const unwatch = store.watch(A, [], watcher.listener);
    await settle();
    const answer = feed.currentThreadRequests.getMockImplementation();
    const gate = deferred<null>();
    feed.currentThreadRequests.mockImplementationOnce(async (scope, turnIds, cursor) => {
      await gate.promise;
      return (await answer?.(scope, turnIds, cursor)) ?? hanging();
    });
    const unwatchFirst = store.watch(A, [T1], () => undefined);
    const unwatchSecond = store.watch(A, [T1, T2], () => undefined);
    unwatchFirst();
    gate.resolve(null);
    await settle();
    expect(feed.currentThreadRequests.mock.calls).toEqual([
      [A, [], null],
      [A, [T1], null],
      [A, [T1], cursorAt([T1], RECORDS)],
      [A, [T2], null],
    ]);
    const last = watcher.seen[watcher.seen.length - 1];
    expect(requestCount(last)).toBe(RECORDS + 6);
    expect(pendingOf(last)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    unwatchSecond();
    unwatch();
  });

  it("is refused by the journal when a cursor comes back with another turn list or scope", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, closedRequests(T1, RECORDS + 5)));
    const first = await feed.currentThreadRequests(A, [T1], null);
    await expect(feed.currentThreadRequests(A, [T1], first.nextCursor)).resolves.toMatchObject({
      nextCursor: null,
    });
    await expect(feed.currentThreadRequests(A, [T1, T2], first.nextCursor)).rejects.toThrow(
      "The cursor is stale.",
    );
    await expect(feed.currentThreadRequests(A, [T2], first.nextCursor)).rejects.toThrow(
      "The cursor is stale.",
    );
    await expect(
      feed.currentThreadRequests({ ...A, rootKey: B.rootKey }, [T1], first.nextCursor),
    ).rejects.toThrow("The cursor is stale.");
    await expect(feed.currentThreadRequests(A, [T1], "boot-0001:64")).rejects.toThrow(
      "The cursor is stale.",
    );
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_.:-]{1,256}$/);
  });

  it("applies the deadline to each cursor page and restarts the chain once when one hangs", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, closedRequests(T1, RECORDS + 5)));
    const answer = feed.currentThreadRequests.getMockImplementation();
    const late = deferred<AgentThreadRequestsPage>();
    const hung = { done: false };
    feed.currentThreadRequests.mockImplementation((scope, turnIds, cursor) => {
      if (cursor === null || hung.done) return answer?.(scope, turnIds, cursor) ?? hanging();
      hung.done = true;
      return late.promise;
    });
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    expect(cursorsOf(feed)).toEqual([null, cursorAt([T1], RECORDS)]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(DEADLINE);
    late.resolve(pulled(agentThreadRequestsOf(A, [pendingRequest(T1, "req-late")])));
    await settle();
    expect(cursorsOf(feed)).toEqual([null, cursorAt([T1], RECORDS), null, cursorAt([T1], RECORDS)]);
    expect(watcher.seen.map(requestCount)).toEqual([-1, RECORDS + 5]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("fails a chain that never ends without ever covering its turns", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const watcher = recorder();
    const unwatch = store.watch(A, [], watcher.listener);
    await settle();
    feed.currentThreadRequests.mockImplementation(() =>
      Promise.resolve(pulled(agentThreadRequestsOf(A), "more")),
    );
    const unwatchWide = store.watch(A, [T1], () => undefined);
    await drain();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1 + CHAIN_PAGES);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(retryDelay(0));
    await drain();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1 + 2 * CHAIN_PAGES);
    expect(watcher.views()).toEqual(["pending", view([]), view([], { pending: [T1] })]);
    unwatchWide();
    unwatch();
  });

  it("counts cursor pages against the pulls of one sync and resumes from the covered turn pages", async () => {
    const feed = agentThreadRequestFeedFake();
    const turnIds = turnIdsOf(MAX_AGENT_THREAD_REQUEST_TURN_IDS);
    const chain = 100;
    feed.currentThreadRequests.mockImplementation((_scope, _turnIds, cursor) => {
      const page = cursor === null ? 1 : Number(cursor.slice(1)) + 1;
      return Promise.resolve(pulled(agentThreadRequestsOf(A), page < chain ? `p${page}` : null));
    });
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, turnIds, watcher.listener);
    await drain();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(
      MAX_AGENT_THREAD_REQUEST_PULLS_PER_SYNC,
    );
    expect(watcher.views()).toEqual(["pending"]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(retryDelay(0));
    await drain();
    const turnPages = MAX_AGENT_THREAD_REQUEST_TURN_IDS / PAGE;
    const covered = Math.floor(MAX_AGENT_THREAD_REQUEST_PULLS_PER_SYNC / chain);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(
      MAX_AGENT_THREAD_REQUEST_PULLS_PER_SYNC + (turnPages - covered) * chain,
    );
    expect(watcher.views()).toEqual(["pending", view([])]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("pulls more turns than one page holds in pages and observes them once", async () => {
    const feed = agentThreadRequestFeedFake();
    const turnIds = turnIdsOf(2 * PAGE + 6);
    feed.record(
      agentThreadRequestsOf(
        A,
        turnIds.map((turnId) => pendingRequest(turnId, "req-1")),
      ),
    );
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, turnIds, watcher.listener);
    await settle();
    expect(feed.currentThreadRequests.mock.calls).toEqual([
      [A, turnIds.slice(0, PAGE), null],
      [A, turnIds.slice(PAGE, 2 * PAGE), null],
      [A, turnIds.slice(2 * PAGE), null],
    ]);
    expect(watcher.views()).toEqual([
      "pending",
      view(turnIds.map((turnId) => `${turnId}/req-1@1:pending`)),
    ]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("resumes a failed page without pulling the settled pages again", async () => {
    const feed = agentThreadRequestFeedFake();
    const turnIds = turnIdsOf(PAGE + 1);
    feed.record(
      agentThreadRequestsOf(
        A,
        turnIds.map((turnId) => pendingRequest(turnId, "req-1")),
      ),
    );
    const answer = feed.currentThreadRequests.getMockImplementation();
    feed.currentThreadRequests
      .mockImplementationOnce(
        (scope, page, cursor) =>
          answer?.(scope, page, cursor) ?? Promise.reject(new Error("no journal")),
      )
      .mockRejectedValueOnce(new Error("offline"));
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, turnIds, watcher.listener);
    await settle();
    expect(watcher.views()).toEqual(["pending"]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(retryDelay(0));
    expect(feed.currentThreadRequests.mock.calls).toEqual([
      [A, turnIds.slice(0, PAGE), null],
      [A, turnIds.slice(PAGE), null],
      [A, turnIds.slice(PAGE), null],
    ]);
    expect(watcher.views()).toEqual([
      "pending",
      view(turnIds.map((turnId) => `${turnId}/req-1@1:pending`)),
    ]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("caps the watched turns at the newest ones and reports the state as truncated", async () => {
    const feed = agentThreadRequestFeedFake();
    const turnIds = turnIdsOf(MAX_AGENT_THREAD_REQUEST_TURN_IDS + 44);
    const oldest = turnIds[0] ?? "";
    const newest = turnIds[turnIds.length - 1] ?? "";
    feed.record(
      agentThreadRequestsOf(A, [pendingRequest(oldest, "req-1"), pendingRequest(newest, "req-1")]),
    );
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, turnIds, watcher.listener);
    await settle();
    const pulled = feed.currentThreadRequests.mock.calls.flatMap(([, page]) => page);
    expect(pulled).toEqual(turnIds.slice(44));
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(
      MAX_AGENT_THREAD_REQUEST_TURN_IDS / PAGE,
    );
    expect(MAX_AGENT_THREAD_REQUEST_TURN_IDS / PAGE).toBeLessThan(
      MAX_AGENT_THREAD_REQUEST_PULLS_PER_SYNC,
    );
    expect(watcher.views()).toEqual([
      "pending",
      view([`${newest}/req-1@1:pending`], { truncated: true }),
    ]);
    feed.push(agentThreadRequestsOf(A, [resolvedRequest(newest, "req-1")], { reset: true }));
    expect(watcher.views()[2]).toEqual(
      view([`${newest}/req-1@2:resolved`], { truncated: true, pending: turnIds.slice(44) }),
    );
    await settle();
    const views = watcher.views();
    expect(views[3]).toEqual(
      view([`${newest}/req-1@2:resolved`], { truncated: true, pending: turnIds.slice(44 + PAGE) }),
    );
    expect(views[views.length - 1]).toEqual(
      view([`${newest}/req-1@2:resolved`], { truncated: true }),
    );
    expect(views).toHaveLength(3 + MAX_AGENT_THREAD_REQUEST_TURN_IDS / PAGE);
    unwatch();
  });

  it("stays pending through transient failed pulls and recovers without reporting unavailable", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      feed.currentThreadRequests.mockRejectedValueOnce(new Error("offline"));
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    expect(watcher.views()).toEqual(["pending"]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(AGENT_THREAD_REQUEST_RETRY_BASE_MS - 1);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1);
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(watcher.views()).toEqual(["pending", view([`${T1}/req-1@1:pending`])]);
    expect(vi.getTimerCount()).toBe(0);
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(1);
    unwatch();
  });

  it("reports unavailable once the pull keeps failing and recovers through the capped retry", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    for (let failure = 1; failure <= FAILURE_THRESHOLD; failure += 1)
      feed.currentThreadRequests.mockRejectedValueOnce(new Error("offline"));
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1) {
      expect(watcher.views()).toEqual(["pending"]);
      await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
    }
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(watcher.views()).toEqual(["pending", "unavailable"]);
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T1, "req-2")]));
    expect(watcher.views()).toEqual(["pending", "unavailable"]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(retryDelay(FAILURE_THRESHOLD - 1));
    expect(watcher.views()).toEqual([
      "pending",
      "unavailable",
      view([`${T1}/req-1@1:pending`, `${T1}/req-2@1:pending`]),
    ]);
    expect(vi.getTimerCount()).toBe(0);
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(1);
    unwatch();
  });

  it("keeps an observed thread observed and reports the uncovered turns while later pulls keep failing", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    feed.record(
      agentThreadRequestsOf(A, [pendingRequest(T1, "req-1"), pendingRequest(T2, "req-4")]),
    );
    const first = recorder();
    const unwatchFirst = store.watch(A, [T1], first.listener);
    await settle();
    for (let failure = 1; failure <= FAILURE_THRESHOLD; failure += 1)
      feed.currentThreadRequests.mockRejectedValueOnce(new Error("offline"));
    const second = recorder();
    const unwatchSecond = store.watch(A, [T1, T2], second.listener);
    unwatchFirst();
    await settle();
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T2, "req-5")]));
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T2, "req-6")]));
    const early = [`${T1}/req-1@1:pending`, `${T2}/req-5@1:pending`];
    expect(second.views()).toEqual([
      view([`${T1}/req-1@1:pending`], { pending: [T2] }),
      view(early, { pending: [T2] }),
      view([...early, `${T2}/req-6@1:pending`], { pending: [T2] }),
    ]);
    await vi.advanceTimersByTimeAsync(retryDelay(FAILURE_THRESHOLD - 1));
    expect(second.views()[3]).toEqual(
      view([
        `${T1}/req-1@1:pending`,
        `${T2}/req-4@1:pending`,
        `${T2}/req-5@1:pending`,
        `${T2}/req-6@1:pending`,
      ]),
    );
    expect(second.views()).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
    unwatchSecond();
  });

  it("keeps the state after a reset with every turn uncovered while the fresh pull keeps failing", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1, T2], watcher.listener);
    await settle();
    feed.currentThreadRequests.mockRejectedValue(new Error("offline"));
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T2, "req-5")], { reset: true }));
    const invalidated = [
      "pending",
      view([`${T1}/req-1@1:pending`]),
      view([`${T2}/req-5@1:pending`], { pending: [T1, T2] }),
    ];
    expect(watcher.views()).toEqual(invalidated);
    await failUntilNoticed();
    await vi.advanceTimersByTimeAsync(
      AGENT_THREAD_REQUEST_MAX_RETRIES * AGENT_THREAD_REQUEST_RETRY_CAP_MS,
    );
    expect(watcher.views()).toEqual(invalidated);
    unwatch();
  });

  it("never leaves a watcher on an older observation when a listener publishes a newer one during delivery", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const widened = { unwatch: () => undefined as void, done: false };
    const reentrant = recorder();
    const unwatchReentrant = store.watch(A, [T1], (observation) => {
      reentrant.listener(observation);
      if (observation.kind !== "observed" || widened.done) return;
      widened.done = true;
      feed.currentThreadRequests.mockImplementation(() => hanging());
      widened.unwatch = store.watch(A, [T1, T2], () => undefined);
    });
    const later = recorder();
    const unwatchLater = store.watch(A, [T1], later.listener);
    await settle();
    expect(reentrant.views()).toEqual(["pending", view([]), view([], { pending: [T2] })]);
    expect(later.views()).toEqual(["pending", view([], { pending: [T2] })]);
    expect(later.seen[1]).toBe(reentrant.seen[2]);
    await vi.advanceTimersByTimeAsync(
      FAILURE_THRESHOLD * (DEADLINE + AGENT_THREAD_REQUEST_RETRY_CAP_MS),
    );
    expect(later.views()).toEqual(["pending", view([], { pending: [T2] })]);
    [unwatchReentrant, unwatchLater, widened.unwatch].forEach((unwatch) => unwatch());
  });

  it("reports the coverage page by page while an observed thread gains more turns than one page", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const turnIds = turnIdsOf(PAGE + 2);
    const added = turnIds.slice(1);
    const watcher = recorder();
    const unwatch = store.watch(A, turnIds.slice(0, 1), watcher.listener);
    await settle();
    const unwatchWide = store.watch(A, turnIds, () => undefined);
    feed.push(agentThreadRequestsOf(A));
    expect(watcher.views()).toEqual(["pending", view([]), view([], { pending: added })]);
    await settle();
    expect(watcher.views()).toEqual([
      "pending",
      view([]),
      view([], { pending: added }),
      view([], { pending: added.slice(PAGE) }),
      view([]),
    ]);
    const complete = watcher.seen[4];
    expect(complete?.kind === "observed" ? complete.pendingTurnIds : null).toBe(
      watcher.seen[1]?.kind === "observed" ? watcher.seen[1].pendingTurnIds : undefined,
    );
    unwatchWide();
    unwatch();
  });

  it("abandons a pull that never settles, retries it and rejects its late answer", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    const hung = deferred<AgentThreadRequestsPage>();
    feed.currentThreadRequests.mockImplementationOnce(() => hung.promise);
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(DEADLINE - 1);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.getTimerCount()).toBe(1);
    hung.resolve(pulled(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-1", 99)])));
    await settle();
    expect(watcher.views()).toEqual(["pending"]);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(retryDelay(0));
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(2);
    expect(watcher.views()).toEqual(["pending", view([`${T1}/req-1@1:pending`])]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("reports unavailable when every pull hangs and recovers once a pull answers", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    for (let failure = 1; failure <= FAILURE_THRESHOLD; failure += 1)
      feed.currentThreadRequests.mockImplementationOnce(() => hanging());
    const store = agentThreadRequestStore(feed);
    const watcher = recorder();
    const unwatch = store.watch(A, [T1], watcher.listener);
    await settle();
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1) {
      await vi.advanceTimersByTimeAsync(DEADLINE + retryDelay(failure - 1));
      expect(watcher.views()).toEqual(["pending"]);
    }
    const joined = recorder();
    const unwatchJoined = store.watch(A, [T1], joined.listener);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    await vi.advanceTimersByTimeAsync(DEADLINE);
    expect(watcher.views()).toEqual(["pending", "unavailable"]);
    expect(joined.views()).toEqual(["pending", "unavailable"]);
    await vi.advanceTimersByTimeAsync(retryDelay(FAILURE_THRESHOLD - 1));
    expect(watcher.views()).toEqual(["pending", "unavailable", view([`${T1}/req-1@1:pending`])]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
    unwatchJoined();
  });

  it("keeps showing pushes of an observed thread while the pull of added turns hangs", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const watcher = recorder();
    const unwatch = store.watch(A, [T1], watcher.listener);
    await settle();
    feed.currentThreadRequests.mockImplementationOnce(() => hanging());
    const unwatchWide = store.watch(A, [T1, T2], () => undefined);
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T2, "req-5")]));
    await vi.advanceTimersByTimeAsync(DEADLINE + retryDelay(0));
    expect(watcher.views()).toEqual([
      "pending",
      view([]),
      view([], { pending: [T2] }),
      view([`${T2}/req-5@1:pending`], { pending: [T2] }),
      view([`${T2}/req-5@1:pending`]),
    ]);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    unwatchWide();
    unwatch();
  });

  it("abandons a subscription that never settles, reconnects and releases it when it settles late", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    const hung = deferred<() => void>();
    const releaseLate = vi.fn();
    feed.subscribeThreadRequests.mockImplementationOnce(() => hung.promise);
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(DEADLINE - 1);
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 + retryDelay(0));
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(2);
    expect(watcher.views()).toEqual(["pending", view([`${T1}/req-1@1:pending`])]);
    expect(releaseLate).not.toHaveBeenCalled();
    hung.resolve(releaseLate);
    await settle();
    expect(releaseLate).toHaveBeenCalledTimes(1);
    const abandoned = feed.subscribeThreadRequests.mock.calls[0]?.[0];
    abandoned?.(agentThreadRequestsOf(A, [resolvedRequest(T1, "req-1")]));
    expect(abandoned).toBeTypeOf("function");
    expect(watcher.views()).toHaveLength(2);
    expect(feed.subscribers()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("reports unavailable to every scope when every subscription hangs", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.subscribeThreadRequests.mockImplementation(() => hanging());
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      await vi.advanceTimersByTimeAsync(DEADLINE + retryDelay(failure - 1));
    expect(watcher.views()).toEqual(["pending"]);
    await vi.advanceTimersByTimeAsync(DEADLINE);
    expect(watcher.views()).toEqual(["pending", "unavailable"]);
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(feed.currentThreadRequests).not.toHaveBeenCalled();
    unwatch();
    await released();
    await vi.advanceTimersByTimeAsync(DEADLINE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays pending through a transient failed subscription and recovers without a new watch", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      feed.subscribeThreadRequests.mockRejectedValueOnce(new Error("no event bus"));
    const first = recorder();
    const second = recorder();
    const store = agentThreadRequestStore(feed);
    const unwatchFirst = store.watch(A, [T1], first.listener);
    await settle();
    expect(first.views()).toEqual(["pending"]);
    expect(feed.currentThreadRequests).not.toHaveBeenCalled();
    const unwatchSecond = store.watch(B, [T1], second.listener);
    expect(second.views()).toEqual(["pending"]);
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(1);
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(first.views()).toEqual(["pending", view([`${T1}/req-1@1:pending`])]);
    expect(second.views()).toEqual(["pending", view([])]);
    expect(vi.getTimerCount()).toBe(0);
    unwatchFirst();
    unwatchSecond();
    await released();
    expect(feed.subscribers()).toBe(0);
  });

  it("starts a new scope as unavailable once the subscription failure is established and recovers it", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.record(agentThreadRequestsOf(B, [pendingRequest(T1, "req-1")]));
    for (let failure = 1; failure <= FAILURE_THRESHOLD; failure += 1)
      feed.subscribeThreadRequests.mockRejectedValueOnce(new Error("no event bus"));
    const store = agentThreadRequestStore(feed);
    const first = recorder();
    const early = recorder();
    const late = recorder();
    const unwatchFirst = store.watch(A, [T1], first.listener);
    await settle();
    const unwatchEarly = store.watch({ ...B, threadId: "agt-thread-early" }, [T1], early.listener);
    expect(early.views()).toEqual(["pending"]);
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
    expect(first.views()).toEqual(["pending", "unavailable"]);
    expect(early.views()).toEqual(["pending", "unavailable"]);
    const unwatchLate = store.watch(B, [T1], late.listener);
    expect(late.views()).toEqual(["unavailable"]);
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(feed.currentThreadRequests).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(retryDelay(FAILURE_THRESHOLD - 1));
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(FAILURE_THRESHOLD + 1);
    expect(late.views()).toEqual(["unavailable", view([`${T1}/req-1@1:pending`])]);
    expect(first.views()).toEqual(["pending", "unavailable", view([])]);
    expect(vi.getTimerCount()).toBe(0);
    const healthy = recorder();
    const unwatchHealthy = store.watch(
      { ...B, threadId: "agt-thread-healthy" },
      [T1],
      healthy.listener,
    );
    expect(healthy.views()).toEqual(["pending"]);
    [unwatchFirst, unwatchEarly, unwatchLate, unwatchHealthy].forEach((unwatch) => unwatch());
    await released();
    expect(feed.subscribers()).toBe(0);
  });

  it("caps the retry delay, stops after the retry budget and restarts for a new watcher", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.currentThreadRequests.mockRejectedValue(new Error("offline"));
    const store = agentThreadRequestStore(feed);
    const watcher = recorder();
    const unwatch = store.watch(A, [T1], watcher.listener);
    await settle();
    for (let retry = 0; retry < AGENT_THREAD_REQUEST_MAX_RETRIES; retry += 1) {
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(retryDelay(retry) - 1);
      expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1 + retry);
      await vi.advanceTimersByTimeAsync(1);
      expect(feed.currentThreadRequests).toHaveBeenCalledTimes(2 + retry);
    }
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * AGENT_THREAD_REQUEST_RETRY_CAP_MS);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1 + AGENT_THREAD_REQUEST_MAX_RETRIES);
    expect(watcher.views()).toEqual(["pending", "unavailable"]);
    feed.currentThreadRequests.mockResolvedValue(
      pulled(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")])),
    );
    const joined = recorder();
    const unwatchJoined = store.watch(A, [T1], joined.listener);
    expect(joined.views()).toEqual(["unavailable"]);
    await settle();
    expect(joined.views()).toEqual(["unavailable", view([`${T1}/req-1@1:pending`])]);
    expect(watcher.views()).toEqual(["pending", "unavailable", view([`${T1}/req-1@1:pending`])]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
    unwatchJoined();
  });

  it("pulls again on a push once the retry budget is spent and never during the backoff", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.currentThreadRequests.mockRejectedValue(new Error("offline"));
    const watcher = recorder();
    const unwatch = agentThreadRequestStore(feed).watch(A, [T1], watcher.listener);
    await settle();
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T1, "req-2")]));
    await settle();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(
      AGENT_THREAD_REQUEST_MAX_RETRIES * AGENT_THREAD_REQUEST_RETRY_CAP_MS,
    );
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1 + AGENT_THREAD_REQUEST_MAX_RETRIES);
    expect(vi.getTimerCount()).toBe(0);
    feed.currentThreadRequests.mockResolvedValue(
      pulled(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")])),
    );
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T1, "req-3")]));
    expect(watcher.views()).toEqual(["pending", "unavailable"]);
    await settle();
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(2 + AGENT_THREAD_REQUEST_MAX_RETRIES);
    expect(watcher.views()).toEqual([
      "pending",
      "unavailable",
      view([`${T1}/req-1@1:pending`, `${T1}/req-2@1:pending`, `${T1}/req-3@1:pending`]),
    ]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("gives a late watcher the same grace instead of forcing a pull or an early notice", async () => {
    const feed = agentThreadRequestFeedFake();
    feed.currentThreadRequests.mockRejectedValue(new Error("offline"));
    const store = agentThreadRequestStore(feed);
    const first = recorder();
    const joined = recorder();
    const unwatch = store.watch(A, [T1], first.listener);
    await settle();
    const unwatchJoined = store.watch(A, [T1], joined.listener);
    await settle();
    expect(joined.views()).toEqual(["pending"]);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(first.views()).toEqual(["pending", "unavailable"]);
    expect(joined.views()).toEqual(["pending", "unavailable"]);
    unwatch();
    unwatchJoined();
    await released();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isolates a failing listener and honors an unwatch made during delivery", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const healthy = recorder();
    const leaving = recorder();
    const failing = vi.fn(() => void JSON.parse("not json"));
    const unwatchFailing = store.watch(A, [T1], failing);
    const unwatchLeaver = { current: () => undefined as void };
    const unwatchFirst = store.watch(A, [T1], (observation) => {
      if (observation.kind === "observed") unwatchLeaver.current();
    });
    unwatchLeaver.current = store.watch(A, [T1], leaving.listener);
    const unwatchHealthy = store.watch(A, [T1], healthy.listener);
    await settle();
    expect(healthy.views()).toEqual(["pending", view([])]);
    expect(leaving.views()).toEqual(["pending"]);
    expect(failing).toHaveBeenCalledTimes(2);
    expect(failing).toHaveReturnedTimes(0);
    unwatchFailing();
    unwatchFirst();
    unwatchHealthy();
    await released();
    expect(feed.subscribers()).toBe(0);
  });

  it("bounds the watched scopes and retains nothing for the rejected one", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const unwatchAll = Array.from(
      { length: MAX_AGENT_THREAD_REQUEST_WATCHED_SCOPES },
      (_unused, index) =>
        store.watch({ ...B, threadId: `agt-thread-${index}` }, [T1], () => undefined),
    );
    const rejected = recorder();
    const unwatchRejected = store.watch(A, [T1], rejected.listener);
    await settle();
    feed.push(agentThreadRequestsOf(A, [pendingRequest(T1, "req-1")]));
    expect(rejected.views()).toEqual(["unavailable"]);
    expect(feed.currentThreadRequests).toHaveBeenCalledTimes(
      MAX_AGENT_THREAD_REQUEST_WATCHED_SCOPES,
    );
    unwatchRejected();
    expect(feed.subscribers()).toBe(1);
    unwatchAll.forEach((unwatch) => unwatch());
    await released();
    expect(feed.subscribers()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("admits a new scope at the cap when another scope was released in the same tick", async () => {
    const feed = agentThreadRequestFeedFake();
    const store = agentThreadRequestStore(feed);
    const unwatchAll = Array.from(
      { length: MAX_AGENT_THREAD_REQUEST_WATCHED_SCOPES },
      (_unused, index) =>
        store.watch({ ...B, threadId: `agt-thread-${index}` }, [T1], () => undefined),
    );
    await settle();
    unwatchAll[0]?.();
    const moved = recorder();
    const unwatchMoved = store.watch(A, [T1], moved.listener);
    const rejected = recorder();
    const unwatchRejected = store.watch(B, [T1], rejected.listener);
    expect(moved.views()).toEqual(["pending"]);
    expect(rejected.views()).toEqual(["unavailable"]);
    await settle();
    expect(moved.views()).toEqual(["pending", view([])]);
    expect(feed.subscribeThreadRequests).toHaveBeenCalledTimes(1);
    const back = recorder();
    const unwatchBack = store.watch({ ...B, threadId: "agt-thread-0" }, [T1], back.listener);
    expect(back.views()).toEqual(["unavailable"]);
    [...unwatchAll, unwatchMoved, unwatchRejected, unwatchBack].forEach((unwatch) => unwatch());
    await released();
    expect(feed.subscribers()).toBe(0);
  });
});
