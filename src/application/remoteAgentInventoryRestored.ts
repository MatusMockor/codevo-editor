import { isRemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { isRemoteTaskTerminal } from "./remoteRunnerTaskState";
import {
  sameRemoteReplayTaskIdentity,
  type RemoteReplayRestoreTask,
} from "./remoteAgentReplayMemory";

interface RestoreVerification {
  readonly gateway: RemoteRunnerGateway;
  readonly previous: RemoteAgentInventorySnapshot;
  readonly runnerId: string;
  readonly check: () => void;
  readonly invalidatedProgress?: (snapshot: RemoteAgentInventorySnapshot) => void;
}

export async function verifyRestoredRemoteInventory({
  gateway,
  previous,
  runnerId,
  check,
  invalidatedProgress,
}: RestoreVerification): Promise<RemoteAgentInventorySnapshot> {
  const initial = {
    ...previous,
    replayInvalidatedTaskIds: undefined,
    replayVerifiedTaskId: undefined,
  };
  const newest = previous.tasks
    .filter((task) => {
      const record = previous.replayRestore?.get(task.id);
      return record !== undefined && needsRestoreVerification(record);
    })
    .reduce<RemoteRunnerTask | undefined>(
      (latest, task) => (!latest || task.sequence > latest.sequence ? task : latest),
      undefined,
    );
  if (!newest) return initial;
  const detail = await restoredTaskDetail(gateway, previous.serverId, newest.id, check);
  check();
  const tasks = matchesRestoredTask(detail, newest.id, runnerId)
    ? previous.tasks.map((task) => (task.id === newest.id ? detail : task))
    : previous.tasks.filter((task) => task.id !== newest.id);
  const updated = { ...initial, tasks, replayVerifiedTaskId: detail?.id };
  if (
    matchesRestoredTask(detail, newest.id, runnerId) &&
    sameRemoteReplayTaskIdentity(previous.replayRestore?.get(newest.id)?.identity ?? newest, detail)
  )
    return unsettledTerminalReplay(updated, newest, detail);
  const invalidated = new Set(previous.replayRestore?.keys());
  const retainedTasks = tasks.filter((task) => !invalidated.has(task.id) || task === detail);
  const cleared = {
    ...clearedRestoredReplay(updated, retainedTasks, invalidated),
    listingCursor: 0,
  };
  const result = detail
    ? cleared
    : {
        ...cleared,
        replayRestore: new Map([
          ...(cleared.replayRestore ?? []),
          [
            newest.id,
            {
              identity: previous.replayRestore?.get(newest.id)?.identity ?? newest,
              kind: "missing" as const,
            },
          ],
        ]),
      };
  check();
  invalidatedProgress?.(result);
  check();
  return result;
}

export function listedRestoredRemoteInventory(
  previous: RemoteAgentInventorySnapshot,
  incoming: readonly RemoteRunnerTask[],
): RemoteAgentInventorySnapshot {
  if (!previous.replayRestore?.size) return previous;
  const listed = new Map(incoming.map((task) => [task.id, task]));
  const changed = previous.tasks.filter((task) => {
    const current = listed.get(task.id);
    return current && !sameRemoteReplayTaskIdentity(task, current);
  });
  const tasks = previous.tasks.map((task) => {
    const current = listed.get(task.id);
    if (!current) return task;
    if (!sameRemoteReplayTaskIdentity(task, current)) return current;
    if (task.status === current.status) return task;
    return { ...task, status: current.status };
  });
  const updated = { ...previous, tasks };
  if (changed.length > 0)
    return clearedRestoredReplay(
      updated,
      tasks,
      new Set([...previous.replayRestore.keys(), ...changed.map((task) => task.id)]),
    );
  return previous.tasks.reduce<RemoteAgentInventorySnapshot>((snapshot, task) => {
    const current = listed.get(task.id);
    return current ? unsettledTerminalReplay(snapshot, task, current) : snapshot;
  }, updated);
}

export function retainedRestoredTaskListing(
  previous: RemoteAgentInventorySnapshot,
  incoming: readonly RemoteRunnerTask[],
): readonly RemoteRunnerTask[] {
  return incoming.filter((task) => {
    const record = previous.replayRestore?.get(task.id);
    if (record === undefined) return true;
    switch (record.kind) {
      case "missing":
        return !sameRemoteReplayTaskIdentity(record.identity, task);
      case "retained":
      case "recheckTail":
      case "invalidated":
        return true;
      default:
        return unsupportedRestoreKind(record.kind);
    }
  });
}

function unsettledTerminalReplay(
  snapshot: RemoteAgentInventorySnapshot,
  remembered: RemoteRunnerTask,
  current: RemoteRunnerTask,
): RemoteAgentInventorySnapshot {
  if (!isRemoteTaskTerminal(remembered) || remembered.status === current.status) return snapshot;
  return {
    ...snapshot,
    replayComplete: new Set([...snapshot.replayComplete].filter((id) => id !== current.id)),
  };
}

function clearedRestoredReplay(
  previous: RemoteAgentInventorySnapshot,
  tasks: readonly RemoteRunnerTask[],
  invalidated: ReadonlySet<string>,
): RemoteAgentInventorySnapshot {
  return {
    ...previous,
    tasks,
    detailedTaskIds: retainedIds(previous.detailedTaskIds, invalidated),
    replayRestore: new Map(
      [...(previous.replayRestore ?? [])].map(([id, record]) => [
        id,
        invalidated.has(id) ? invalidatedRestoreTask(record) : record,
      ]),
    ),
    replayInvalidatedTaskIds: new Set(invalidated),
    replayCatchUpTaskIds: retainedIds(previous.replayCatchUpTaskIds, invalidated),
    replays: retainedEntries(previous.replays, invalidated),
    resumes: retainedEntries(previous.resumes, invalidated),
    replayCursors: retainedEntries(previous.replayCursors, invalidated),
    replayBackfill: retainedEntries(previous.replayBackfill, invalidated),
    subagentLifecycles: retainedEntries(previous.subagentLifecycles, invalidated),
    replayGaps: retainedEntries(previous.replayGaps, invalidated),
    replayComplete: retainedIds(previous.replayComplete, invalidated),
    replayTruncated: retainedIds(previous.replayTruncated, invalidated),
    replayDiscarded: retainedIds(previous.replayDiscarded, invalidated),
    replayServerEvictions: retainedEntries(previous.replayServerEvictions, invalidated),
  };
}

async function restoredTaskDetail(
  gateway: RemoteRunnerGateway,
  serverId: string,
  taskId: string,
  check: () => void,
): Promise<RemoteRunnerTask | undefined> {
  try {
    check();
    const detail = await gateway.getTask({ serverId, taskId });
    check();
    return detail;
  } catch (error) {
    check();
    if (
      isRemoteRunnerRequestRejectedError(error) &&
      error.message === "Runner request failed (HTTP 404)."
    )
      return undefined;
    throw error;
  }
}

function retainedEntries<T>(
  source: ReadonlyMap<string, T> | undefined,
  invalidated: ReadonlySet<string>,
): ReadonlyMap<string, T> {
  return new Map([...(source ?? [])].filter(([taskId]) => !invalidated.has(taskId)));
}

function retainedIds(
  source: ReadonlySet<string> | undefined,
  invalidated: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set([...(source ?? [])].filter((taskId) => !invalidated.has(taskId)));
}

function matchesRestoredTask(
  detail: RemoteRunnerTask | undefined,
  taskId: string,
  runnerId: string,
): detail is RemoteRunnerTask {
  return detail !== undefined && detail.id === taskId && detail.runnerId === runnerId;
}

function needsRestoreVerification(record: RemoteReplayRestoreTask): boolean {
  switch (record.kind) {
    case "retained":
    case "recheckTail":
      return true;
    case "invalidated":
    case "missing":
      return false;
    default:
      return unsupportedRestoreKind(record.kind);
  }
}

function invalidatedRestoreTask(record: RemoteReplayRestoreTask): RemoteReplayRestoreTask {
  switch (record.kind) {
    case "missing":
      return record;
    case "retained":
    case "recheckTail":
    case "invalidated":
      return { ...record, kind: "invalidated" };
    default:
      return unsupportedRestoreKind(record.kind);
  }
}

function unsupportedRestoreKind(kind: never): never {
  throw new Error(`Unsupported replay restore state: ${kind}`);
}
