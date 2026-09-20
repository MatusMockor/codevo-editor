import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RemoteRunnerGateway,
  RemoteRunnerPendingMessage,
  RemoteRunnerServer,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import {
  emptyRemoteInventory,
  loadRemoteAgentInventory,
  RemoteInventoryRevoked,
  retainRemoteInventoryTasks,
  type RemoteAgentInventorySnapshot,
} from "./remoteAgentInventoryLoad";
import { mergeRemoteTasks } from "./remoteRunnerTaskState";
import { startRemoteInventoryRefresh } from "./remoteInventoryRefresh";
export type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
interface Options {
  readonly gateway: RemoteRunnerGateway | null;
  readonly servers: readonly RemoteRunnerServer[];
  readonly workspaceOwner: string | null;
  readonly selectedThreadId: string | null;
}
export type RemotePendingUpdate =
  | readonly RemoteRunnerPendingMessage[]
  | ((items: readonly RemoteRunnerPendingMessage[]) => readonly RemoteRunnerPendingMessage[]);
export interface RemoteAgentInventorySurface {
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly loading: boolean;
  refresh(): Promise<void>;
  publishTask(serverId: string, task: RemoteRunnerTask): void;
  publishPending(serverId: string, threadId: string, items: RemotePendingUpdate): void;
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
  const pendingRevisions = useRef(new Map<string, number>());
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
  const active = useRef<{ owner: object; settled: Promise<void>; dirty: boolean } | null>(null);
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
          .map((item) => {
            const tasks = retainRemoteInventoryTasks(item.tasks, item.serverId, selectedThreadId);
            return {
              ...item,
              tasks,
              historyWindowed: item.historyWindowed || tasks.length !== item.tasks.length,
            };
          }),
      };
      for (const id of provenance.current.keys())
        if (!configured.has(id)) provenance.current.delete(id);
      for (const id of pendingRevisions.current.keys())
        if (!configured.has(id)) pendingRevisions.current.delete(id);
      setState(cache.current);
    },
    [valid, lease, selectedThreadId],
  );
  const refresh = useCallback(async () => {
    if (!valid() || gateway === null) return;
    if (active.current?.owner === captured) {
      active.current.dirty = true;
      await active.current.settled;
      return;
    }
    let settle!: () => void;
    const operation = {
      owner: captured,
      dirty: false,
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };
    active.current = operation;
    setLoadingOwner(captured);
    try {
      do {
        operation.dirty = false;
        for (const server of serversRef.current.slice(0, 64)) {
          if (!valid()) return;
          const previous =
            cache.current.snapshots.find((item) => item.serverId === server.id) ??
            emptyRemoteInventory(server.id, server.connected);
          if (!server.connected) {
            publish([
              ...cache.current.snapshots.filter((item) => item.serverId !== server.id),
              {
                ...previous,
                connected: false,
                inventoryTruncated: false,
                error: "Server disconnected.",
              },
            ]);
            continue;
          }
          const pendingRevision = pendingRevisions.current.get(server.id) ?? 0;
          let result: RemoteAgentInventorySnapshot;
          try {
            result = await loadRemoteAgentInventory(gateway, previous, selectedThreadId, valid);
            if (!valid()) return;
          } catch (error) {
            if (!valid() || error instanceof RemoteInventoryRevoked) return;
            result = {
              ...previous,
              connected: false,
              inventoryTruncated: false,
              error: error instanceof Error ? error.message : "Could not refresh remote tasks.",
            };
          }
          provenance.current.set(server.id, endpoint(server));
          const latest = cache.current.snapshots.find((item) => item.serverId === server.id);
          publish([
            ...cache.current.snapshots.filter((item) => item.serverId !== server.id),
            {
              ...result,
              tasks: mergeRemoteTasks(result.tasks, latest?.tasks ?? []),
              pendingMessages:
                pendingRevision === (pendingRevisions.current.get(server.id) ?? 0)
                  ? result.pendingMessages
                  : latest?.pendingMessages,
            },
          ]);
        }
      } while (operation.dirty && valid());
    } finally {
      if (active.current === operation) active.current = null;
      settle();
      if (valid()) setLoadingOwner(null);
    }
  }, [valid, gateway, captured, selectedThreadId, publish]);
  useEffect(() => {
    mounted.current = true;
    const stop = startRemoteInventoryRefresh({
      gateway,
      serverIds: serversRef.current.filter((server) => server.connected).map((server) => server.id),
      refresh,
    });
    return () => {
      mounted.current = false;
      stop();
    };
  }, [refresh, gateway]);
  useEffect(() => {
    if (state.lease !== lease || !state.snapshots.some((snapshot) => snapshot.inventoryTruncated))
      return;
    const timer = setTimeout(() => {
      void refresh();
    }, 250);
    return () => clearTimeout(timer);
  }, [state, lease, refresh]);
  const publishTask = useCallback(
    (serverId: string, task: RemoteRunnerTask) => {
      if (!valid()) return;
      const previous = cache.current.snapshots.find((item) => item.serverId === serverId);
      if (!previous || previous.descriptor?.runnerId !== task.runnerId) return;
      publish(
        cache.current.snapshots.map((item) =>
          item === previous ? { ...item, tasks: mergeRemoteTasks(item.tasks, [task]) } : item,
        ),
      );
    },
    [valid, publish],
  );
  const publishPending = useCallback(
    (serverId: string, threadId: string, items: RemotePendingUpdate) => {
      if (!valid()) return;
      pendingRevisions.current.set(serverId, (pendingRevisions.current.get(serverId) ?? 0) + 1);
      publish(
        cache.current.snapshots.map((snapshot) => {
          if (snapshot.serverId !== serverId) return snapshot;
          const pendingMessages = new Map(snapshot.pendingMessages);
          pendingMessages.set(
            threadId,
            typeof items === "function" ? items(pendingMessages.get(threadId) ?? []) : items,
          );
          return { ...snapshot, pendingMessages };
        }),
      );
    },
    [valid, publish],
  );
  return {
    publishPending,
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
