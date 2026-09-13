import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RemoteRunnerGateway,
  RemoteRunnerServer,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import {
  emptyRemoteInventory,
  loadRemoteAgentInventory,
  RemoteInventoryRevoked,
  type RemoteAgentInventorySnapshot,
} from "./remoteAgentInventoryLoad";
import { mergeRemoteTasks } from "./remoteRunnerTaskState";
export type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
interface Options {
  readonly gateway: RemoteRunnerGateway | null;
  readonly servers: readonly RemoteRunnerServer[];
  readonly workspaceOwner: string | null;
  readonly selectedThreadId: string | null;
}
export interface RemoteAgentInventorySurface {
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly loading: boolean;
  refresh(): Promise<void>;
  publishTask(serverId: string, task: RemoteRunnerTask): void;
}
/** Read-only remote inventory. Disposal revokes UI publication, never server work. */
export function useRemoteAgentInventory({
  gateway,
  servers,
  workspaceOwner,
  selectedThreadId,
}: Options): RemoteAgentInventorySurface {
  const configuration = JSON.stringify(servers);
  const endpoint = (server: RemoteRunnerServer) =>
    JSON.stringify([server.id, server.host, server.username, server.port]);
  const provenance = useRef(new Map<string, string>());
  const owner = useRef({ gateway, workspaceOwner });
  if (owner.current.gateway !== gateway || owner.current.workspaceOwner !== workspaceOwner)
    owner.current = { gateway, workspaceOwner };
  const lease = owner.current;
  const authority = useRef({ lease, configuration, selectedThreadId });
  if (
    authority.current.lease !== lease ||
    authority.current.configuration !== configuration ||
    authority.current.selectedThreadId !== selectedThreadId
  )
    authority.current = { lease, configuration, selectedThreadId };
  const captured = authority.current;
  const mounted = useRef(false);
  const cache = useRef<{ lease: object; snapshots: readonly RemoteAgentInventorySnapshot[] }>({
    lease,
    snapshots: [],
  });
  if (cache.current.lease !== lease) cache.current = { lease, snapshots: [] };
  const [state, setState] = useState(cache.current);
  const [loadingOwner, setLoadingOwner] = useState<object | null>(null);
  const active = useRef<object | null>(null);
  const serversRef = useRef(servers);
  serversRef.current = servers;
  const valid = useCallback(() => mounted.current && authority.current === captured, [captured]);
  const publish = useCallback(
    (snapshots: readonly RemoteAgentInventorySnapshot[]) => {
      if (!valid()) return;
      const configured = new Set(serversRef.current.slice(0, 64).map((server) => server.id));
      cache.current = {
        lease,
        snapshots: snapshots
          .filter((item) => configured.has(item.serverId))
          .map((item) =>
            item.tasks.length > 4096
              ? {
                  ...item,
                  tasks: item.tasks.slice(0, 4096),
                  inventoryTruncated: true,
                  connected: false,
                  error: "Remote task history exceeds the editor limit; history is incomplete.",
                }
              : item,
          ),
      };
      for (const id of provenance.current.keys())
        if (!configured.has(id)) provenance.current.delete(id);
      setState(cache.current);
    },
    [valid, lease],
  );
  const refresh = useCallback(async () => {
    if (!valid() || gateway === null || active.current === captured) return;
    active.current = captured;
    setLoadingOwner(captured);
    try {
      for (const server of serversRef.current.slice(0, 64)) {
        if (!valid()) return;
        const previous =
          cache.current.snapshots.find((item) => item.serverId === server.id) ??
          emptyRemoteInventory(server.id, server.connected);
        if (!server.connected) {
          publish([
            ...cache.current.snapshots.filter((item) => item.serverId !== server.id),
            { ...previous, connected: false, error: "Server disconnected." },
          ]);
          continue;
        }
        let result: RemoteAgentInventorySnapshot;
        try {
          result = await loadRemoteAgentInventory(gateway, previous, selectedThreadId, valid);
          if (!valid()) return;
        } catch (error) {
          if (!valid() || error instanceof RemoteInventoryRevoked) return;
          result = {
            ...previous,
            connected: false,
            error: error instanceof Error ? error.message : "Could not refresh remote tasks.",
          };
        }
        provenance.current.set(server.id, endpoint(server));
        const latest = cache.current.snapshots.find((item) => item.serverId === server.id);
        publish([
          ...cache.current.snapshots.filter((item) => item.serverId !== server.id),
          { ...result, tasks: mergeRemoteTasks(result.tasks, latest?.tasks ?? []) },
        ]);
      }
    } finally {
      if (active.current === captured) active.current = null;
      if (valid()) setLoadingOwner(null);
    }
  }, [valid, gateway, captured, selectedThreadId, publish]);
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      await refresh();
      if (!disposed) timer = setTimeout(() => void tick(), 2000);
    };
    void tick();
    return () => {
      disposed = true;
      mounted.current = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [refresh]);
  const publishTask = useCallback(
    (serverId: string, task: RemoteRunnerTask) => {
      if (!valid()) return;
      const previous = cache.current.snapshots.find((item) => item.serverId === serverId);
      if (!previous || previous.descriptor?.runnerId !== task.runnerId) return;
      if (previous.tasks.length >= 4096 && !previous.tasks.some((item) => item.id === task.id)) {
        publish(
          cache.current.snapshots.map((item) =>
            item === previous
              ? {
                  ...item,
                  connected: false,
                  error: "Remote task history exceeds the editor limit; history is incomplete.",
                }
              : item,
          ),
        );
        return;
      }
      publish(
        cache.current.snapshots.map((item) =>
          item === previous ? { ...item, tasks: mergeRemoteTasks(item.tasks, [task]) } : item,
        ),
      );
    },
    [valid, publish],
  );
  return {
    snapshots:
      state.lease === lease
        ? state.snapshots
            .filter((item) => servers.some((server) => server.id === item.serverId))
            .map((item) => {
              const server = servers.find((server) => server.id === item.serverId)!;
              return !server.connected || provenance.current.get(server.id) !== endpoint(server)
                ? { ...item, connected: false, error: "Server disconnected or connection changed." }
                : item;
            })
        : [],
    loading: loadingOwner === captured,
    refresh,
    publishTask,
  };
}
