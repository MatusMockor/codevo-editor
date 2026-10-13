import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BoundedRetry,
  attemptWithinDeadline,
  type BoundedRetryPolicy,
  type DeadlineAttempt,
} from "./boundedRetry";

const POLICY: BoundedRetryPolicy = { baseMs: 100, capMs: 450, maxRetries: 5, noticeThreshold: 3 };

function failingRetry(retry: BoundedRetry) {
  const attempt = vi.fn<() => void>();
  const fail = (): void => {
    retry.fail(() => {
      attempt();
      fail();
    });
  };
  return { attempt, fail };
}

describe("BoundedRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts idle without any timer", () => {
    const retry = new BoundedRetry(POLICY);
    expect(retry.waiting).toBe(false);
    expect(retry.persistent).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("doubles the delay from the base up to the cap", () => {
    const retry = new BoundedRetry(POLICY);
    const { attempt, fail } = failingRetry(retry);
    fail();
    [100, 200, 400, 450, 450].forEach((delay, index) => {
      expect(retry.waiting).toBe(true);
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(delay - 1);
      expect(attempt).toHaveBeenCalledTimes(index);
      vi.advanceTimersByTime(1);
      expect(attempt).toHaveBeenCalledTimes(index + 1);
    });
  });

  it("stops scheduling once the retry budget is spent and restarts after a rearm", () => {
    const retry = new BoundedRetry(POLICY);
    const { attempt, fail } = failingRetry(retry);
    fail();
    vi.advanceTimersByTime(POLICY.maxRetries * POLICY.capMs);
    expect(attempt).toHaveBeenCalledTimes(POLICY.maxRetries);
    expect(retry.waiting).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    fail();
    expect(retry.waiting).toBe(false);
    retry.rearm();
    fail();
    expect(retry.waiting).toBe(true);
    vi.advanceTimersByTime(POLICY.baseMs);
    expect(attempt).toHaveBeenCalledTimes(POLICY.maxRetries + 1);
    retry.reset();
  });

  it("becomes persistent at the notice threshold and not before", () => {
    const retry = new BoundedRetry(POLICY);
    const { fail } = failingRetry(retry);
    fail();
    expect(retry.persistent).toBe(false);
    vi.advanceTimersByTime(100);
    expect(retry.persistent).toBe(false);
    vi.advanceTimersByTime(200);
    expect(retry.persistent).toBe(true);
    retry.reset();
  });

  it("is not waiting while the retry runs, so the retry can fail again", () => {
    const retry = new BoundedRetry(POLICY);
    const waiting: boolean[] = [];
    retry.fail(() => waiting.push(retry.waiting));
    vi.advanceTimersByTime(100);
    expect(waiting).toEqual([false]);
    expect(retry.waiting).toBe(false);
  });

  it("counts a failure reported during the backoff without a second timer", () => {
    const retry = new BoundedRetry(POLICY);
    const attempt = vi.fn<() => void>();
    retry.fail(attempt);
    retry.fail(attempt);
    retry.fail(attempt);
    expect(vi.getTimerCount()).toBe(1);
    expect(retry.persistent).toBe(true);
    vi.advanceTimersByTime(100);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the pending retry and the failure count on a rearm but keeps the notice", () => {
    const retry = new BoundedRetry(POLICY);
    const attempt = vi.fn<() => void>();
    retry.fail(attempt);
    retry.fail(attempt);
    retry.fail(attempt);
    retry.rearm();
    expect(retry.waiting).toBe(false);
    expect(retry.persistent).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    retry.fail(attempt);
    vi.advanceTimersByTime(99);
    expect(attempt).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending retry and clears the notice on a reset", () => {
    const retry = new BoundedRetry(POLICY);
    const attempt = vi.fn<() => void>();
    retry.fail(attempt);
    retry.fail(attempt);
    retry.fail(attempt);
    retry.reset();
    expect(retry.waiting).toBe(false);
    expect(retry.persistent).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(POLICY.maxRetries * POLICY.capMs);
    expect(attempt).not.toHaveBeenCalled();
    retry.fail(attempt);
    expect(retry.persistent).toBe(false);
    retry.reset();
  });

  it("keeps independent state per instance", () => {
    const first = new BoundedRetry(POLICY);
    const second = new BoundedRetry({ ...POLICY, noticeThreshold: 1 });
    second.fail(() => undefined);
    expect(first.waiting).toBe(false);
    expect(first.persistent).toBe(false);
    expect(second.persistent).toBe(true);
    second.reset();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function tracked<T>(attempt: Promise<DeadlineAttempt<T>>) {
  const seen: DeadlineAttempt<T>[] = [];
  void attempt.then((settled) => seen.push(settled));
  return seen;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

describe("attemptWithinDeadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the operation at once and settles with its value without leaving a timer", async () => {
    const operation = deferred<string>();
    const start = vi.fn(() => operation.promise);
    const discard = vi.fn<(late: string) => void>();
    const seen = tracked(attemptWithinDeadline(start, 1_000, discard));
    expect(start).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    operation.resolve("value");
    await settle();
    expect(seen).toEqual([{ kind: "settled", value: "value" }]);
    expect(vi.getTimerCount()).toBe(0);
    expect(discard).not.toHaveBeenCalled();
  });

  it("reports a rejected operation and an operation that cannot start as failed", async () => {
    const rejected = tracked(
      attemptWithinDeadline(() => Promise.reject(new Error("offline")), 1_000),
    );
    const unstartable = tracked(
      attemptWithinDeadline(
        (): Promise<string> => JSON.parse("not json") as Promise<string>,
        1_000,
      ),
    );
    await settle();
    expect(rejected).toEqual([{ kind: "failed" }]);
    expect(unstartable).toEqual([{ kind: "failed" }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out exactly at the deadline and not before", async () => {
    const seen = tracked(attemptWithinDeadline(() => deferred<string>().promise, 1_000));
    await vi.advanceTimersByTimeAsync(999);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([{ kind: "timedOut" }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hands a value that arrives after the deadline to the discard callback only", async () => {
    const operation = deferred<string>();
    const discard = vi.fn<(late: string) => void>();
    const seen = tracked(attemptWithinDeadline(() => operation.promise, 1_000, discard));
    await vi.advanceTimersByTimeAsync(1_000);
    operation.resolve("late");
    await settle();
    expect(seen).toEqual([{ kind: "timedOut" }]);
    expect(discard.mock.calls).toEqual([["late"]]);
  });

  it("rejects a value that is ready only after the expiry even when the timer has not fired yet", async () => {
    const clock = { now: 10_000 };
    const discard = vi.fn<(late: string) => void>();
    const blocking = (): Promise<string> => {
      clock.now += 1_000;
      return Promise.resolve("overdue");
    };
    const seen = tracked(attemptWithinDeadline(blocking, 1_000, discard, () => clock.now));
    await settle();
    expect(seen).toEqual([{ kind: "timedOut" }]);
    expect(discard.mock.calls).toEqual([["overdue"]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts a value that is ready just before the expiry on the injected clock", async () => {
    const clock = { now: 10_000 };
    const discard = vi.fn<(late: string) => void>();
    const quick = (): Promise<string> => {
      clock.now += 999;
      return Promise.resolve("in time");
    };
    const seen = tracked(attemptWithinDeadline(quick, 1_000, discard, () => clock.now));
    await settle();
    expect(seen).toEqual([{ kind: "settled", value: "in time" }]);
    expect(discard).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a rejection that is ready only after the expiry as timed out", async () => {
    const clock = { now: 0 };
    const blocking = (): Promise<string> => {
      clock.now += 1_000;
      return Promise.reject(new Error("offline"));
    };
    const seen = tracked(attemptWithinDeadline(blocking, 1_000, undefined, () => clock.now));
    await settle();
    expect(seen).toEqual([{ kind: "timedOut" }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a late rejection and a discard callback that fails", async () => {
    const rejecting = deferred<string>();
    const resolving = deferred<string>();
    const failingDiscard = vi.fn(() => void JSON.parse("not json"));
    const first = tracked(attemptWithinDeadline(() => rejecting.promise, 1_000));
    const second = tracked(attemptWithinDeadline(() => resolving.promise, 1_000, failingDiscard));
    await vi.advanceTimersByTimeAsync(1_000);
    rejecting.reject(new Error("offline"));
    resolving.resolve("late");
    await settle();
    expect(first).toEqual([{ kind: "timedOut" }]);
    expect(second).toEqual([{ kind: "timedOut" }]);
    expect(failingDiscard).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
