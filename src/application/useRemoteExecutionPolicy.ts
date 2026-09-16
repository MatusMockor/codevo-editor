import { useEffect, useMemo, useState } from "react";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";

export function useRemoteExecutionPolicy(
  gateway: RemoteRunnerGateway,
  serverId: string,
  connected: boolean,
): number | null {
  const owner = useMemo(() => ({ gateway, serverId, connected }), [gateway, serverId, connected]);
  const [snapshot, setSnapshot] = useState<{
    owner: typeof owner;
    timeoutMs: number | null;
  } | null>(null);
  useEffect(() => {
    let current = true;
    if (connected) {
      void gateway.getRunner({ serverId }).then(
        (descriptor) => {
          if (current) setSnapshot({ owner, timeoutMs: descriptor.executionTimeoutMs ?? null });
        },
        () => {
          if (current) setSnapshot({ owner, timeoutMs: null });
        },
      );
    }
    return () => {
      current = false;
    };
  }, [gateway, serverId, connected, owner]);
  return connected && snapshot?.owner === owner ? snapshot.timeoutMs : null;
}
