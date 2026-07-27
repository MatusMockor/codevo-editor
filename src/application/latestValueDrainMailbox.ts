interface LatestValueDrainMailboxEntry<T> {
  active: boolean;
  latest: T | null;
  drain: ((value: T, lease: LatestValueDrainLease) => Promise<void>) | null;
  running: Promise<void> | null;
}

type EnqueueDrain = (key: string, operation: () => Promise<void>) => Promise<void>;

export interface LatestValueDrainOffer {
  readonly settlement: Promise<void>;
  readonly started: boolean;
}

export interface LatestValueDrainLease {
  isCurrent(): boolean;
}

/**
 * Coalesces a stream of expensive immutable values per owner while preserving
 * the owner's existing async queue.
 *
 * At most two values are retained for a key: the value currently being drained
 * and the latest replacement offered while that drain is pending. Intermediate
 * values are superseded before they reach the queue.
 */
export class LatestValueDrainMailbox<T> {
  private readonly entries = new Map<string, LatestValueDrainMailboxEntry<T>>();

  offer(
    key: string,
    value: T,
    enqueue: EnqueueDrain,
    drain: (value: T, lease: LatestValueDrainLease) => Promise<void>,
  ): LatestValueDrainOffer {
    const current = this.entries.get(key);
    if (current?.active) {
      current.latest = value;
      current.drain = drain;
      return {
        settlement: current.running ?? Promise.resolve(),
        started: false,
      };
    }

    const entry: LatestValueDrainMailboxEntry<T> = {
      active: true,
      latest: value,
      drain,
      running: null,
    };
    const lease: LatestValueDrainLease = Object.freeze({
      isCurrent: () => entry.active && this.entries.get(key) === entry,
    });
    this.entries.set(key, entry);

    let resolveRunning!: () => void;
    let rejectRunning!: (error: unknown) => void;
    const running = new Promise<void>((resolve, reject) => {
      resolveRunning = resolve;
      rejectRunning = reject;
    });
    entry.running = running;

    enqueue(key, async () => {
      let hasError = false;
      let firstError: unknown;
      try {
        while (entry.active && entry.latest !== null && entry.drain) {
          const latest = entry.latest;
          const latestDrain = entry.drain;
          entry.latest = null;
          entry.drain = null;
          try {
            await latestDrain(latest, lease);
          } catch (error) {
            if (!hasError) {
              hasError = true;
              firstError = error;
            }
          }
        }

        if (hasError) {
          throw firstError;
        }
      } finally {
        entry.active = false;
        entry.latest = null;
        entry.drain = null;
        if (this.entries.get(key) === entry) {
          this.entries.delete(key);
        }
      }
    }).then(resolveRunning, rejectRunning);
    return { settlement: running, started: true };
  }

  drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    entry.active = false;
    entry.latest = null;
    entry.drain = null;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.forEach((entry) => {
      entry.active = false;
      entry.latest = null;
      entry.drain = null;
    });
    this.entries.clear();
  }
}
