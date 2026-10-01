import { isWorkspaceDirectoryBusyError } from "../domain/workspaceDirectoryReadErrors";

export const MAX_AGENT_SURFACE_TREE_CONCURRENT_READS = 4;
export const AGENT_SURFACE_TREE_BUSY_RETRY_DELAYS_MS: readonly number[] = [100, 250, 500];
export const AGENT_SURFACE_TREE_BUSY_FOLLOW_UP_DELAY_MS = 2_000;
export const AGENT_SURFACE_TREE_BUSY_JITTER_RATIO = 0.5;
export const AGENT_SURFACE_TREE_READ_TIMEOUT_MS = 10_000;

export type RetryWait = (delayMs: number) => Promise<boolean>;
export type WaitOutcome = "elapsed" | "woken" | "dismissed";

export class AgentSurfaceTreeReadSuperseded extends Error {
  constructor() {
    super("The directory read was superseded.");
    this.name = "AgentSurfaceTreeReadSuperseded";
  }
}

export class AgentSurfaceTreeReadTimedOut extends Error {
  constructor() {
    super("The directory read took too long.");
    this.name = "AgentSurfaceTreeReadTimedOut";
  }
}

export interface ScheduledWait {
  readonly settled: Promise<WaitOutcome>;
  wake(): void;
  dismiss(): void;
}

export interface RetryTimers {
  schedule(delayMs: number): ScheduledWait;
  dismissAll(): void;
}

export function createRetryTimers(): RetryTimers {
  const pending = new Set<ScheduledWait>();
  return {
    schedule(delayMs) {
      let settle: (outcome: WaitOutcome) => void = () => undefined;
      const settled = new Promise<WaitOutcome>((resolve) => {
        settle = resolve;
      });
      const finish = (outcome: WaitOutcome) => {
        clearTimeout(timer);
        pending.delete(wait);
        settle(outcome);
      };
      const timer = setTimeout(() => finish("elapsed"), delayMs);
      const wait: ScheduledWait = {
        settled,
        wake: () => finish("woken"),
        dismiss: () => finish("dismissed"),
      };
      pending.add(wait);
      return wait;
    },
    dismissAll() {
      for (const wait of [...pending]) wait.dismiss();
    },
  };
}

export interface ReadSlotLease {
  release(): void;
}

export interface DirectoryReadSlots {
  acquire(): ReadSlotLease | Promise<ReadSlotLease | null>;
  reset(): void;
}

export function createDirectoryReadSlots(limit: number): DirectoryReadSlots {
  let epoch = 0;
  let active = 0;
  const waiting: Array<(lease: ReadSlotLease | null) => void> = [];
  const lease = (): ReadSlotLease => {
    const leasedEpoch = epoch;
    let released = false;
    return {
      release() {
        if (released || leasedEpoch !== epoch) return;
        released = true;
        const next = waiting.shift();
        if (next !== undefined) {
          next(lease());
          return;
        }
        active -= 1;
      },
    };
  };
  return {
    acquire() {
      if (active < limit) {
        active += 1;
        return lease();
      }
      return new Promise((resolve) => waiting.push(resolve));
    },
    reset() {
      epoch += 1;
      active = 0;
      for (const resolve of waiting.splice(0)) resolve(null);
    },
  };
}

function rejectAfterDeadline(outcome: WaitOutcome): Promise<never> {
  if (outcome === "dismissed") return Promise.reject(new AgentSurfaceTreeReadSuperseded());
  return Promise.reject(new AgentSurfaceTreeReadTimedOut());
}

export async function readInSlot<T>(
  slots: DirectoryReadSlots,
  isCurrent: () => boolean,
  read: () => Promise<T>,
  timers: RetryTimers,
  timeoutMs: number,
): Promise<T> {
  const granted = slots.acquire();
  const lease = granted instanceof Promise ? await granted : granted;
  if (lease === null) throw new AgentSurfaceTreeReadSuperseded();
  if (!isCurrent()) {
    lease.release();
    throw new AgentSurfaceTreeReadSuperseded();
  }
  const deadline = timers.schedule(timeoutMs);
  try {
    return await Promise.race([read(), deadline.settled.then(rejectAfterDeadline)]);
  } finally {
    deadline.dismiss();
    lease.release();
  }
}

export function jitteredBusyRetryDelay(baseMs: number, random: () => number): number {
  const unit = Math.min(Math.max(random(), 0), 1);
  return baseMs + Math.floor(baseMs * AGENT_SURFACE_TREE_BUSY_JITTER_RATIO * unit);
}

export async function readRetryingWhileBusy<T>(
  read: () => Promise<T>,
  isCurrent: () => boolean,
  wait: RetryWait,
  delaysMs: readonly number[],
): Promise<T> {
  for (const delayMs of delaysMs) {
    try {
      return await read();
    } catch (error) {
      if (!isWorkspaceDirectoryBusyError(error) || !isCurrent()) throw error;
      if (!(await wait(delayMs)) || !isCurrent()) throw error;
    }
  }
  return read();
}
