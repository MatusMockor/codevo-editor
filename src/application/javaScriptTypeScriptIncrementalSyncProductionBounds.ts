import {
  boundedUtf8Length,
  type IncrementalDocumentContentEvent,
} from "../domain/incrementalDocumentSync";

const incarnationTokens = new WeakMap<object, string>();
let nextIncarnationToken = 1;

export interface IncrementalSyncDegradedReopenCheckpoint {
  readonly alternativeVersionId: number;
  readonly versionId: number;
}

export interface IncrementalSyncDegradedReopenOwner {
  degradedRevisionFloor: number;
  lastObservedRevision: number;
  latestDegradedCheckpoint: IncrementalSyncDegradedReopenCheckpoint | null;
}

/**
 * Retains only the monotonic authority needed to reopen after large-file degradation.
 * Incremental events may own multi-MiB inserted strings, so the channel must never keep
 * the event itself while an asynchronous close is settling.
 */
export function recordIncrementalSyncDegradedReopenCheckpoint(
  owner: IncrementalSyncDegradedReopenOwner,
  event: IncrementalDocumentContentEvent,
  eligibleForReopen: boolean,
): boolean {
  if (!eligibleForReopen) owner.latestDegradedCheckpoint = null;
  if (event.versionId <= Math.max(owner.degradedRevisionFloor, owner.lastObservedRevision)) {
    return false;
  }
  owner.degradedRevisionFloor = event.versionId;
  if (eligibleForReopen) {
    owner.latestDegradedCheckpoint = Object.freeze({
      alternativeVersionId: event.alternativeVersionId,
      versionId: event.versionId,
    });
  }
  return true;
}

export function incrementalSyncIncarnationToken(value: object): string {
  const existing = incarnationTokens.get(value);
  if (existing) return existing;
  const token = `editor-session-${nextIncarnationToken++}`;
  incarnationTokens.set(value, token);
  return token;
}

export function deferredIncrementalSyncDecision<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (decision: T) => void;
} {
  let resolve!: (decision: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

export function clearIncrementalSyncPending<T extends { resolve(value: null): void }>(
  pending: T | null,
): null {
  pending?.resolve(null);
  return null;
}

export function isIncrementalSyncObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

export function positiveIncrementalSyncLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0 ? value : fallback;
}

export function setIncrementalSyncSemanticMode<T extends string>(
  attachment: { readonly semanticMode: T },
  semanticMode: T,
): void {
  (attachment as { semanticMode: T }).semanticMode = semanticMode;
}

export function safeIncrementalSyncCapture(capture: () => string | null): string | null {
  try {
    const content = capture();
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}

export function safeIncrementalSyncLength(read: () => number | null): number | null {
  try {
    const value = read();
    return Number.isSafeInteger(value) && value !== null && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export function safeIncrementalSyncCurrent(isCurrent: () => boolean): boolean {
  try {
    return isCurrent() && isCurrent();
  } catch {
    return false;
  }
}

/** Counts retained inserted text; fixed event overhead is bounded by the count budgets. */
export function incrementalSyncEventUtf8Bytes(
  event: IncrementalDocumentContentEvent,
  limit: number,
): number | null {
  if (!Array.isArray(event?.changes)) return null;
  let total = 0;
  for (const change of event.changes) {
    if (typeof change?.text !== "string") return null;
    const receipt = boundedUtf8Length(change.text, limit - total);
    if (receipt.status !== "within-limit") return null;
    total += receipt.bytes;
  }
  return total;
}

export async function incrementalSyncWithDeadline<T>(
  settlement: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Incremental sync production operation exceeded its deadline.")),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([settlement, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
