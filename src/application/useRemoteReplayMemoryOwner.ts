import { useRef } from "react";
import type { RemoteRunnerServer } from "../domain/remoteRunner";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import {
  createRemoteReplayMemory,
  invalidateRemoteReplayMemoryServer,
  remoteReplayEndpoint,
  transitionRemoteReplayMemory,
} from "./remoteAgentReplayMemory";

interface Input {
  readonly servers: readonly RemoteRunnerServer[];
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly selectedThreadId: string | null;
}

interface Options extends Input {
  readonly lease: object;
  readonly authority: object;
}

function createOwner(lease: object) {
  let memory = createRemoteReplayMemory(lease);
  const excludedServers = new Map<
    string,
    { readonly endpoint: string; readonly runnerId: string | null }
  >();
  let prepared: {
    readonly authority: object;
    readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  } | null = null;
  const apply = (input: Input) => {
    const transition = transitionRemoteReplayMemory(memory, {
      ...input,
      lease,
      excludedServerIds: new Set(excludedServers.keys()),
    });
    memory = transition.memory;
    if (prepared !== null) prepared = { ...prepared, snapshots: transition.snapshots };
    return transition.snapshots;
  };
  return {
    lease,
    apply,
    prepare: (authority: object, input: Input) => {
      if (prepared?.authority === authority) return;
      prepared = { authority, snapshots: apply(input) };
    },
    invalidateServer: (authority: object, server: RemoteRunnerServer, runnerId: string | null) => {
      if (prepared?.authority !== authority) return;
      excludedServers.set(server.id, { endpoint: remoteReplayEndpoint(server), runnerId });
      memory = invalidateRemoteReplayMemoryServer(memory, server.id);
    },
    refreshSucceeded: (
      authority: object,
      server: RemoteRunnerServer,
      snapshot: RemoteAgentInventorySnapshot,
    ) => {
      if (prepared?.authority !== authority || snapshot.serverId !== server.id) return;
      const excluded = excludedServers.get(server.id);
      if (
        excluded === undefined ||
        excluded.runnerId === null ||
        excluded.endpoint !== remoteReplayEndpoint(server) ||
        excluded.runnerId !== snapshot.descriptor?.runnerId
      )
        return;
      excludedServers.delete(server.id);
    },
    restoredFor: (authority: object) =>
      prepared?.authority === authority ? prepared.snapshots : undefined,
  };
}

export function useRemoteReplayMemoryOwner(options: Options) {
  const owner = useRef<ReturnType<typeof createOwner> | null>(null);
  if (owner.current === null || owner.current.lease !== options.lease)
    owner.current = createOwner(options.lease);
  owner.current.prepare(options.authority, options);
  return owner.current;
}
