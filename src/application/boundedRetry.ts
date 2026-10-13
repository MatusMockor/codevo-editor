export interface BoundedRetryPolicy {
  readonly baseMs: number;
  readonly capMs: number;
  readonly maxRetries: number;
  readonly noticeThreshold: number;
}

export class BoundedRetry {
  private failures = 0;
  private established = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly policy: BoundedRetryPolicy) {}

  get waiting(): boolean {
    return this.timer !== undefined;
  }

  get persistent(): boolean {
    return this.established;
  }

  fail(retry: () => void): void {
    this.failures += 1;
    if (this.failures >= this.policy.noticeThreshold) this.established = true;
    if (this.waiting || this.failures > this.policy.maxRetries) return;
    const delay = Math.min(this.policy.baseMs * 2 ** (this.failures - 1), this.policy.capMs);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      retry();
    }, delay);
  }

  rearm(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.failures = 0;
  }

  reset(): void {
    this.rearm();
    this.established = false;
  }
}

export type DeadlineAttempt<Value> =
  | { readonly kind: "settled"; readonly value: Value }
  | { readonly kind: "failed" }
  | { readonly kind: "timedOut" };

const FAILED_ATTEMPT = Object.freeze({ kind: "failed" } as const);
const TIMED_OUT_ATTEMPT = Object.freeze({ kind: "timedOut" } as const);

export type MonotonicClock = () => number;

const monotonicNow: MonotonicClock = () => performance.now();

export function attemptWithinDeadline<Value>(
  start: () => Promise<Value>,
  deadlineMs: number,
  discardLate: (late: Value) => void = () => undefined,
  now: MonotonicClock = monotonicNow,
): Promise<DeadlineAttempt<Value>> {
  return new Promise((resolve) => {
    const expiresAt = now() + deadlineMs;
    const lease: { timer: ReturnType<typeof setTimeout> | undefined } = { timer: undefined };
    const settle = (attempt: DeadlineAttempt<Value>): boolean => {
      if (lease.timer === undefined) return false;
      clearTimeout(lease.timer);
      lease.timer = undefined;
      resolve(attempt);
      return true;
    };
    lease.timer = setTimeout(() => settle(TIMED_OUT_ATTEMPT), deadlineMs);
    started(start).then(
      (value) => {
        if (now() < expiresAt && settle({ kind: "settled", value })) return;
        settle(TIMED_OUT_ATTEMPT);
        discarded(discardLate, value);
      },
      () => {
        settle(now() < expiresAt ? FAILED_ATTEMPT : TIMED_OUT_ATTEMPT);
      },
    );
  });
}

function started<Value>(start: () => Promise<Value>): Promise<Value> {
  try {
    return start();
  } catch {
    return Promise.reject(new Error("The operation could not start."));
  }
}

function discarded<Value>(discardLate: (late: Value) => void, late: Value): void {
  try {
    discardLate(late);
  } catch {
    return;
  }
}
