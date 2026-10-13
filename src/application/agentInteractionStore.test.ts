import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInteractionSnapshot } from "../domain/agentInteractionSnapshot";
import {
  agentInteractionFeedFake,
  agentInteractionSnapshotOf,
} from "../test/agentInteractionFeedFake";
import type { AgentInteractionOwner } from "./agentInteractionPorts";
import {
  AGENT_INTERACTION_FAILURE_NOTICE_THRESHOLD as FAILURE_THRESHOLD,
  AGENT_INTERACTION_MAX_RETRIES,
  AGENT_INTERACTION_OPERATION_DEADLINE_MS as DEADLINE,
  AGENT_INTERACTION_RETRY_BASE_MS,
  AGENT_INTERACTION_RETRY_CAP_MS,
  MAX_AGENT_INTERACTION_WATCHED_OWNERS,
  agentInteractionStore,
  type AgentInteractionObservation,
} from "./agentInteractionStore";

const A: AgentInteractionOwner = { workspaceId: "workspace-a", taskId: "task-a" };
const B: AgentInteractionOwner = { workspaceId: "workspace-b", taskId: "task-b" };
const PENDING: AgentInteractionObservation = { kind: "pending" };
const UNAVAILABLE: AgentInteractionObservation = { kind: "unavailable" };

function observed(snapshot: AgentInteractionSnapshot): AgentInteractionObservation {
  return { kind: "observed", snapshot };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
}

function retryDelay(retry: number): number {
  return Math.min(AGENT_INTERACTION_RETRY_BASE_MS * 2 ** retry, AGENT_INTERACTION_RETRY_CAP_MS);
}

async function failUntilNoticed(): Promise<void> {
  await settle();
  for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
    await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
}

function recorder() {
  const seen: AgentInteractionObservation[] = [];
  return { seen, listener: (observation: AgentInteractionObservation) => seen.push(observation) };
}

