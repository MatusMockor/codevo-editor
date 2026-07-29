import type { DocumentSyncEnqueue, DocumentSyncPayloadReservation } from "./documentSyncContracts";

interface LatestValueDrainMailboxEntry<T> {
  active: boolean;
  capacityFailure: unknown | null;
  latest: T | null;
  latestReservation: DocumentSyncPayloadReservation | null;
  drain: ((value: T, lease: LatestValueDrainLease) => Promise<void>) | null;
  running: Promise<void> | null;
}

type EnqueueDrain = DocumentSyncEnqueue;

export interface LatestValueDrainOffer {
  readonly failedToStart: boolean;
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
    retainedPayloads: readonly string[] = [],
  ): LatestValueDrainOffer {
    const current = this.entries.get(key);
    if (current?.active) {
      if (current.capacityFailure !== null) {
        return {
          failedToStart: false,
          settlement: current.running ?? Promise.resolve(),
          started: false,
        };
      }
      const reservation =
        current.latestReservation ??
        (enqueue.reservePayload ? enqueue.reservePayload(key, retainedPayloads) : null);
      if (
        enqueue.reservePayload &&
        (!reservation ||
          (current.latestReservation !== null && !reservation.replace(retainedPayloads)))
      ) {
        current.capacityFailure = new Error("Document sync queue capacity exceeded.");
        return {
          failedToStart: false,
          settlement: current.running ?? Promise.resolve(),
          started: false,
        };
      }
      current.latestReservation = reservation;
      current.latest = value;
      current.drain = drain;
      return {
        failedToStart: false,
        settlement: current.running ?? Promise.resolve(),
        started: false,
      };
    }

    const initialReservation =
      retainedPayloads.length > 0 && enqueue.reservePayload
        ? enqueue.reservePayload(key, retainedPayloads)
        : null;
    if (retainedPayloads.length > 0 && enqueue.reservePayload && !initialReservation) {
      const rejection = Promise.reject(new Error("Document sync queue capacity exceeded."));
      void rejection.catch(() => undefined);
      return { failedToStart: true, settlement: rejection, started: false };
    }
    const entry: LatestValueDrainMailboxEntry<T> = {
      active: true,
      capacityFailure: null,
      latest: value,
      latestReservation: initialReservation,
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

    enqueue(
      key,
      async () => {
        let hasError = false;
        let firstError: unknown;
        try {
          while (entry.active && entry.latest !== null && entry.drain) {
            const latest = entry.latest;
            const latestDrain = entry.drain;
            const latestReservation = entry.latestReservation;
            entry.latest = null;
            entry.drain = null;
            entry.latestReservation = null;
            try {
              await latestDrain(latest, lease);
            } catch (error) {
              if (!hasError) {
                hasError = true;
                firstError = error;
              }
            } finally {
              latestReservation?.release();
            }
          }

          if (entry.capacityFailure !== null) {
            throw entry.capacityFailure;
          }
          if (hasError) {
            throw firstError;
          }
        } finally {
          this.releaseEntry(key, entry);
        }
      },
      initialReservation ? [] : retainedPayloads,
    ).then(resolveRunning, (error) => {
      this.releaseEntry(key, entry);
      rejectRunning(error);
    });
    return { failedToStart: false, settlement: running, started: true };
  }

  drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    entry.active = false;
    entry.capacityFailure = null;
    entry.latest = null;
    entry.drain = null;
    entry.latestReservation?.release();
    entry.latestReservation = null;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.forEach((entry) => {
      entry.active = false;
      entry.capacityFailure = null;
      entry.latest = null;
      entry.drain = null;
      entry.latestReservation?.release();
      entry.latestReservation = null;
    });
    this.entries.clear();
  }

  private releaseEntry(key: string, entry: LatestValueDrainMailboxEntry<T>): void {
    entry.active = false;
    entry.capacityFailure = null;
    entry.latest = null;
    entry.drain = null;
    entry.latestReservation?.release();
    entry.latestReservation = null;
    if (this.entries.get(key) === entry) {
      this.entries.delete(key);
    }
  }
}
