import type { RemoteThreadMetadata } from "../domain/remoteThreadMetadata";
import { loadRemoteThreadMetadata } from "./remoteThreadMetadataInventory";
import type { AgentSubagentLifecycle } from "@codevo/agent-events";
import type { RemoteReplayGap } from "./remoteAgentReplayWindow";
import type { RemoteReplayBackfill } from "./remoteAgentTaskReplay";
import { loadRemoteInventoryReplay } from "./remoteAgentInventoryReplay";
import {
  listedRestoredRemoteInventory,
  retainedRestoredTaskListing,
  verifyRestoredRemoteInventory,
} from "./remoteAgentInventoryRestored";
import type { RemoteReplayRestoreTask } from "./remoteAgentReplayMemory";
import type { RemoteInventoryProgressUrgency } from "./remoteInventoryProgress";
import { remoteAgentThreadKey } from "./remoteAgentProjection";
import type {
  RemoteRunnerDescriptor,
  RemoteRunnerEvent,
  RemoteRunnerGateway,
  RemoteRunnerProject,
  RemoteRunnerPendingMessage,
  RemoteRunnerTask,
  RemoteRunnerTaskResume,
} from "../domain/remoteRunner";
import {
  isRemoteTaskDetailOf,
  isRemoteTaskTerminal,
  mergeRemoteTasks,
  supersedeRemoteTask,
} from "./remoteRunnerTaskState";

export interface RemoteAgentInventorySnapshot {
  readonly serverId: string;
  readonly listingCursor: number;
  readonly inventoryTruncated?: boolean;
  readonly historyWindowed?: boolean;
  readonly detailedTaskIds?: ReadonlySet<string>;
  readonly replayRestore?: ReadonlyMap<string, RemoteReplayRestoreTask>;
  readonly replayCatchUpTaskIds?: ReadonlySet<string>;
  readonly replayVerifiedTaskId?: string;
  readonly replayInvalidatedTaskIds?: ReadonlySet<string>;
  readonly connected: boolean;
  readonly descriptor: RemoteRunnerDescriptor | null;
  readonly projects: readonly RemoteRunnerProject[];
  readonly tasks: readonly RemoteRunnerTask[];
  readonly replays: ReadonlyMap<string, readonly RemoteRunnerEvent[]>;
  readonly resumes: ReadonlyMap<string, RemoteRunnerTaskResume>;
  readonly replayCursors?: ReadonlyMap<string, number>;
  readonly replayBackfill?: ReadonlyMap<string, RemoteReplayBackfill>;
  readonly subagentLifecycles?: ReadonlyMap<string, AgentSubagentLifecycle>;
  readonly replayGaps?: ReadonlyMap<string, RemoteReplayGap>;
  readonly replayComplete: ReadonlySet<string>;
  readonly replayTruncated: ReadonlySet<string>;
  readonly replayDiscarded?: ReadonlySet<string>;
  readonly replayServerEvictions?: ReadonlyMap<string, number>;
  readonly threadMetadata?: ReadonlyMap<string, RemoteThreadMetadata>;
  readonly pendingMessages?: ReadonlyMap<string, readonly RemoteRunnerPendingMessage[]>;
  readonly error: string | null;
}
export const emptyRemoteInventory = (
  serverId: string,
  connected: boolean,
): RemoteAgentInventorySnapshot => ({
  serverId,
  listingCursor: 0,
  connected,
  descriptor: null,
  projects: [],
  tasks: [],
  replays: new Map(),
  resumes: new Map(),
  replayComplete: new Set(),
  replayTruncated: new Set(),
  replayDiscarded: new Set(),
  replayServerEvictions: new Map(),
  error: null,
});
const threadId = (serverId: string, task: RemoteRunnerTask) =>
  remoteAgentThreadKey(serverId, task.runnerId, task.conversationId ?? task.id);