describe("agentInteractionStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns one store per feed instance", () => {
    const feed = agentInteractionFeedFake();
    expect(agentInteractionStore(feed)).toBe(agentInteractionStore(feed));
    expect(agentInteractionStore(agentInteractionFeedFake())).not.toBe(agentInteractionStore(feed));
  });

  it("subscribes before the first read and reports pending synchronously", async () => {
    const feed = agentInteractionFeedFake();
    const subscription = deferred<() => void>();
    feed.subscribeInteractions.mockImplementationOnce(() => subscription.promise);
    const current = agentInteractionSnapshotOf(A, 2);
    feed.record(current);
    const first = recorder();
    const unwatch = agentInteractionStore(feed).watch(A, first.listener);
    expect(first.seen).toEqual([PENDING]);
    await settle();
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(1);
    expect(feed.currentInteractions).not.toHaveBeenCalled();
    subscription.resolve(() => undefined);
    await settle();
    expect(feed.currentInteractions).toHaveBeenCalledTimes(1);
    expect(feed.currentInteractions).toHaveBeenCalledWith(A);
    expect(first.seen).toEqual([PENDING, observed(current)]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("shares one subscription and one read per owner across watchers and releases it last", async () => {
    const feed = agentInteractionFeedFake();
    const store = agentInteractionStore(feed);
    const current = agentInteractionSnapshotOf(A, 1);
    feed.record(current);
    const first = recorder();
    const second = recorder();
    const other = recorder();
    const late = recorder();
    const unwatchFirst = store.watch(A, first.listener);
    const unwatchSecond = store.watch(A, second.listener);
    const unwatchOther = store.watch(B, other.listener);
    await settle();
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(1);
    expect(feed.currentInteractions).toHaveBeenCalledTimes(2);
    expect(second.seen).toEqual([PENDING, observed(current)]);
    const unwatchLate = store.watch(A, late.listener);
    expect(late.seen).toEqual([observed(current)]);
    await settle();
    expect(feed.currentInteractions).toHaveBeenCalledTimes(2);
    unwatchFirst();
    unwatchFirst();
    unwatchSecond();
    unwatchLate();
    expect(feed.unsubscribed).not.toHaveBeenCalled();
    expect(feed.subscribers()).toBe(1);
    unwatchOther();
    expect(feed.unsubscribed).toHaveBeenCalledTimes(1);
    expect(feed.subscribers()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("applies a pushed snapshot at once without any timer", async () => {
    const feed = agentInteractionFeedFake();
    const watcher = recorder();
    const unwatch = agentInteractionStore(feed).watch(A, watcher.listener);
    await settle();
    const pushed = agentInteractionSnapshotOf(A, 1);
    feed.push(pushed);
    expect(watcher.seen).toEqual([
      PENDING,
      observed(agentInteractionSnapshotOf(A, 0)),
      observed(pushed),
    ]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(feed.currentInteractions).toHaveBeenCalledTimes(1);
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(1);
    unwatch();
  });

  it("drops stale, duplicate, reordered and foreign snapshots", async () => {
    const feed = agentInteractionFeedFake();
    const store = agentInteractionStore(feed);
    const watcher = recorder();
    const unwatch = store.watch(A, watcher.listener);
    await settle();
    const fifth = agentInteractionSnapshotOf(A, 5);
    feed.push(fifth);
    watcher.seen.length = 0;
    feed.push(agentInteractionSnapshotOf(A, 5));
    feed.push(agentInteractionSnapshotOf(A, 4));
    feed.push(agentInteractionSnapshotOf(A, 0));
    feed.push(agentInteractionSnapshotOf(B, 9));
    feed.push(agentInteractionSnapshotOf({ workspaceId: A.workspaceId, taskId: B.taskId }, 9));
    feed.push(agentInteractionSnapshotOf({ workspaceId: B.workspaceId, taskId: A.taskId }, 9));
    expect(watcher.seen).toEqual([]);
    const seventh = agentInteractionSnapshotOf(A, 7);
    feed.push(seventh);
    feed.push(agentInteractionSnapshotOf(A, 6));
    expect(watcher.seen).toEqual([observed(seventh)]);
    const late = recorder();
    const unwatchLate = store.watch(B, late.listener);
    expect(late.seen).toEqual([PENDING]);
    unwatchLate();
    unwatch();
  });

  it.each([
    { name: "an older read", sequence: 3 },
    { name: "a read answering that the session is gone", sequence: 0 },
  ])("keeps a pushed snapshot over $name that settles later", async ({ sequence }) => {
    const feed = agentInteractionFeedFake();
    const read = deferred<AgentInteractionSnapshot>();
    feed.currentInteractions.mockImplementationOnce(() => read.promise);
    const watcher = recorder();
    const unwatch = agentInteractionStore(feed).watch(A, watcher.listener);
    await settle();
    const pushed = agentInteractionSnapshotOf(A, 4);
    feed.push(pushed);
    read.resolve(agentInteractionSnapshotOf(A, sequence));
    await settle();
    expect(watcher.seen).toEqual([PENDING, observed(pushed)]);
    const later = agentInteractionSnapshotOf(A, 9);
    feed.push(later);
    expect(watcher.seen).toEqual([PENDING, observed(pushed), observed(later)]);
    unwatch();
  });

  it("starts a fresh generation on a re-watch and ignores the previous generation's read", async () => {
    const feed = agentInteractionFeedFake();
    const store = agentInteractionStore(feed);
    const stale = deferred<AgentInteractionSnapshot>();
    feed.currentInteractions.mockImplementationOnce(() => stale.promise);
    const first = recorder();
    const unwatchFirst = store.watch(A, first.listener);
    await settle();
    feed.push(agentInteractionSnapshotOf(A, 8));
    unwatchFirst();
    const current = agentInteractionSnapshotOf(A, 2);
    feed.record(current);
    const second = recorder();
    const unwatchSecond = store.watch(A, second.listener);
    expect(second.seen).toEqual([PENDING]);
    await settle();
    expect(second.seen).toEqual([PENDING, observed(current)]);
    stale.resolve(agentInteractionSnapshotOf(A, 99));
    await settle();
    expect(first.seen).toEqual([PENDING, observed(agentInteractionSnapshotOf(A, 8))]);
    expect(second.seen).toEqual([PENDING, observed(current)]);
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(2);
    expect(feed.subscribers()).toBe(1);
    unwatchSecond();
    expect(feed.subscribers()).toBe(0);
  });

  it("does no work after an unwatch during a pending read or a pending subscription", async () => {
    const feed = agentInteractionFeedFake();
    const store = agentInteractionStore(feed);
    const read = deferred<AgentInteractionSnapshot>();
    feed.currentInteractions.mockImplementationOnce(() => read.promise);
    const reading = recorder();
    const unwatchReading = store.watch(A, reading.listener);
    await settle();
    unwatchReading();
    read.reject(new Error("offline"));
    await settle();
    feed.push(agentInteractionSnapshotOf(A, 3));
    expect(reading.seen).toEqual([PENDING]);
    expect(vi.getTimerCount()).toBe(0);
    expect(feed.subscribers()).toBe(0);

    const subscription = deferred<() => void>();
    const release = vi.fn();
    feed.subscribeInteractions.mockImplementationOnce(() => subscription.promise);
    const subscribing = recorder();
    const unwatchSubscribing = store.watch(B, subscribing.listener);
    unwatchSubscribing();
    subscription.resolve(release);
    await settle();
    expect(release).toHaveBeenCalledTimes(1);
    expect(subscribing.seen).toEqual([PENDING]);
    expect(feed.currentInteractions).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays pending through transient failed reads and recovers without reporting unavailable", async () => {
    const feed = agentInteractionFeedFake();
    const current = agentInteractionSnapshotOf(A, 6);
    feed.record(current);
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      feed.currentInteractions.mockRejectedValueOnce(new Error("offline"));
    const watcher = recorder();
    const unwatch = agentInteractionStore(feed).watch(A, watcher.listener);
    await settle();
    expect(watcher.seen).toEqual([PENDING]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(AGENT_INTERACTION_RETRY_BASE_MS - 1);
    expect(feed.currentInteractions).toHaveBeenCalledTimes(1);
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
    expect(feed.currentInteractions).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(watcher.seen).toEqual([PENDING, observed(current)]);
    expect(vi.getTimerCount()).toBe(0);
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(1);
    unwatch();
  });

  it("reports unavailable once the read keeps failing and recovers through the capped retry", async () => {
    const feed = agentInteractionFeedFake();
    const current = agentInteractionSnapshotOf(A, 6);
    feed.record(current);
    for (let failure = 1; failure <= FAILURE_THRESHOLD; failure += 1)
      feed.currentInteractions.mockRejectedValueOnce(new Error("offline"));
    const watcher = recorder();
    const unwatch = agentInteractionStore(feed).watch(A, watcher.listener);
    await settle();
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1) {
      expect(watcher.seen).toEqual([PENDING]);
      await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
    }
    expect(feed.currentInteractions).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(watcher.seen).toEqual([PENDING, UNAVAILABLE]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(retryDelay(FAILURE_THRESHOLD - 1));
    expect(watcher.seen).toEqual([PENDING, UNAVAILABLE, observed(current)]);
    expect(vi.getTimerCount()).toBe(0);
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(1);
    unwatch();
  });

  it("treats a read answered for another owner as a failed read", async () => {
    const feed = agentInteractionFeedFake();
    feed.currentInteractions.mockResolvedValue(agentInteractionSnapshotOf(B, 4));
    const watcher = recorder();
    const unwatch = agentInteractionStore(feed).watch(A, watcher.listener);
    await failUntilNoticed();
    expect(feed.currentInteractions).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(watcher.seen).toEqual([PENDING, UNAVAILABLE]);
    unwatch();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays pending through a transient failed subscription and recovers without a new watch", async () => {
    const feed = agentInteractionFeedFake();
    const current = agentInteractionSnapshotOf(A, 1);
    feed.record(current);
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      feed.subscribeInteractions.mockRejectedValueOnce(new Error("no event bus"));
    const first = recorder();
    const second = recorder();
    const store = agentInteractionStore(feed);
    const unwatchFirst = store.watch(A, first.listener);
    await settle();
    expect(first.seen).toEqual([PENDING]);
    expect(feed.currentInteractions).not.toHaveBeenCalled();
    const unwatchSecond = store.watch(B, second.listener);
    expect(second.seen).toEqual([PENDING]);
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(1);
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(first.seen).toEqual([PENDING, observed(current)]);
    expect(second.seen).toEqual([PENDING, observed(agentInteractionSnapshotOf(B, 0))]);
    expect(vi.getTimerCount()).toBe(0);
    unwatchFirst();
    unwatchSecond();
    expect(feed.subscribers()).toBe(0);
  });

  it("reports unavailable to every owner once the subscription keeps failing and recovers", async () => {
    const feed = agentInteractionFeedFake();
    const current = agentInteractionSnapshotOf(A, 1);
    feed.record(current);
    for (let failure = 1; failure <= FAILURE_THRESHOLD; failure += 1)
      feed.subscribeInteractions.mockRejectedValueOnce(new Error("no event bus"));
    const first = recorder();
    const second = recorder();
    const store = agentInteractionStore(feed);
    const unwatchFirst = store.watch(A, first.listener);
    await settle();
    const unwatchSecond = store.watch(B, second.listener);
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1) {
      expect(first.seen).toEqual([PENDING]);
      await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
    }
    expect(first.seen).toEqual([PENDING, UNAVAILABLE]);
    expect(second.seen).toEqual([PENDING, UNAVAILABLE]);
    expect(feed.currentInteractions).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(retryDelay(FAILURE_THRESHOLD - 1));
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(FAILURE_THRESHOLD + 1);
    expect(first.seen).toEqual([PENDING, UNAVAILABLE, observed(current)]);
    expect(second.seen).toEqual([PENDING, UNAVAILABLE, observed(agentInteractionSnapshotOf(B, 0))]);
    expect(vi.getTimerCount()).toBe(0);
    unwatchFirst();
    unwatchSecond();
    expect(feed.subscribers()).toBe(0);
  });

  it("starts a new owner as unavailable once the subscription failure is established and recovers it", async () => {
    const feed = agentInteractionFeedFake();
    const current = agentInteractionSnapshotOf(B, 2);
    feed.record(current);
    const reconnection = deferred<() => void>();
    for (let failure = 1; failure <= FAILURE_THRESHOLD; failure += 1)
      feed.subscribeInteractions.mockRejectedValueOnce(new Error("no event bus"));
    feed.subscribeInteractions.mockImplementationOnce(() => reconnection.promise);
    const store = agentInteractionStore(feed);
    const first = recorder();
    const early = recorder();
    const late = recorder();
    const unwatchFirst = store.watch(A, first.listener);
    await settle();
    const unwatchEarly = store.watch({ ...B, taskId: "task-early" }, early.listener);
    expect(early.seen).toEqual([PENDING]);
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
    expect(first.seen).toEqual([PENDING, UNAVAILABLE]);
    expect(early.seen).toEqual([PENDING, UNAVAILABLE]);
    const unwatchLate = store.watch(B, late.listener);
    expect(late.seen).toEqual([UNAVAILABLE]);
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(retryDelay(FAILURE_THRESHOLD - 1));
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(FAILURE_THRESHOLD + 1);
    expect(vi.getTimerCount()).toBe(1);
    const reconnecting = recorder();
    const unwatchReconnecting = store.watch(
      { ...B, taskId: "task-reconnecting" },
      reconnecting.listener,
    );
    expect(reconnecting.seen).toEqual([UNAVAILABLE]);
    reconnection.reject(new Error("no event bus"));
    await settle();
    await vi.advanceTimersByTimeAsync(retryDelay(FAILURE_THRESHOLD));
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(FAILURE_THRESHOLD + 2);
    expect(late.seen).toEqual([UNAVAILABLE, observed(current)]);
    expect(first.seen).toEqual([PENDING, UNAVAILABLE, observed(agentInteractionSnapshotOf(A, 0))]);
    expect(vi.getTimerCount()).toBe(0);
    const healthy = recorder();
    const unwatchHealthy = store.watch({ ...B, taskId: "task-healthy" }, healthy.listener);
    expect(healthy.seen).toEqual([PENDING]);
    [unwatchFirst, unwatchEarly, unwatchLate, unwatchReconnecting, unwatchHealthy].forEach(
      (unwatch) => unwatch(),
    );
    expect(feed.subscribers()).toBe(0);
  });

  it("caps the retry delay, stops after the retry budget and restarts for a new watcher", async () => {
    const feed = agentInteractionFeedFake();
    feed.currentInteractions.mockRejectedValue(new Error("offline"));
    const store = agentInteractionStore(feed);
    const watcher = recorder();
    const unwatch = store.watch(A, watcher.listener);
    await settle();
    let waited = 0;
    for (let retry = 0; retry < AGENT_INTERACTION_MAX_RETRIES; retry += 1) {
      const delay = Math.min(
        AGENT_INTERACTION_RETRY_BASE_MS * 2 ** retry,
        AGENT_INTERACTION_RETRY_CAP_MS,
      );
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(feed.currentInteractions).toHaveBeenCalledTimes(1 + retry);
      await vi.advanceTimersByTimeAsync(1);
      expect(feed.currentInteractions).toHaveBeenCalledTimes(2 + retry);
      waited += delay;
    }
    expect(waited).toBeLessThanOrEqual(
      AGENT_INTERACTION_MAX_RETRIES * AGENT_INTERACTION_RETRY_CAP_MS,
    );
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * AGENT_INTERACTION_RETRY_CAP_MS);
    expect(feed.currentInteractions).toHaveBeenCalledTimes(1 + AGENT_INTERACTION_MAX_RETRIES);
    expect(watcher.seen).toEqual([PENDING, UNAVAILABLE]);
    const current = agentInteractionSnapshotOf(A, 2);
    feed.currentInteractions.mockResolvedValue(current);
    const joined = recorder();
    const unwatchJoined = store.watch(A, joined.listener);
    expect(joined.seen).toEqual([UNAVAILABLE]);
    await settle();
    expect(joined.seen).toEqual([UNAVAILABLE, observed(current)]);
    expect(watcher.seen).toEqual([PENDING, UNAVAILABLE, observed(current)]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
    unwatchJoined();
  });

  it("gives a late watcher the same grace instead of forcing a read or an early notice", async () => {
    const feed = agentInteractionFeedFake();
    feed.currentInteractions.mockRejectedValue(new Error("offline"));
    const store = agentInteractionStore(feed);
    const first = recorder();
    const joined = recorder();
    const unwatch = store.watch(A, first.listener);
    await settle();
    const unwatchJoined = store.watch(A, joined.listener);
    await settle();
    expect(joined.seen).toEqual([PENDING]);
    expect(feed.currentInteractions).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      await vi.advanceTimersByTimeAsync(retryDelay(failure - 1));
    expect(feed.currentInteractions).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(first.seen).toEqual([PENDING, UNAVAILABLE]);
    expect(joined.seen).toEqual([PENDING, UNAVAILABLE]);
    unwatch();
    unwatchJoined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers a failing owner from a push during the grace and after the notice", async () => {
    const feed = agentInteractionFeedFake();
    feed.currentInteractions.mockRejectedValue(new Error("offline"));
    const store = agentInteractionStore(feed);
    const graced = recorder();
    const unwatchGraced = store.watch(A, graced.listener);
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    const early = agentInteractionSnapshotOf(A, 3);
    feed.push(early);
    expect(graced.seen).toEqual([PENDING, observed(early)]);
    expect(vi.getTimerCount()).toBe(0);
    const noticed = recorder();
    const unwatchNoticed = store.watch(B, noticed.listener);
    await failUntilNoticed();
    expect(noticed.seen).toEqual([PENDING, UNAVAILABLE]);
    expect(vi.getTimerCount()).toBe(1);
    const late = agentInteractionSnapshotOf(B, 2);
    feed.push(late);
    expect(noticed.seen).toEqual([PENDING, UNAVAILABLE, observed(late)]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(AGENT_INTERACTION_RETRY_CAP_MS);
    expect(feed.currentInteractions).toHaveBeenCalledTimes(1 + FAILURE_THRESHOLD);
    unwatchGraced();
    unwatchNoticed();
  });

  it("keeps an observed push when the read that raced it fails", async () => {
    const feed = agentInteractionFeedFake();
    const read = deferred<AgentInteractionSnapshot>();
    feed.currentInteractions.mockImplementationOnce(() => read.promise);
    const watcher = recorder();
    const unwatch = agentInteractionStore(feed).watch(A, watcher.listener);
    await settle();
    const pushed = agentInteractionSnapshotOf(A, 1);
    feed.push(pushed);
    read.reject(new Error("offline"));
    await settle();
    expect(watcher.seen).toEqual([PENDING, observed(pushed)]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("abandons a read that never settles, retries it and rejects its late answer", async () => {
    const feed = agentInteractionFeedFake();
    const current = agentInteractionSnapshotOf(A, 2);
    feed.record(current);
    const hung = deferred<AgentInteractionSnapshot>();
    feed.currentInteractions.mockImplementationOnce(() => hung.promise);
    const watcher = recorder();
    const unwatch = agentInteractionStore(feed).watch(A, watcher.listener);
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(DEADLINE - 1);
    expect(feed.currentInteractions).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.getTimerCount()).toBe(1);
    hung.resolve(agentInteractionSnapshotOf(A, 99));
    await settle();
    expect(watcher.seen).toEqual([PENDING]);
    await vi.advanceTimersByTimeAsync(retryDelay(0));
    expect(feed.currentInteractions).toHaveBeenCalledTimes(2);
    expect(watcher.seen).toEqual([PENDING, observed(current)]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
  });

  it("reports unavailable when every read hangs and lets a later read recover", async () => {
    const feed = agentInteractionFeedFake();
    const current = agentInteractionSnapshotOf(A, 2);
    feed.record(current);
    for (let failure = 1; failure <= FAILURE_THRESHOLD; failure += 1)
      feed.currentInteractions.mockImplementationOnce(
        () => deferred<AgentInteractionSnapshot>().promise,
      );
    const store = agentInteractionStore(feed);
    const watcher = recorder();
    const unwatch = store.watch(A, watcher.listener);
    await settle();
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1) {
      await vi.advanceTimersByTimeAsync(DEADLINE + retryDelay(failure - 1));
      expect(watcher.seen).toEqual([PENDING]);
    }
    const joined = recorder();
    const unwatchJoined = store.watch(A, joined.listener);
    expect(feed.currentInteractions).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    await vi.advanceTimersByTimeAsync(DEADLINE);
    expect(watcher.seen).toEqual([PENDING, UNAVAILABLE]);
    expect(joined.seen).toEqual([PENDING, UNAVAILABLE]);
    await vi.advanceTimersByTimeAsync(retryDelay(FAILURE_THRESHOLD - 1));
    expect(watcher.seen).toEqual([PENDING, UNAVAILABLE, observed(current)]);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
    unwatchJoined();
  });

  it("observes a push while the read hangs and leaves no timer once the read is abandoned", async () => {
    const feed = agentInteractionFeedFake();
    feed.currentInteractions.mockImplementationOnce(
      () => deferred<AgentInteractionSnapshot>().promise,
    );
    const watcher = recorder();
    const unwatch = agentInteractionStore(feed).watch(A, watcher.listener);
    await settle();
    const pushed = agentInteractionSnapshotOf(A, 4);
    feed.push(pushed);
    expect(watcher.seen).toEqual([PENDING, observed(pushed)]);
    await vi.advanceTimersByTimeAsync(DEADLINE);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * AGENT_INTERACTION_RETRY_CAP_MS);
    expect(feed.currentInteractions).toHaveBeenCalledTimes(1);
    expect(watcher.seen).toEqual([PENDING, observed(pushed)]);
    unwatch();
  });

  it("abandons a subscription that never settles, reconnects and releases it when it settles late", async () => {
    const feed = agentInteractionFeedFake();
    const current = agentInteractionSnapshotOf(A, 2);
    feed.record(current);
    const hung = deferred<() => void>();
    const releaseLate = vi.fn();
    feed.subscribeInteractions.mockImplementationOnce(() => hung.promise);
    const watcher = recorder();
    const unwatch = agentInteractionStore(feed).watch(A, watcher.listener);
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(DEADLINE - 1);
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(1);
    expect(feed.currentInteractions).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1 + retryDelay(0));
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(2);
    expect(watcher.seen).toEqual([PENDING, observed(current)]);
    expect(releaseLate).not.toHaveBeenCalled();
    hung.resolve(releaseLate);
    await settle();
    expect(releaseLate).toHaveBeenCalledTimes(1);
    const abandoned = feed.subscribeInteractions.mock.calls[0]?.[0];
    abandoned?.(agentInteractionSnapshotOf(A, 9));
    expect(abandoned).toBeTypeOf("function");
    expect(watcher.seen).toEqual([PENDING, observed(current)]);
    expect(feed.subscribers()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    unwatch();
    expect(feed.subscribers()).toBe(0);
  });

  it("reports unavailable to every owner when every subscription hangs", async () => {
    const feed = agentInteractionFeedFake();
    feed.subscribeInteractions.mockImplementation(() => deferred<() => void>().promise);
    const watcher = recorder();
    const unwatch = agentInteractionStore(feed).watch(A, watcher.listener);
    await settle();
    for (let failure = 1; failure < FAILURE_THRESHOLD; failure += 1)
      await vi.advanceTimersByTimeAsync(DEADLINE + retryDelay(failure - 1));
    expect(watcher.seen).toEqual([PENDING]);
    await vi.advanceTimersByTimeAsync(DEADLINE);
    expect(watcher.seen).toEqual([PENDING, UNAVAILABLE]);
    expect(feed.subscribeInteractions).toHaveBeenCalledTimes(FAILURE_THRESHOLD);
    expect(feed.currentInteractions).not.toHaveBeenCalled();
    unwatch();
    await vi.advanceTimersByTimeAsync(DEADLINE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isolates a failing listener and honors an unwatch made during delivery", async () => {
    const feed = agentInteractionFeedFake();
    const store = agentInteractionStore(feed);
    const healthy = recorder();
    const leaving = recorder();
    const failing = vi.fn(() => void JSON.parse("not json"));
    const unwatchFailing = store.watch(A, failing);
    const unwatchLeaver = { current: () => undefined as void };
    const unwatchFirst = store.watch(A, (observation) => {
      if (observation.kind === "observed") unwatchLeaver.current();
    });
    unwatchLeaver.current = store.watch(A, leaving.listener);
    const unwatchHealthy = store.watch(A, healthy.listener);
    await settle();
    expect(healthy.seen).toEqual([PENDING, observed(agentInteractionSnapshotOf(A, 0))]);
    expect(leaving.seen).toEqual([PENDING]);
    expect(failing).toHaveBeenCalledTimes(2);
    expect(failing).toHaveReturnedTimes(0);
    unwatchFailing();
    unwatchFirst();
    unwatchHealthy();
    expect(feed.subscribers()).toBe(0);
  });

  it("bounds the watched owners and retains nothing for the rejected one", async () => {
    const feed = agentInteractionFeedFake();
    const store = agentInteractionStore(feed);
    const unwatchAll = Array.from(
      { length: MAX_AGENT_INTERACTION_WATCHED_OWNERS },
      (_unused, index) =>
        store.watch({ workspaceId: "workspace", taskId: `task-${index}` }, () => undefined),
    );
    const rejected = recorder();
    const unwatchRejected = store.watch(A, rejected.listener);
    await settle();
    feed.push(agentInteractionSnapshotOf(A, 1));
    expect(rejected.seen).toEqual([UNAVAILABLE]);
    expect(feed.currentInteractions).toHaveBeenCalledTimes(MAX_AGENT_INTERACTION_WATCHED_OWNERS);
    unwatchRejected();
    expect(feed.subscribers()).toBe(1);
    unwatchAll.forEach((unwatch) => unwatch());
    expect(feed.subscribers()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
