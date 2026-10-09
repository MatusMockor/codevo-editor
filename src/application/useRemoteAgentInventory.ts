import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  RemoteRunnerGateway,
  RemoteRunnerPendingMessage,
  RemoteRunnerServer,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import type { RemoteThreadMetadata } from "../domain/remoteThreadMetadata";
import { remoteRunnerErrorMessage } from "../domain/remoteRunnerErrors";
import {
  remoteRunnerFailureReason,
  remoteRunnerReachability,
  remoteRunnerRefreshReachability,
  REMOTE_RUNNER_REACHABLE,
  REMOTE_RUNNER_RECONNECTING,
  type RemoteRunnerReachability,
} from "../domain/remoteRunnerReachability";
import {
  emptyRemoteInventory,
  loadRemoteAgentInventory,
  RemoteInventoryRevoked,
  retainRemoteInventoryTasks,
  type RemoteAgentInventorySnapshot,
} from "./remoteAgentInventoryLoad";
import { mergeRemoteTasks } from "./remoteRunnerTaskState";
import { startRemoteInventoryRefresh } from "./remoteInventoryRefresh";
import { probeRemoteRunnerDescriptor } from "./remoteRunnerDescriptorProbe";
import {
  mergeLoadedThreadMetadata,
  publishedRemoteThreadMetadata,
} from "./remoteThreadMetadataInventory";
export type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
interface Options {
  readonly gateway: RemoteRunnerGateway | null;
  readonly servers: readonly RemoteRunnerServer[];
  readonly workspaceOwner: string | null;
  readonly selectedThreadId: string | null;
}
interface ObservedRefresh {
  readonly reachability: RemoteRunnerReachability;
  readonly reason: string | null;
}
interface RefreshObservation extends ObservedRefresh {
  readonly serverId: string;
}
interface LeasedInventory {
  readonly lease: object;
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly observed: ReadonlyMap<string, ObservedRefresh>;
}
const NO_OBSERVATIONS: ReadonlyMap<string, ObservedRefresh> = new Map();
const endpoint = (server: RemoteRunnerServer) =>
  JSON.stringify([server.id, server.host, server.username, server.port]);
function sameObservation(left: ObservedRefresh | undefined, right: ObservedRefresh): boolean {
  return left?.reachability === right.reachability && left.reason === right.reason;
}
function observedRefreshes(
  previous: ReadonlyMap<string, ObservedRefresh>,
  configured: ReadonlySet<string>,
  observation: RefreshObservation | undefined,
): ReadonlyMap<string, ObservedRefresh> {
  const stale = [...previous.keys()].some((id) => !configured.has(id));
  const unchanged =
    observation === undefined ||
    !configured.has(observation.serverId) ||
    sameObservation(previous.get(observation.serverId), observation);
  if (!stale && unchanged) return previous;
  const next = new Map([...previous].filter(([id]) => configured.has(id)));
  if (observation !== undefined && configured.has(observation.serverId))
    next.set(observation.serverId, {
      reachability: observation.reachability,
      reason: observation.reason,
    });
  return next;
}
export type RemotePendingUpdate =
  | readonly RemoteRunnerPendingMessage[]
  | ((items: readonly RemoteRunnerPendingMessage[]) => readonly RemoteRunnerPendingMessage[]);
