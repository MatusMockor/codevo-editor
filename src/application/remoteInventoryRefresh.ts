import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import { subscribeRemoteInventory } from "./remoteInventorySubscriptions";

export type RemoteInventoryRefreshOutcome = "settled" | "recovering";

interface Options {
  readonly gateway: RemoteRunnerGateway | null;
  readonly serverIds: readonly string[];
  readonly refresh: () => Promise<RemoteInventoryRefreshOutcome>;
}

const RECOVERY_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000, 30_000];

function recoveryAttempts(outcome: RemoteInventoryRefreshOutcome, attempts: number): number {
  switch (outcome) {
    case "settled":
      return 0;
    case "recovering":
      return Math.min(attempts + 1, RECOVERY_DELAYS_MS.length);
    default:
      return unsupportedOutcome(outcome);
  }
}

function unsupportedOutcome(outcome: never): never {
  throw new TypeError(`Unsupported remote inventory refresh outcome: ${String(outcome)}.`);
}

/** One owned refresh queue: event bursts retain a dirty bit, never an unbounded queue. */
export function startRemoteInventoryRefresh({ gateway, serverIds, refresh }: Options): () => void {
  let disposed = false;
  let running = false;
  let dirty = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const live = new Set<string>();
  const subscriptions = new Set<() => void>();
  const ids = [...new Set(serverIds)].slice(0, 64);
  const delay = () => {
    if (ids.length === 0 || live.size !== ids.length) return 2_000;
    return RECOVERY_DELAYS_MS[attempts - 1] ?? 60_000;
  };
  const schedule = (milliseconds: number) => {
    if (disposed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, milliseconds);
  };
  const run = async () => {
    if (disposed) return;
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    dirty = false;
    try {
      attempts = recoveryAttempts(await refresh(), attempts);
    } catch {
      // The inventory owns its error display. A rejected refresh must not end recovery.
      attempts = recoveryAttempts("recovering", attempts);
    } finally {
      running = false;
      if (!disposed) schedule(dirty ? 250 : delay());
    }
  };
  const invalidate = () => {
    if (disposed) return;
    if (running) dirty = true;
    else if (!dirty) {
      dirty = true;
      schedule(250);
    }
  };
  for (const serverId of ids) {
    if (!gateway?.watchInventory) break;
    subscriptions.add(
      subscribeRemoteInventory(gateway.watchInventory.bind(gateway), serverId, (event) => {
        if (disposed) return;
        if (event.type === "connected") live.add(serverId);
        else if (event.type === "disconnected") live.delete(serverId);
        invalidate();
      }),
    );
  }

  void run();
  return () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    for (const unsubscribe of subscriptions) {
      try {
        unsubscribe();
      } catch {
        // Independent subscriptions must all relinquish ownership even if one fails.
      }
    }
    subscriptions.clear();
  };
}
