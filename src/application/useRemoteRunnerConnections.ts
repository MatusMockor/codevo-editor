import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RemoteRunnerGateway,
  RemoteRunnerServer,
  RemoteRunnerServerInput,
} from "../domain/remoteRunner";

export interface RemoteRunnerConnectionsSurface {
  readonly servers: readonly RemoteRunnerServer[];
  readonly status: "loading" | "ready" | "busy" | "error";
  readonly error: string | null;
  refresh(): Promise<void>;
  connect(input: RemoteRunnerServerInput): Promise<RemoteRunnerServer | null>;
  disconnect(serverId: string): Promise<void>;
  remove(serverId: string): Promise<void>;
}

export function useRemoteRunnerConnections({
  gateway,
}: {
  readonly gateway: RemoteRunnerGateway;
}): RemoteRunnerConnectionsSurface {
  const [servers, setServers] = useState<readonly RemoteRunnerServer[]>([]);
  const [status, setStatus] = useState<RemoteRunnerConnectionsSurface["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const owner = useRef({ gateway, generation: 0 });
  if (owner.current.gateway !== gateway)
    owner.current = { gateway, generation: owner.current.generation + 1 };
  const renderOwner = owner.current;
  const mounted = useRef(false);
  const operation = useRef(0);
  const nextOperation = useCallback(() => ++operation.current, []);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current || owner.current !== renderOwner || !mounted.current) return;
    const captured = renderOwner;
    const sequence = nextOperation();
    const current = () =>
      mounted.current && owner.current === captured && operation.current === sequence;
    setStatus("loading");
    try {
      const result = await gateway.listServers();
      if (!current()) return;
      setServers(result);
      setError(null);
      setStatus("ready");
    } catch (failure) {
      if (!current()) return;
      setError(message(failure));
      setStatus("error");
    }
  }, [gateway, renderOwner, nextOperation]);
  useEffect(() => {
    mounted.current = true;
    busy.current = false;
    setServers([]);
    void refresh();
    return () => {
      mounted.current = false;
      nextOperation();
    };
  }, [refresh, nextOperation]);

  const mutate = useCallback(
    async (action: () => Promise<readonly RemoteRunnerServer[] | RemoteRunnerServer | null>) => {
      if (busy.current || !mounted.current || owner.current !== renderOwner) return null;
      const captured = renderOwner;
      const sequence = nextOperation();
      const current = () =>
        mounted.current && owner.current === captured && operation.current === sequence;
      busy.current = true;
      setStatus("busy");
      setError(null);
      try {
        const result = await action();
        if (!current()) return null;
        if (result !== null && !Array.isArray(result)) {
          const server = result as RemoteRunnerServer;
          setServers((previous) => [...previous.filter((item) => item.id !== server.id), server]);
        } else if (result !== null) setServers(result as readonly RemoteRunnerServer[]);
        setStatus("ready");
        return result;
      } catch (failure) {
        if (!current()) return null;
        setError(message(failure));
        setStatus("error");
        return null;
      } finally {
        if (current()) busy.current = false;
      }
    },
    [renderOwner, nextOperation],
  );
  const connect = useCallback(
    async (input: RemoteRunnerServerInput) => {
      const result = await mutate(() => gateway.connectServer(input));
      return result !== null && !Array.isArray(result) ? (result as RemoteRunnerServer) : null;
    },
    [gateway, mutate],
  );
  const disconnect = useCallback(
    async (serverId: string) => {
      const captured = renderOwner;
      await mutate(async () => {
        await gateway.disconnectServer({ serverId });
        if (owner.current !== captured || !mounted.current) return null;
        return gateway.listServers();
      });
    },
    [gateway, mutate, renderOwner],
  );
  const remove = useCallback(
    async (serverId: string) => {
      const captured = renderOwner;
      await mutate(async () => {
        await gateway.removeServer({ serverId });
        if (owner.current !== captured || !mounted.current) return null;
        return gateway.listServers();
      });
    },
    [gateway, mutate, renderOwner],
  );
  return { servers, status, error, refresh, connect, disconnect, remove };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The server operation failed.";
}
