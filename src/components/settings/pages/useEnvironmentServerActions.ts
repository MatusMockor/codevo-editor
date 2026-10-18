import { useEffect, useRef, useState } from "react";
import type { RemoteRunnerConnectionsSurface } from "../../../application/useRemoteRunnerConnections";
import type { RemoteRunnerGateway, RemoteRunnerServer } from "../../../domain/remoteRunner";
import type { EnvironmentServerAttemptPhase } from "./environmentServerStatus";

export type EnvironmentServerActionsSurface = Pick<
  RemoteRunnerConnectionsSurface,
  "connect" | "disconnect" | "remove"
> & {
  readonly gateway: RemoteRunnerGateway;
};

interface ActionsOwner {
  readonly gateway: RemoteRunnerGateway | null;
}

interface ServerConnectionAttempt {
  readonly owner: ActionsOwner;
  readonly serverId: string;
  readonly phase: Exclude<EnvironmentServerAttemptPhase, "idle">;
}

export interface EnvironmentServerActions {
  phaseOf(serverId: string): EnvironmentServerAttemptPhase;
  resetAttempt(): void;
  connect(server: RemoteRunnerServer): void;
  disconnect(serverId: string): void;
  remove(serverId: string): void;
}

export function useEnvironmentServerActions(
  remote: EnvironmentServerActionsSurface | null,
): EnvironmentServerActions {
  const gateway = remote?.gateway ?? null;
  const [attempt, setAttempt] = useState<ServerConnectionAttempt | null>(null);
  const owner = useRef<ActionsOwner>({ gateway });
  if (owner.current.gateway !== gateway) owner.current = { gateway };
  const renderOwner = owner.current;
  const sequence = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const supersede = () => {
    sequence.current += 1;
    setAttempt(null);
  };

  const connect = async (server: RemoteRunnerServer) => {
    if (!remote) return;
    const captured = ++sequence.current;
    const current = () =>
      mounted.current && owner.current === renderOwner && sequence.current === captured;
    setAttempt({ owner: renderOwner, serverId: server.id, phase: "connecting" });
    const connected = await remote.connect({
      id: server.id,
      name: server.name,
      host: server.host,
      username: server.username,
      port: server.port,
    });
    if (!current()) return;
    setAttempt(connected ? null : { owner: renderOwner, serverId: server.id, phase: "failed" });
  };

  return {
    phaseOf: (serverId) =>
      attempt?.owner === renderOwner && attempt.serverId === serverId ? attempt.phase : "idle",
    resetAttempt: supersede,
    connect: (server) => {
      void connect(server);
    },
    disconnect: (serverId) => {
      if (!remote) return;
      supersede();
      void remote.disconnect(serverId);
    },
    remove: (serverId) => {
      if (!remote) return;
      supersede();
      void remote.remove(serverId);
    },
  };
}