export class RemoteInventoryRevoked extends Error {}
export async function loadRemoteAgentInventory(
  gateway: RemoteRunnerGateway,
  prior: RemoteAgentInventorySnapshot,
  selectedThreadId: string | null,
  valid: () => boolean,
  progressed?: (
    snapshot: RemoteAgentInventorySnapshot,
    urgency: RemoteInventoryProgressUrgency,
  ) => void,
): Promise<RemoteAgentInventorySnapshot> {
  const check = () => {
    if (!valid()) throw new RemoteInventoryRevoked();
  };
  check();
  const serverId = prior.serverId;
  check();
  const descriptor = await gateway.getRunner({ serverId });
  check();
  if (!descriptor.capabilities.taskExecution || !descriptor.capabilities.eventReplay)
    throw new Error("This runner does not support durable task execution.");
  if (prior.descriptor && prior.descriptor.runnerId !== descriptor.runnerId)
    throw new Error("The server runner identity changed. Reconnect the server before continuing.");
  const verified = await verifyRestoredRemoteInventory({
    gateway,
    previous: prior,
    runnerId: descriptor.runnerId,
    check,
    invalidatedProgress: (snapshot) => progressed?.(snapshot, "immediate"),
  });
  check();
  const projectPage = await gateway.listProjects({ serverId });
  check();
  let previous = verified;
  let tasks = previous.tasks;
  let after = verified.replayInvalidatedTaskIds?.size ? 0 : previous.listingCursor;
  let catchingUp = false;
  let historyWindowed = previous.historyWindowed === true;
  for (let pageNumber = 0; pageNumber < 64; pageNumber++) {
    check();
    const page = await gateway.listTasks({ serverId, after });
    check();
    let next = after;
    for (const task of page.items) {
      if (task.runnerId !== descriptor.runnerId || task.sequence <= next)
        throw new Error("The runner returned invalid task history.");
      next = task.sequence;
    }
    if (page.items.length > 64) throw new Error("The runner returned an oversized task page.");
    const listed = retainedRestoredTaskListing(previous, page.items);
    previous = listedRestoredRemoteInventory({ ...previous, tasks }, listed);
    const merged = mergeRemoteTasks(previous.tasks, listed);
    tasks = retainRemoteInventoryTasks(merged, serverId, selectedThreadId);
    historyWindowed ||= tasks.length !== merged.length;
    if (page.nextCursor === null) {
      after = next;
      break;
    }
    if (page.nextCursor !== next || next === after)
      throw new Error("The runner returned an invalid task page cursor.");
    after = next;
    catchingUp = pageNumber === 63;
  }
  const activeTasks = tasks.filter((task) => !isRemoteTaskTerminal(task));
  if (activeTasks.length > 64)
    throw new Error("Remote active task inventory exceeds the 64-task polling limit.");
  for (const task of activeTasks) {
    if (task.id === previous.replayVerifiedTaskId) continue;
    check();
    const updated = await gateway.getTask({ serverId, taskId: task.id });
    check();
    if (updated.id !== task.id || updated.runnerId !== descriptor.runnerId)
      throw new Error("The runner returned a different task.");
    tasks = mergeRemoteTasks(tasks, [updated]);
  }
  let selected = tasks.filter((task) => threadId(serverId, task) === selectedThreadId).slice(0, 64);
  const known = new Set(tasks.map((task) => task.id));
  for (let index = 0; index < selected.length; index++) {
    if (selected.length >= 64) break;
    const current = selected[index]!;
    const parentId =
      current.parentTaskId ??
      (current.conversationId !== current.id ? current.conversationId : undefined);
    if (!parentId) continue;
    if (known.has(parentId)) {
      const parent = tasks.find((task) => task.id === parentId)!;
      if (threadId(serverId, parent) !== selectedThreadId || parent.sequence >= current.sequence)
        throw new Error("The runner returned invalid conversation ancestry.");
      continue;
    }
    check();
    const parent = await gateway.getTask({ serverId, taskId: parentId });
    check();
    if (
      parent.id !== parentId ||
      parent.runnerId !== descriptor.runnerId ||
      threadId(serverId, parent) !== selectedThreadId ||
      parent.sequence >= current.sequence
    )
      throw new Error("The runner returned invalid conversation ancestry.");
    known.add(parent.id);
    tasks = mergeRemoteTasks(tasks, [parent]);
    selected = [...selected, parent];
  }
  const window = retainRemoteInventoryTasks(tasks, serverId, selectedThreadId);
  historyWindowed ||= window.length !== tasks.length;
  tasks = window;
  const retainedIds = new Set(tasks.map((task) => task.id));
  const detailedTaskIds = new Set(
    [...(previous.detailedTaskIds ?? [])].filter((id) => retainedIds.has(id)),
  );
  for (const listed of selected) {
    if (detailedTaskIds.has(listed.id)) continue;
    check();
    const detail = await gateway.getTask({ serverId, taskId: listed.id });
    check();
    if (!isRemoteTaskDetailOf(listed, detail))
      throw new Error("The runner returned a different conversation turn.");
    // Listing parts may be abbreviated. Canonical detail replaces those parts even
    // after the turn is terminal; ordinary status merges deliberately cannot do so.
    const hydrated = supersedeRemoteTask(listed, detail);
    tasks = tasks.map((task) => (task.id === detail.id ? hydrated : task));
    detailedTaskIds.add(detail.id);
  }
  selected = tasks.filter((task) => threadId(serverId, task) === selectedThreadId).slice(0, 64);
  const latestSelected = selected.reduce<RemoteRunnerTask | undefined>(
    (latest, task) => (!latest || task.sequence > latest.sequence ? task : latest),
    undefined,
  );
  const latestRunningSelected = selected
    .filter((task) => task.status === "running")
    .reduce<RemoteRunnerTask | undefined>(
      (latest, task) => (!latest || task.sequence > latest.sequence ? task : latest),
      undefined,
    );
  const pendingMessages = new Map<string, readonly RemoteRunnerPendingMessage[]>();
  if (latestSelected && descriptor.capabilities.pendingMessages && gateway.listPendingMessages) {
    check();
    const page = await gateway.listPendingMessages({ serverId, taskId: latestSelected.id });
    check();
    if (
      page.items.length > 16 ||
      page.items.some(
        (item) =>
          item.conversationId !== (latestSelected.conversationId ?? latestSelected.id) ||
          (item.status !== "queued" && item.status !== "paused" && item.status !== "uncertain"),
      )
    )
      throw new Error("The runner returned an invalid pending message queue.");
    pendingMessages.set(threadId(serverId, latestSelected), page.items);
  }
  const threadMetadata =
    descriptor.capabilities.threadManagement && gateway.listThreadMetadata
      ? await loadRemoteThreadMetadata(gateway, serverId, check)
      : new Map<string, RemoteThreadMetadata>();
  check();
  const continuation = !catchingUp && descriptor.capabilities.taskContinuation === true;
  const resumes = new Map<string, RemoteRunnerTaskResume>();
  const priorResume = latestSelected && previous.resumes.get(latestSelected.id);
  if (continuation && latestSelected && priorResume) resumes.set(latestSelected.id, priorResume);
  return loadRemoteInventoryReplay({
    gateway,
    previous,
    descriptor,
    selected,
    latestSelected,
    latestRunningSelected,
    resumes,
    check,
    progressed,
    notice: catchingUp
      ? "Loading server history; continuation will be available when the latest tasks are reached."
      : historyWindowed
        ? "Showing recent conversations. Older history remains stored on the server."
        : null,
    base: {
      ...emptyRemoteInventory(serverId, !catchingUp),
      threadMetadata,
      pendingMessages,
      listingCursor: after,
      detailedTaskIds,
      inventoryTruncated: catchingUp,
      historyWindowed,
      descriptor,
      projects: projectPage.items,
      tasks,
      replayInvalidatedTaskIds: previous.replayInvalidatedTaskIds,
    },
  });
}

/** A bounded display cache; server rows remain authoritative and are never deleted. */
export function retainRemoteInventoryTasks(
  tasks: readonly RemoteRunnerTask[],
  serverId?: string,
  selectedThreadId?: string | null,
): readonly RemoteRunnerTask[] {
  const active = tasks.filter((task) => !isRemoteTaskTerminal(task));
  if (active.length > 64)
    throw new Error("Remote active task inventory exceeds the 64-task polling limit.");
  const selected =
    serverId && selectedThreadId
      ? tasks.filter((task) => threadId(serverId, task) === selectedThreadId).slice(0, 64)
      : [];
  const reserved = new Map([...active, ...selected].map((task) => [task.id, task]));
  return [
    ...reserved.values(),
    ...tasks.filter((task) => !reserved.has(task.id)).slice(0, 4096 - reserved.size),
  ].sort((a, b) => b.sequence - a.sequence);
}
