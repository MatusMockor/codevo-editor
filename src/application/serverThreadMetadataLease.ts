export const MAX_METADATA_SAVES_IN_FLIGHT = 4;
export const METADATA_SLOT_RETRY_MS = 250;
export const MAX_METADATA_SLOT_WAIT_MS = 30_000;
const MAX_PENDING_VIEWED_MARKS = 256;

export interface ServerThreadMetadataLease {
  readonly owner: object;
  readonly busy: Set<string>;
  readonly attempted: Set<string>;
  readonly batch: { depth: number; refreshPending: boolean };
  readonly waiters: Array<() => void>;
  readonly pendingViewed: Map<string, number>;
}

export function serverThreadMetadataLease(owner: object): ServerThreadMetadataLease {
  return {
    owner,
    busy: new Set(),
    attempted: new Set(),
    batch: { depth: 0, refreshPending: false },
    waiters: [],
    pendingViewed: new Map(),
  };
}

export function viewedOnlyChange(change: object): number | null {
  const keys = Object.keys(change);
  if (keys.length !== 1 || keys[0] !== "viewedAtEpochMs") return null;
  const value = (change as { readonly viewedAtEpochMs?: unknown }).viewedAtEpochMs;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

export function rememberPendingViewed(
  lease: ServerThreadMetadataLease,
  threadId: string,
  viewedAtEpochMs: number,
): void {
  const previous = lease.pendingViewed.get(threadId);
  lease.pendingViewed.delete(threadId);
  lease.pendingViewed.set(threadId, Math.max(previous ?? viewedAtEpochMs, viewedAtEpochMs));
  for (const key of lease.pendingViewed.keys()) {
    if (lease.pendingViewed.size <= MAX_PENDING_VIEWED_MARKS) return;
    lease.pendingViewed.delete(key);
  }
}

export function takeRunnableViewed(
  lease: ServerThreadMetadataLease,
): ReadonlyArray<readonly [string, number]> {
  const runnable: Array<readonly [string, number]> = [];
  for (const [threadId, viewedAtEpochMs] of lease.pendingViewed) {
    if (lease.busy.size + runnable.length >= MAX_METADATA_SAVES_IN_FLIGHT) break;
    if (lease.busy.has(threadId)) continue;
    runnable.push([threadId, viewedAtEpochMs]);
  }
  for (const [threadId] of runnable) lease.pendingViewed.delete(threadId);
  return runnable;
}

export function releaseMetadataSlot(lease: ServerThreadMetadataLease, threadId: string): void {
  lease.busy.delete(threadId);
  lease.waiters.shift()?.();
}

export function nextMetadataSlotWake(lease: ServerThreadMetadataLease): Promise<void> {
  return new Promise<void>((resolve) => {
    const wake = (): void => {
      clearTimeout(timer);
      const index = lease.waiters.indexOf(wake);
      if (index !== -1) lease.waiters.splice(index, 1);
      resolve();
    };
    const timer = setTimeout(wake, METADATA_SLOT_RETRY_MS);
    lease.waiters.push(wake);
  });
}
