import type { RemoteThreadMetadata } from "../domain/remoteThreadMetadata";
import { loadRemoteThreadMetadata } from "./remoteThreadMetadataInventory";
import type { AgentSubagentLifecycle } from "@codevo/agent-events";
import { REMOTE_OUTPUT_DISCARDED_ERROR, type RemoteReplayGap } from "./remoteAgentReplayWindow";
import {
  appliedRemoteBackwardPage,
  forwardRemoteTaskReplay,
  MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS,
  MAX_REMOTE_REPLAY_BACKWARD_PAGES_PER_PASS,
  type RemoteReplayDirection,
  priorRemoteTaskReplay,
  REMOTE_BACKFILL_PAGES_PER_LIVE_POLL,
  REMOTE_TASK_REPLAY_TAIL_BEFORE,
  remoteReplayIndex,
  remoteReplayOutputDiscarded,
  remoteTaskReplayUnread,
  retainedRemoteTaskReplay,
  tailRemoteTaskReplay,
  type RemoteReplayBackfill,
  type RemoteTaskReplay,
} from "./remoteAgentTaskReplay";
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
  acceptsRemoteTaskUpdate,
  isRemoteTaskTerminal,
  mergeRemoteTasks,
} from "./remoteRunnerTaskState";

export interface RemoteAgentInventorySnapshot {
  readonly serverId: string;
  readonly listingCursor: number;
  readonly inventoryTruncated?: boolean;
  readonly historyWindowed?: boolean;
  readonly detailedTaskIds?: ReadonlySet<string>;
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
type ListEventsBefore = NonNullable<RemoteRunnerGateway["listEventsBefore"]>;
export class RemoteInventoryRevoked extends Error {}
export async function loadRemoteAgentInventory(
  gateway: RemoteRunnerGateway,
  previous: RemoteAgentInventorySnapshot,
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
  const serverId = previous.serverId;
  check();
  const descriptor = await gateway.getRunner({ serverId });
  check();
  if (!descriptor.capabilities.taskExecution || !descriptor.capabilities.eventReplay)
    throw new Error("This runner does not support durable task execution.");
  if (previous.descriptor && previous.descriptor.runnerId !== descriptor.runnerId)
    throw new Error("The server runner identity changed. Reconnect the server before continuing.");
  check();
  const projectPage = await gateway.listProjects({ serverId });
  check();
  let tasks = previous.tasks;
  let after = previous.listingCursor;
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
    const merged = mergeRemoteTasks(tasks, page.items);
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
    if (
      detail.id !== listed.id ||
      detail.runnerId !== listed.runnerId ||
      detail.provider !== listed.provider ||
      (detail.isolation ?? "worktree") !== (listed.isolation ?? "worktree") ||
      detail.sequence !== listed.sequence ||
      detail.createdAt !== listed.createdAt ||
      detail.projectId !== listed.projectId ||
      (detail.conversationId ?? detail.id) !== (listed.conversationId ?? listed.id) ||
      detail.parentTaskId !== listed.parentTaskId ||
      (isRemoteTaskTerminal(listed)
        ? detail.status !== listed.status
        : !acceptsRemoteTaskUpdate(listed, detail))
    ) {
      throw new Error("The runner returned a different conversation turn.");
    }
    // Listing parts may be abbreviated. Canonical detail replaces those parts even
    // after the turn is terminal; ordinary status merges deliberately cannot do so.
    tasks = tasks.map((task) => (task.id === detail.id ? detail : task));
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
  const listEventsBefore =
    descriptor.capabilities.eventBackwardPaging === true
      ? gateway.listEventsBefore?.bind(gateway)
      : undefined;
  const direction: RemoteReplayDirection = listEventsBefore ? "backward" : "forward";
  const replayed = new Map<string, RemoteTaskReplay>();
  for (const task of selected) {
    if (remoteTaskReplayUnread(previous, task.id)) continue;
    replayed.set(task.id, priorRemoteTaskReplay(previous, task, direction));
  }
  const olderTurnBytes = Math.floor(3_000_000 / Math.max(1, selected.length - 1));
  const maxBytesOf = (task: RemoteRunnerTask) =>
    task === latestSelected ? 3_000_000 : olderTurnBytes;
  const replayOf = (task: RemoteRunnerTask) =>
    replayed.get(task.id) ?? priorRemoteTaskReplay(previous, task, direction);
  const notice = catchingUp
    ? "Loading server history; continuation will be available when the latest tasks are reached."
    : historyWindowed
      ? "Showing recent conversations. Older history remains stored on the server."
      : null;
  const unloaded = () => selected.filter((task) => !replayed.has(task.id)).map((task) => task.id);
  const snapshot = (): RemoteAgentInventorySnapshot => ({
    threadMetadata,
    pendingMessages,
    serverId,
    listingCursor: after,
    detailedTaskIds,
    connected: !catchingUp,
    inventoryTruncated: catchingUp,
    historyWindowed,
    descriptor,
    projects: projectPage.items,
    tasks,
    resumes: new Map(resumes),
    ...remoteReplayIndex(replayed, unloaded()),
    error: remoteReplayOutputDiscarded(replayed) ? REMOTE_OUTPUT_DISCARDED_ERROR : notice,
  });
  const report = (urgency: RemoteInventoryProgressUrgency) => {
    check();
    progressed?.(snapshot(), urgency);
    check();
  };
  const readTail = async (task: RemoteRunnerTask, read: ListEventsBefore) => {
    check();
    const page = await read({ serverId, taskId: task.id, before: REMOTE_TASK_REPLAY_TAIL_BEFORE });
    check();
    replayed.set(task.id, tailRemoteTaskReplay(task, page, maxBytesOf(task)));
    if (page.items.length === 0) return;
    report(task === latestSelected ? "immediate" : "coalesced");
  };
  const readForwardPage = async (task: RemoteRunnerTask) => {
    const replay = replayOf(task);
    check();
    const page = await gateway.listEvents({ serverId, taskId: task.id, after: replay.cursor });
    check();
    replayed.set(task.id, forwardRemoteTaskReplay(replay, task, page, maxBytesOf(task)));
    return page;
  };
  const readForward = async (task: RemoteRunnerTask) => {
    const prior = replayOf(task);
    for (let pageNumber = 0; pageNumber < MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS; pageNumber++) {
      if (replayOf(task).complete) break;
      const page = await readForwardPage(task);
      check();
      if (listEventsBefore && page.items.length > 0) report("coalesced");
      if (page.nextCursor === null) break;
    }
    check();
    replayed.set(task.id, retainedRemoteTaskReplay(replayOf(task), maxBytesOf(task)));
    const settled = replayOf(task);
    if (
      !listEventsBefore &&
      (settled.cursor !== prior.cursor ||
        settled.complete !== prior.complete ||
        settled.events !== prior.events)
    )
      report("coalesced");
  };
  let backwardPages = 0;
  const taskPages = new Map<string, number>();
  const readLive = async () => {
    if (backwardPages % REMOTE_BACKFILL_PAGES_PER_LIVE_POLL !== 0) return;
    if (!latestRunningSelected || replayOf(latestRunningSelected).complete) return;
    check();
    const page = await readForwardPage(latestRunningSelected);
    check();
    if (page.items.length > 0) report("coalesced");
  };
  const backfill = async (
    task: RemoteRunnerTask,
    read: ListEventsBefore,
    phase: "pending" | "scanningInputs" | "scanningBoundary",
  ) => {
    while (
      backwardPages < MAX_REMOTE_REPLAY_BACKWARD_PAGES_PER_PASS &&
      (taskPages.get(task.id) ?? 0) < MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS
    ) {
      const replay = replayOf(task);
      if (replay.earlier.kind !== phase) return;
      check();
      const page = await read({ serverId, taskId: task.id, before: replay.earlier.before });
      check();
      const next = appliedRemoteBackwardPage(replay, task, page, maxBytesOf(task));
      replayed.set(task.id, next);
      backwardPages += 1;
      taskPages.set(task.id, (taskPages.get(task.id) ?? 0) + 1);
      report("coalesced");
      await readLive();
      check();
    }
  };
  if (selected.some((task) => remoteTaskReplayUnread(previous, task.id))) report("coalesced");
  for (const task of selected) {
    check();
    if (listEventsBefore && remoteTaskReplayUnread(previous, task.id)) {
      await readTail(task, listEventsBefore);
      check();
    }
    if (!listEventsBefore || !remoteTaskReplayUnread(previous, task.id)) {
      await readForward(task);
      check();
    }
    // Only the latest turn owns continuation. Older output remains fully replayed;
    // querying its resume status adds no display information or launch authority.
    if (continuation && task === latestSelected) {
      check();
      const resume = await gateway.getTaskResume({ serverId, taskId: task.id });
      check();
      resumes.set(task.id, resume);
    }
  }
  if (listEventsBefore) {
    for (const phase of ["pending", "scanningInputs", "scanningBoundary"] as const) {
      for (const task of selected) {
        check();
        await backfill(task, listEventsBefore, phase);
        check();
      }
    }
  }
  check();
  return snapshot();
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
