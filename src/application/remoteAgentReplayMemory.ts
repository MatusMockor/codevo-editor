import type {
  RemoteRunnerServer,
  RemoteRunnerTask,
  RemoteRunnerTaskResume,
} from "../domain/remoteRunner";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { remoteAgentThreadKey } from "./remoteAgentProjection";
import {
  priorRemoteTaskReplay,
  remoteReplayIndex,
  remoteReplayOutputDiscarded,
  remoteTaskReplayUnread,
  type RemoteTaskReplay,
} from "./remoteAgentTaskReplay";
import { REMOTE_OUTPUT_DISCARDED_ERROR } from "./remoteAgentReplayWindow";

export const MAX_REMOTE_REPLAY_MEMORY_THREADS = 8;
export const MAX_REMOTE_REPLAY_MEMORY_BYTES = 32 * 1024 * 1024;

export type RemoteReplayTaskIdentity = Pick<
  RemoteRunnerTask,
  | "id"
  | "runnerId"
  | "conversationId"
  | "parentTaskId"
  | "provider"
  | "createdAt"
  | "sequence"
  | "status"
  | "projectId"
  | "isolation"
>;

export interface RemoteReplayMemoryTask {
  readonly identity: RemoteReplayTaskIdentity;
  readonly replay: RemoteTaskReplay;
  readonly resume?: RemoteRunnerTaskResume;
}

export interface RemoteReplayMemoryEntry {
  readonly serverId: string;
  readonly endpoint: string;
  readonly runnerId: string;
  readonly threadId: string;
  readonly tasks: readonly RemoteReplayMemoryTask[];
  readonly unloadedTasks: readonly RemoteReplayTaskIdentity[];
  readonly bytes: number;
}

interface ServerProvenance {
  readonly serverId: string;
  readonly endpoint: string;
  readonly runnerId: string | null;
}

export interface RemoteReplayMemory {
  readonly lease: object;
  readonly selectedThreadId: string | null;
  readonly entries: readonly RemoteReplayMemoryEntry[];
  readonly servers: readonly ServerProvenance[];
  readonly inventories: readonly InventoryIdentity[];
}

interface InventoryIdentity {
  readonly serverId: string;
  readonly runnerId: string | undefined;
  readonly tasks: readonly RemoteRunnerTask[];
}

export interface RemoteReplayRestoreTask {
  readonly identity: RemoteReplayTaskIdentity;
  readonly kind: "retained" | "recheckTail" | "invalidated" | "missing";
}

interface ReplayMemoryInput {
  readonly lease: object;
  readonly servers: readonly RemoteRunnerServer[];
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly selectedThreadId: string | null;
  readonly excludedServerIds?: ReadonlySet<string>;
}

export const remoteReplayEndpoint = (server: RemoteRunnerServer): string =>
  JSON.stringify([server.id, server.host, server.username, server.port]);

export function createRemoteReplayMemory(lease: object): RemoteReplayMemory {
  return { lease, selectedThreadId: null, entries: [], servers: [], inventories: [] };
}

export function sameRemoteReplayTaskIdentity(
  previous: RemoteReplayTaskIdentity,
  incoming: RemoteReplayTaskIdentity,
): boolean {
  return (
    previous.id === incoming.id &&
    previous.runnerId === incoming.runnerId &&
    (previous.conversationId ?? previous.id) === (incoming.conversationId ?? incoming.id) &&
    previous.parentTaskId === incoming.parentTaskId &&
    previous.provider === incoming.provider &&
    previous.createdAt === incoming.createdAt &&
    previous.sequence === incoming.sequence &&
    previous.projectId === incoming.projectId &&
    (previous.isolation ?? "worktree") === (incoming.isolation ?? "worktree") &&
    !(terminalIdentity(previous) && !terminalIdentity(incoming))
  );
}

export function clearRemoteReplayState(
  snapshot: RemoteAgentInventorySnapshot,
): RemoteAgentInventorySnapshot {
  return {
    ...snapshot,
    ...remoteReplayIndex(new Map(), []),
    resumes: new Map(),
    replayRestore: undefined,
    replayCatchUpTaskIds: undefined,
    replayVerifiedTaskId: undefined,
    replayInvalidatedTaskIds: undefined,
    error: snapshot.error === REMOTE_OUTPUT_DISCARDED_ERROR ? null : snapshot.error,
  };
}

