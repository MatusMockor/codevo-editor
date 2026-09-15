import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import { subscribeRemoteInventory } from "./remoteInventorySubscriptions";

interface Options {
  readonly gateway: RemoteRunnerGateway | null;
  readonly serverIds: readonly string[];
  readonly refresh: () => Promise<void>;
}

/** One owned refresh queue: event bursts retain a dirty bit, never an unbounded queue. */
export function startRemoteInventoryRefresh({ gateway, serverIds, refresh }: Options): () => void {
  let disposed = false;
  let running = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const live = new Set<string>();
  const subscriptions = new Set<() => void>();
  const ids = [...new Set(serverIds)].slice(0, 64);
  const delay = () => (ids.length > 0 && live.size === ids.length ? 60_000 : 2_000);
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
      await refresh();
    } catch {
      // The inventory owns its error display. A rejected refresh must not end recovery.
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