export interface RemoteAgentInventorySurface {
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly reachability: ReadonlyMap<string, RemoteRunnerReachability>;
  readonly reconnectingReasons: ReadonlyMap<string, string>;
  readonly loading: boolean;
  refresh(): Promise<void>;
  publishTask(serverId: string, task: RemoteRunnerTask): void;
  publishPending(serverId: string, threadId: string, items: RemotePendingUpdate): void;
  publishThreadMetadata(serverId: string, metadata: RemoteThreadMetadata): boolean;
}
/** Read-only remote inventory. Disposal revokes UI publication, never server work. */
export function useRemoteAgentInventory({
  gateway,
  servers,
  workspaceOwner,
  selectedThreadId,
}: Options): RemoteAgentInventorySurface {
  const configuration = JSON.stringify(servers);
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
  const cache = useRef<LeasedInventory>({ lease, snapshots: [], observed: NO_OBSERVATIONS });
  if (cache.current.lease !== lease)
    cache.current = { lease, snapshots: [], observed: NO_OBSERVATIONS };
  const unconfirmed = useRef({
    lease,
    configuration,
    servers: new Map<string, ReadonlyMap<string, RemoteThreadMetadata>>(),
  });
  if (unconfirmed.current.lease !== lease || unconfirmed.current.configuration !== configuration)
    unconfirmed.current = { lease, configuration, servers: new Map() };
  const [state, setState] = useState(cache.current);
  const [loadingOwner, setLoadingOwner] = useState<object | null>(null);
  const active = useRef<{ owner: object; settled: Promise<void>; dirty: boolean } | null>(null);
  const serversRef = useRef(servers);
  serversRef.current = servers;
  const valid = useCallback(() => mounted.current && authority.current === captured, [captured]);
  const publish = useCallback(
    (snapshots: readonly RemoteAgentInventorySnapshot[], observation?: RefreshObservation) => {
      if (!valid()) return;
      const configured = new Set(serversRef.current.slice(0, 64).map((server) => server.id));
      cache.current = {
        lease,
        observed: observedRefreshes(cache.current.observed, configured, observation),
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
  const holdsRemovedServers = useCallback(() => {
    const configured = new Set(serversRef.current.slice(0, 64).map((server) => server.id));
    return [
      ...cache.current.snapshots.map((item) => item.serverId),
      ...cache.current.observed.keys(),
      ...provenance.current.keys(),
    ].some((id) => !configured.has(id));
  }, []);
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
        if (holdsRemovedServers()) publish(cache.current.snapshots);
        for (const server of serversRef.current.slice(0, 64)) {
          if (!valid()) return;
          const previous =
            cache.current.snapshots.find((item) => item.serverId === server.id) ??
            emptyRemoteInventory(server.id, server.connected);
          if (!server.connected) {
            publish(
              [
                ...cache.current.snapshots.filter((item) => item.serverId !== server.id),
                {
                  ...previous,
                  connected: false,
                  inventoryTruncated: false,
                  error: "Server disconnected.",
                },
              ],
              { serverId: server.id, reachability: REMOTE_RUNNER_RECONNECTING, reason: null },
            );
            continue;
          }
          const pendingRevision = pendingRevisions.current.get(server.id) ?? 0;
          const probe = probeRemoteRunnerDescriptor(gateway);
          let observed: ObservedRefresh = { reachability: REMOTE_RUNNER_REACHABLE, reason: null };
          let result: RemoteAgentInventorySnapshot;
          try {
            result = await loadRemoteAgentInventory(
              probe.gateway,
              previous,
              selectedThreadId,
              valid,
            );
            if (!valid()) return;
            const merged = mergeLoadedThreadMetadata(
              result.threadMetadata,
              unconfirmed.current.servers.get(server.id),
            );
            unconfirmed.current.servers.set(server.id, merged.unconfirmed);
            result = { ...result, threadMetadata: merged.threadMetadata };
          } catch (error) {
            if (!valid() || error instanceof RemoteInventoryRevoked) return;
            const expectedRunnerId = previous.descriptor?.runnerId ?? null;
            const followUp = await probe.followUp({ serverId: server.id }, expectedRunnerId);
            if (!valid()) return;
            observed = {
              reachability: remoteRunnerRefreshReachability({
                kind: "failed",
                error,
                expectedRunnerId,
                answeredRunnerId: probe.answeredRunnerId(),
                followUp,
              }),
              reason: remoteRunnerFailureReason(
                followUp.kind === "failed" ? followUp.error : error,
              ),
            };
            const cached = cache.current.snapshots.find((item) => item.serverId === server.id);
            result = {
              ...previous,
              threadMetadata: (cached ?? previous).threadMetadata,
              connected: false,
              inventoryTruncated: false,
              error: remoteRunnerErrorMessage(error, "Could not refresh remote tasks."),
            };
          }
          provenance.current.set(server.id, endpoint(server));
          const latest = cache.current.snapshots.find((item) => item.serverId === server.id);
          publish(
            [
              ...cache.current.snapshots.filter((item) => item.serverId !== server.id),
              {
                ...result,
                tasks: mergeRemoteTasks(result.tasks, latest?.tasks ?? []),
                pendingMessages:
                  pendingRevision === (pendingRevisions.current.get(server.id) ?? 0)
                    ? result.pendingMessages
                    : latest?.pendingMessages,
              },
            ],
            { serverId: server.id, ...observed },
          );
        }
      } while (operation.dirty && valid());
    } finally {
      if (active.current === operation) active.current = null;
      settle();
      if (valid()) setLoadingOwner(null);
    }
  }, [valid, gateway, captured, selectedThreadId, publish, holdsRemovedServers]);
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
  const publishThreadMetadata = useCallback(
    (serverId: string, metadata: RemoteThreadMetadata): boolean => {
      if (!valid()) return false;
      if (!serversRef.current.slice(0, 64).some((server) => server.id === serverId)) return false;
      const previous = cache.current.snapshots.find((item) => item.serverId === serverId);
      if (!previous) return false;
      const outcome = publishedRemoteThreadMetadata(
        previous,
        unconfirmed.current.servers.get(serverId),
        metadata,
      );
      switch (outcome.kind) {
        case "unknown":
        case "full":
          return false;
        case "current":
          return true;
        case "applied":
          publish(
            cache.current.snapshots.map((item) =>
              item === previous ? { ...item, threadMetadata: outcome.threadMetadata } : item,
            ),
          );
          unconfirmed.current.servers.set(serverId, outcome.unconfirmed);
          return true;
      }
    },
    [valid, publish],
  );
  const published = useMemo(() => {
    const reachability = new Map<string, RemoteRunnerReachability>();
    const reconnectingReasons = new Map<string, string>();
    if (state.lease !== lease) return { reachability, reconnectingReasons };
    for (const server of servers.slice(0, 64)) {
      if (!state.snapshots.some((item) => item.serverId === server.id)) continue;
      const observed = state.observed.get(server.id);
      const current = remoteRunnerReachability({
        serverConnected: server.connected,
        connectionCurrent: provenance.current.get(server.id) === endpoint(server),
        lastRefresh: observed?.reachability ?? null,
      });
      reachability.set(server.id, current);
      if (
        observed !== undefined &&
        observed.reason !== null &&
        current === observed.reachability &&
        current.kind === "reconnecting"
      )
        reconnectingReasons.set(server.id, observed.reason);
    }
    return { reachability, reconnectingReasons };
  }, [state, lease, servers]);
  return {
    publishPending,
    publishThreadMetadata,
    reachability: published.reachability,
    reconnectingReasons: published.reconnectingReasons,
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