export function invalidateRemoteReplayMemoryServer(
  memory: RemoteReplayMemory,
  serverId: string,
): RemoteReplayMemory {
  return { ...memory, entries: memory.entries.filter((entry) => entry.serverId !== serverId) };
}

export function transitionRemoteReplayMemory(
  previous: RemoteReplayMemory,
  input: ReplayMemoryInput,
): {
  readonly memory: RemoteReplayMemory;
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly restored: boolean;
} {
  if (previous.lease !== input.lease)
    return {
      memory: {
        ...createRemoteReplayMemory(input.lease),
        selectedThreadId: input.selectedThreadId,
      },
      snapshots: [],
      restored: false,
    };
  const configured = new Map(input.servers.slice(0, 64).map((server) => [server.id, server]));
  const invalid = invalidServers(previous, configured, input.snapshots);
  const snapshots = input.snapshots
    .filter((snapshot) => configured.has(snapshot.serverId))
    .map((snapshot) =>
      invalid.has(snapshot.serverId) ? clearRemoteReplayState(snapshot) : snapshot,
    );
  const selectionChanged = previous.selectedThreadId !== input.selectedThreadId;
  const inventories = snapshots.map(({ serverId, descriptor, tasks }) => ({
    serverId,
    runnerId: descriptor?.runnerId,
    tasks,
  }));
  const entries =
    selectionChanged || invalid.size > 0 || inventoriesChanged(previous.inventories, inventories)
      ? validEntries(previous.entries, configured, snapshots, invalid)
      : previous.entries;
  const allowedEntries = entries.filter((entry) => !input.excludedServerIds?.has(entry.serverId));
  const selected = selectRememberedThread({
    previous,
    input,
    entries: allowedEntries,
    configured,
    snapshots,
  });
  const nextSnapshots = selected.snapshots;
  const servers = [...configured.values()].map((server) => ({
    serverId: server.id,
    endpoint: remoteReplayEndpoint(server),
    runnerId:
      nextSnapshots.find((snapshot) => snapshot.serverId === server.id)?.descriptor?.runnerId ??
      null,
  }));
  return {
    memory: {
      lease: input.lease,
      selectedThreadId: input.selectedThreadId,
      entries: selected.entries,
      servers,
      inventories,
    },
    snapshots: nextSnapshots,
    restored: selected.restored,
  };
}

interface SelectionInput {
  readonly previous: RemoteReplayMemory;
  readonly input: ReplayMemoryInput;
  readonly entries: readonly RemoteReplayMemoryEntry[];
  readonly configured: ReadonlyMap<string, RemoteRunnerServer>;
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
}

function selectRememberedThread({
  previous,
  input,
  entries,
  configured,
  snapshots,
}: SelectionInput) {
  const selectionChanged = previous.selectedThreadId !== input.selectedThreadId;
  const restoredEntry = selectionChanged
    ? entries.find((entry) => entry.threadId === input.selectedThreadId)
    : undefined;
  const retained = entries.filter((entry) => entry !== restoredEntry);
  const remembered =
    selectionChanged && previous.selectedThreadId !== null
      ? rememberedThread(previous.selectedThreadId, configured, snapshots, input.excludedServerIds)
      : undefined;
  const nextEntries = rememberEntry(retained, remembered);
  const selectedSnapshots = selectionChanged ? snapshots.map(clearRemoteReplayState) : snapshots;
  const nextSnapshots = restoredEntry
    ? selectedSnapshots.map((snapshot) => restoredSnapshot(snapshot, restoredEntry))
    : selectedSnapshots;
  return { entries: nextEntries, snapshots: nextSnapshots, restored: restoredEntry !== undefined };
}

function inventoriesChanged(
  previous: readonly InventoryIdentity[],
  incoming: readonly InventoryIdentity[],
): boolean {
  return (
    previous.length !== incoming.length ||
    incoming.some((inventory, index) => {
      const prior = previous[index];
      return (
        prior?.serverId !== inventory.serverId ||
        prior.runnerId !== inventory.runnerId ||
        !sameInventoryTasks(prior.tasks, inventory.tasks)
      );
    })
  );
}

function sameInventoryTasks(
  previous: readonly RemoteRunnerTask[],
  incoming: readonly RemoteRunnerTask[],
): boolean {
  if (previous === incoming) return true;
  return (
    previous.length === incoming.length &&
    incoming.every((task, index) => {
      const prior = previous[index];
      return (
        prior !== undefined &&
        prior.status === task.status &&
        sameRemoteReplayTaskIdentity(prior, task)
      );
    })
  );
}

