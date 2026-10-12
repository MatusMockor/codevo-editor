import type { RemoteRunnerServer, RemoteRunnerTask } from "../domain/remoteRunner";
import {
  remoteRunnerReachability,
  REMOTE_RUNNER_REACHABLE,
  type RemoteRunnerReachability,
} from "../domain/remoteRunnerReachability";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { remoteReplayEndpoint } from "./remoteAgentReplayMemory";
import { mergeRemoteTasks } from "./remoteRunnerTaskState";

export interface ObservedRefresh {
  readonly reachability: RemoteRunnerReachability;
  readonly reason: string | null;
}
export interface RefreshObservation extends ObservedRefresh {
  readonly serverId: string;
}
export interface LeasedInventory {
  readonly lease: object;
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly observed: ReadonlyMap<string, ObservedRefresh>;
}
export const NO_OBSERVATIONS: ReadonlyMap<string, ObservedRefresh> = new Map();
export const REACHABLE_REFRESH: ObservedRefresh = {
  reachability: REMOTE_RUNNER_REACHABLE,
  reason: null,
};
function sameObservation(left: ObservedRefresh | undefined, right: ObservedRefresh): boolean {
  return left?.reachability === right.reachability && left.reason === right.reason;
}
export function observedRefreshes(
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
interface PresentationOptions {
  readonly inventory: LeasedInventory;
  readonly lease: object;
  readonly servers: readonly RemoteRunnerServer[];
  readonly provenance: ReadonlyMap<string, string>;
}

export function presentRemoteInventory({
  inventory,
  lease,
  servers,
  provenance,
}: PresentationOptions) {
  const reachability = new Map<string, RemoteRunnerReachability>();
  const reconnectingReasons = new Map<string, string>();
  if (inventory.lease !== lease) return { reachability, reconnectingReasons, snapshots: [] };
  for (const server of servers.slice(0, 64)) {
    if (!inventory.snapshots.some((item) => item.serverId === server.id)) continue;
    const observed = inventory.observed.get(server.id);
    const current = remoteRunnerReachability({
      serverConnected: server.connected,
      connectionCurrent: provenance.get(server.id) === remoteReplayEndpoint(server),
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
  const snapshots = inventory.snapshots
    .filter((item) => servers.some((server) => server.id === item.serverId))
    .map((item) => {
      const server = servers.find((server) => server.id === item.serverId)!;
      if (!server.connected || provenance.get(server.id) !== remoteReplayEndpoint(server))
        return { ...item, connected: false, error: "Server disconnected or connection changed." };
      return item;
    });
  return { reachability, reconnectingReasons, snapshots };
}

function sameTaskReferences(
  left: readonly RemoteRunnerTask[],
  right: readonly RemoteRunnerTask[],
): boolean {
  return left.length === right.length && left.every((task, index) => task === right[index]);
}

export function mergePublishedRemoteTasks(
  shown: RemoteAgentInventorySnapshot,
  latest: RemoteAgentInventorySnapshot | undefined,
): readonly RemoteRunnerTask[] {
  const merged = mergeRemoteTasks(
    shown.tasks,
    (latest?.tasks ?? []).filter(
      (task) =>
        task.runnerId === shown.descriptor?.runnerId &&
        !shown.replayInvalidatedTaskIds?.has(task.id),
    ),
  );
  if (sameTaskReferences(merged, shown.tasks)) return shown.tasks;
  if (latest !== undefined && sameTaskReferences(merged, latest.tasks)) return latest.tasks;
  return merged;
}
