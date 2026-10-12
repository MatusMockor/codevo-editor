export const REMOTE_INVENTORY_PROGRESS_INTERVAL_MS = 150;

export type RemoteInventoryProgressUrgency = "immediate" | "coalesced";

export interface RemoteInventoryProgressGate<T> {
  offer(value: T, urgency: RemoteInventoryProgressUrgency): void;
  latest(): T | undefined;
  close(): void;
}

export function remoteInventoryProgressGate<T>(
  publish: (value: T) => void,
): RemoteInventoryProgressGate<T> {
  let latest: T | undefined;
  let unpublished = false;
  let closed = false;
  let publishedAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    cancel();
    if (closed || !unpublished || latest === undefined) return;
    unpublished = false;
    publishedAt = Date.now();
    publish(latest);
  };
  return {
    offer: (value, urgency) => {
      if (closed) return;
      latest = value;
      unpublished = true;
      const wait = remainingWait(urgency, publishedAt + REMOTE_INVENTORY_PROGRESS_INTERVAL_MS);
      if (wait <= 0) {
        flush();
        return;
      }
      if (timer !== undefined) return;
      timer = setTimeout(flush, wait);
    },
    latest: () => latest,
    close: () => {
      closed = true;
      cancel();
    },
  };
}

function remainingWait(urgency: RemoteInventoryProgressUrgency, dueAt: number): number {
  switch (urgency) {
    case "immediate":
      return 0;
    case "coalesced":
      return dueAt - Date.now();
    default:
      return unsupportedUrgency(urgency);
  }
}

function unsupportedUrgency(urgency: never): never {
  throw new TypeError(`Unsupported remote inventory progress urgency: ${String(urgency)}.`);
}