function rememberEntry(
  entries: readonly RemoteReplayMemoryEntry[],
  entry: RemoteReplayMemoryEntry | undefined,
): readonly RemoteReplayMemoryEntry[] {
  if (!entry || entry.bytes > MAX_REMOTE_REPLAY_MEMORY_BYTES) return entries;
  return evictedEntries([...entries.filter((item) => item.threadId !== entry.threadId), entry]);
}

function invalidServers(
  memory: RemoteReplayMemory,
  configured: ReadonlyMap<string, RemoteRunnerServer>,
  snapshots: readonly RemoteAgentInventorySnapshot[],
): ReadonlySet<string> {
  const invalid = new Set<string>();
  for (const prior of memory.servers) {
    const server = configured.get(prior.serverId);
    if (!server || remoteReplayEndpoint(server) !== prior.endpoint) {
      invalid.add(prior.serverId);
      continue;
    }
    const runnerId = snapshots.find((snapshot) => snapshot.serverId === server.id)?.descriptor
      ?.runnerId;
    if (prior.runnerId !== null && runnerId !== undefined && prior.runnerId !== runnerId)
      invalid.add(server.id);
  }
  return invalid;
}

function validEntries(
  entries: readonly RemoteReplayMemoryEntry[],
  servers: ReadonlyMap<string, RemoteRunnerServer>,
  snapshots: readonly RemoteAgentInventorySnapshot[],
  invalid: ReadonlySet<string>,
): readonly RemoteReplayMemoryEntry[] {
  if (entries.length === 0) return entries;
  const rememberedServers = new Set(entries.map((entry) => entry.serverId));
  const inventories = new Map(
    snapshots
      .filter((snapshot) => rememberedServers.has(snapshot.serverId))
      .map((snapshot) => [
        snapshot.serverId,
        {
          runnerId: snapshot.descriptor?.runnerId,
          tasks: new Map(snapshot.tasks.map((task) => [task.id, task])),
        },
      ]),
  );
  return entries.filter((entry) => {
    if (invalid.has(entry.serverId)) return false;
    const server = servers.get(entry.serverId);
    if (!server || remoteReplayEndpoint(server) !== entry.endpoint) return false;
    const inventory = inventories.get(entry.serverId);
    if (!inventory || inventory.runnerId !== entry.runnerId) return false;
    return [...entry.tasks.map((record) => record.identity), ...entry.unloadedTasks].every(
      (identity) => {
        const current = inventory.tasks.get(identity.id);
        return current !== undefined && sameRemoteReplayTaskIdentity(identity, current);
      },
    );
  });
}

function rememberedThread(
  selectedThreadId: string,
  servers: ReadonlyMap<string, RemoteRunnerServer>,
  snapshots: readonly RemoteAgentInventorySnapshot[],
  excludedServerIds?: ReadonlySet<string>,
): RemoteReplayMemoryEntry | undefined {
  for (const snapshot of snapshots) {
    if (excludedServerIds?.has(snapshot.serverId)) continue;
    const server = servers.get(snapshot.serverId);
    if (!server || !snapshot.descriptor) continue;
    const tasks = snapshot.tasks
      .filter(
        (task) =>
          remoteAgentThreadKey(snapshot.serverId, task.runnerId, task.conversationId ?? task.id) ===
          selectedThreadId,
      )
      .slice(0, 64);
    const records = tasks
      .filter((task) => !remoteTaskReplayUnread(snapshot, task.id))
      .map((task) => ({
        identity: taskIdentity(task),
        replay: priorRemoteTaskReplay(snapshot, task, "backward"),
        resume: snapshot.resumes.get(task.id),
      }));
    if (records.length === 0) continue;
    const entry = {
      serverId: snapshot.serverId,
      endpoint: remoteReplayEndpoint(server),
      runnerId: snapshot.descriptor.runnerId,
      threadId: selectedThreadId,
      bytes: 0,
      tasks: records,
      unloadedTasks: tasks
        .filter((task) => remoteTaskReplayUnread(snapshot, task.id))
        .map(taskIdentity),
    };
    return { ...entry, bytes: retainedValueBytes(entry, MAX_REMOTE_REPLAY_MEMORY_BYTES) };
  }
  return undefined;
}

function taskIdentity(task: RemoteRunnerTask): RemoteReplayTaskIdentity {
  const {
    id,
    runnerId,
    conversationId,
    parentTaskId,
    provider,
    createdAt,
    sequence,
    status,
    projectId,
    isolation,
  } = task;
  return {
    id,
    runnerId,
    conversationId,
    parentTaskId,
    provider,
    createdAt,
    sequence,
    status,
    projectId,
    isolation,
  };
}

