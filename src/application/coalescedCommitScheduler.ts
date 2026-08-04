export interface CoalescedCommitWindow {
  readonly debounceMs: number;
  readonly maxWaitMs: number;
}

export interface CoalescedCommitTimers {
  clearTimeout(handle: number): void;
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
}

export const DEFAULT_COALESCED_COMMIT_WINDOW: CoalescedCommitWindow = Object.freeze({
  debounceMs: 120,
  maxWaitMs: 2000,
});

const browserTimers: CoalescedCommitTimers = {
  clearTimeout: (handle) => {
    window.clearTimeout(handle);
  },
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
};

export class CoalescedCommitScheduler {
  private disposed = false;
  private deferredSince: number | null = null;
  private droppedPendingCommit = false;
  private lastCommitAt: number | null = null;
  private pendingHandle: number | null = null;

  constructor(
    private readonly commit: () => void,
    private readonly window: CoalescedCommitWindow = DEFAULT_COALESCED_COMMIT_WINDOW,
    private readonly timers: CoalescedCommitTimers = browserTimers,
  ) {}

  commitNow(): void {
    if (this.disposed) {
      this.droppedPendingCommit = true;
      return;
    }
    this.cancelPending();
    this.runCommit();
  }

  commitCoalesced(): void {
    if (this.disposed) {
      this.droppedPendingCommit = true;
      return;
    }
    const now = this.timers.now();
    if (this.pendingHandle === null && this.quiescentSince(now)) {
      this.runCommit();
      return;
    }
    if (this.deferredSince === null) {
      this.deferredSince = now;
    }
    this.cancelPending();
    this.pendingHandle = this.timers.setTimeout(() => {
      this.pendingHandle = null;
      if (this.disposed) {
        return;
      }
      this.runCommit();
    }, this.delayFrom(now));
  }

  arm(): void {
    if (!this.disposed) {
      return;
    }
    this.disposed = false;
    if (!this.droppedPendingCommit) {
      return;
    }
    this.droppedPendingCommit = false;
    this.runCommit();
  }

  dispose(): void {
    this.disposed = true;
    this.droppedPendingCommit = this.droppedPendingCommit || this.pendingHandle !== null;
    this.cancelPending();
    this.deferredSince = null;
  }

  private quiescentSince(now: number): boolean {
    return (
      this.lastCommitAt === null ||
      now < this.lastCommitAt ||
      now - this.lastCommitAt >= this.window.debounceMs
    );
  }

  private delayFrom(now: number): number {
    const waited = this.deferredSince === null ? 0 : now - this.deferredSince;
    const remaining = this.window.maxWaitMs - waited;
    return Math.max(0, Math.min(this.window.debounceMs, remaining));
  }

  private cancelPending(): void {
    if (this.pendingHandle === null) {
      return;
    }
    this.timers.clearTimeout(this.pendingHandle);
    this.pendingHandle = null;
  }

  private runCommit(): void {
    this.deferredSince = null;
    this.lastCommitAt = this.timers.now();
    try {
      this.commit();
    } finally {
      this.lastCommitAt = this.timers.now();
    }
  }
}
