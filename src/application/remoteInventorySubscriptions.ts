import type { RemoteRunnerGateway, RemoteRunnerInventoryEvent } from "../domain/remoteRunner";

/** Setup retries are owned here; reconnects after successful setup belong to the gateway. */
export function subscribeRemoteInventory(
  watch: NonNullable<RemoteRunnerGateway["watchInventory"]>,
  serverId: string,
  listener: (event: RemoteRunnerInventoryEvent) => void,
): () => void {
  let disposed = false;
  let delay = 5_000;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let revoke = () => {};
  let unsubscribe: (() => void) | undefined;
  const attempt = async () => {
    if (disposed) return;
    let current = true;
    revoke = () => {
      current = false;
    };
    try {
      const stop = await watch({ serverId }, (event) => {
        if (!disposed && current) listener(event);
      });
      if (disposed || !current) stop();
      else unsubscribe = stop;
    } catch {
      current = false;
      if (disposed) return;
      listener({ type: "disconnected" });
      retry = setTimeout(() => {
        retry = undefined;
        void attempt();
      }, delay);
      delay = Math.min(delay * 2, 30_000);
    }
  };
  void attempt();
  return () => {
    disposed = true;
    revoke();
    if (retry !== undefined) clearTimeout(retry);
    unsubscribe?.();
  };
}