export function remoteReplayMemoryTaskBytes(task: RemoteReplayMemoryTask): number {
  return retainedValueBytes(task, MAX_REMOTE_REPLAY_MEMORY_BYTES);
}

function retainedValueBytes(value: unknown, limit: number): number {
  if (value === undefined || value === null) return 4;
  if (typeof value === "string") return 16 + 2 * value.length;
  if (typeof value === "number") return 8;
  if (typeof value === "boolean") return 4;
  if (Array.isArray(value)) {
    const values: readonly unknown[] = value;
    let bytes = 24;
    for (const item of values) {
      if (bytes > limit) return bytes;
      bytes += 8 + retainedValueBytes(item, limit - bytes - 8);
    }
    return bytes;
  }
  if (typeof value === "object") {
    let bytes = 24;
    for (const key of Object.keys(value)) {
      if (bytes > limit) return bytes;
      bytes += 8 + retainedValueBytes(key, limit - bytes - 8);
      if (bytes > limit) return bytes;
      bytes += retainedValueBytes((value as Record<string, unknown>)[key], limit - bytes);
    }
    return bytes;
  }
  throw new TypeError("Unsupported remembered replay value.");
}

function evictedEntries(
  entries: readonly RemoteReplayMemoryEntry[],
): readonly RemoteReplayMemoryEntry[] {
  let bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  let start = 0;
  while (
    entries.length - start > MAX_REMOTE_REPLAY_MEMORY_THREADS ||
    bytes > MAX_REMOTE_REPLAY_MEMORY_BYTES
  ) {
    bytes -= entries[start]!.bytes;
    start += 1;
  }
  return entries.slice(start);
}

function restoredSnapshot(
  snapshot: RemoteAgentInventorySnapshot,
  entry: RemoteReplayMemoryEntry,
): RemoteAgentInventorySnapshot {
  if (snapshot.serverId !== entry.serverId) return snapshot;
  const restore = restoredTasks(entry.tasks);
  return {
    ...snapshot,
    ...remoteReplayIndex(
      new Map(entry.tasks.map((record) => [record.identity.id, restoredReplay(record, snapshot)])),
      entry.unloadedTasks.map((identity) => identity.id),
    ),
    resumes: new Map(
      entry.tasks.flatMap((record) =>
        record.resume ? [[record.identity.id, record.resume] as const] : [],
      ),
    ),
    replayRestore: restore,
    replayCatchUpTaskIds: new Set(
      entry.tasks
        .filter(
          (record) =>
            !record.replay.complete || restore.get(record.identity.id)?.kind === "recheckTail",
        )
        .map((record) => record.identity.id),
    ),
    error: remoteReplayOutputDiscarded(
      new Map(entry.tasks.map((record) => [record.identity.id, record.replay])),
    )
      ? REMOTE_OUTPUT_DISCARDED_ERROR
      : snapshot.error,
  };
}

function restoredReplay(
  record: RemoteReplayMemoryTask,
  snapshot: RemoteAgentInventorySnapshot,
): RemoteTaskReplay {
  const current = snapshot.tasks.find((task) => task.id === record.identity.id);
  if (!terminalIdentity(record.identity) || current?.status === record.identity.status)
    return record.replay;
  return { ...record.replay, complete: false };
}

function terminalIdentity(identity: RemoteReplayTaskIdentity): boolean {
  const { status } = identity;
  switch (status) {
    case "draft":
    case "queued":
    case "running":
      return false;
    case "succeeded":
    case "failed":
    case "interrupted":
    case "cancelled":
      return true;
    default: {
      const unsupported: never = status;
      throw new TypeError(`Unsupported remote task status: ${unsupported}.`);
    }
  }
}

export function restoredTasks(
  records: readonly RemoteReplayMemoryTask[],
): ReadonlyMap<string, RemoteReplayRestoreTask> {
  const newestTerminal = records
    .filter((record) => terminalIdentity(record.identity))
    .reduce<RemoteReplayMemoryTask | undefined>(
      (latest, record) =>
        !latest || record.identity.sequence > latest.identity.sequence ? record : latest,
      undefined,
    );
  return new Map(
    records.map((record) => [
      record.identity.id,
      {
        identity: record.identity,
        kind: record === newestTerminal ? "recheckTail" : "retained",
      },
    ]),
  );
}
