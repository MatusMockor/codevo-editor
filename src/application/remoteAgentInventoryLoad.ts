import { retainRemoteReplayWindow, type RemoteReplayGap } from "./remoteAgentReplayWindow";
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
  readonly detailedTaskIds?: ReadonlySet<string>;
  readonly connected: boolean;
  readonly descriptor: RemoteRunnerDescriptor | null;
  readonly projects: readonly RemoteRunnerProject[];
  readonly tasks: readonly RemoteRunnerTask[];
  readonly replays: ReadonlyMap<string, readonly RemoteRunnerEvent[]>;
  readonly resumes: ReadonlyMap<string, RemoteRunnerTaskResume>;
  readonly replayCursors?: ReadonlyMap<string, number>;
  readonly replayGaps?: ReadonlyMap<string, RemoteReplayGap>;
  readonly replayComplete: ReadonlySet<string>;
  readonly replayTruncated: ReadonlySet<string>;
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
  error: null,
});
const threadId = (serverId: string, task: RemoteRunnerTask) =>
  remoteAgentThreadKey(serverId, task.runnerId, task.conversationId ?? task.id);
export class RemoteInventoryRevoked extends Error {}
export async function loadRemoteAgentInventory(
  gateway: RemoteRunnerGateway,
  previous: RemoteAgentInventorySnapshot,
  selectedThreadId: string | null,
  valid: () => boolean,
): Promise<RemoteAgentInventorySnapshot> {
  const check = () => {
    if (!valid()) throw new RemoteInventoryRevoked();
  };
  check();
  if (previous.inventoryTruncated)
    throw new Error("Remote task history exceeds the editor limit; history is incomplete.");
  const serverId = previous.serverId;
  const descriptor = await gateway.getRunner({ serverId });
  check();
  if (!descriptor.capabilities.taskExecution || !descriptor.capabilities.eventReplay)
    throw new Error("This runner does not support durable task execution.");
  if (previous.descriptor && previous.descriptor.runnerId !== descriptor.runnerId)
    throw new Error("The server runner identity changed. Reconnect the server before continuing.");
  const projectPage = await gateway.listProjects({ serverId });
  check();
  let tasks = previous.tasks;
  let after = previous.listingCursor;
  for (let pageNumber = 0; pageNumber < 64; pageNumber++) {
    const page = await gateway.listTasks({ serverId, after });
    check();
    let next = after;
    for (const task of page.items) {
      if (task.runnerId !== descriptor.runnerId || task.sequence <= next)
        throw new Error("The runner returned invalid task history.");
      next = task.sequence;
    }
    if (page.items.length > 64 || tasks.length + page.items.length > 4096)
      throw new Error("Remote task history exceeds the editor limit; history is incomplete.");
    tasks = mergeRemoteTasks(tasks, page.items);
    if (page.nextCursor === null) {
      after = next;
      break;
    }
    if (page.nextCursor !== next || next === after || pageNumber === 63)
      throw new Error("Remote task history exceeds the page limit or has an invalid cursor.");
    after = next;
  }
  const activeTasks = tasks.filter((task) => !isRemoteTaskTerminal(task));
  if (activeTasks.length > 64)
    throw new Error("Remote active task inventory exceeds the 64-task polling limit.");
  for (const task of activeTasks) {
    const updated = await gateway.getTask({ serverId, taskId: task.id });
    check();
    if (updated.id !== task.id || updated.runnerId !== descriptor.runnerId)
      throw new Error("The runner returned a different task.");
    tasks = mergeRemoteTasks(tasks, [updated]);
  }
  let selected = tasks.filter((task) => threadId(serverId, task) === selectedThreadId);
  const known = new Set(tasks.map((task) => task.id));
  for (let index = 0; index < selected.length; index++) {
    if (selected.length > 64)
      throw new Error("Remote conversation exceeds the 64-turn display limit.");
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
    const parent = await gateway.getTask({ serverId, taskId: parentId });
    check();
    if (
      parent.id !== parentId ||
      parent.runnerId !== descriptor.runnerId ||
      threadId(serverId, parent) !== selectedThreadId
    )
      throw new Error("The runner returned invalid conversation ancestry.");
    if (tasks.length >= 4096)
      throw new Error("Remote task history exceeds the editor limit; history is incomplete.");
    known.add(parent.id);
    tasks = mergeRemoteTasks(tasks, [parent]);
    selected = [...selected, parent];
  }
  if (selected.length > 64)
    throw new Error("Remote conversation exceeds the 64-turn display limit.");
  const detailedTaskIds = new Set(previous.detailedTaskIds ?? []);
  for (const listed of selected) {
    if (detailedTaskIds.has(listed.id)) continue;
    const detail = await gateway.getTask({ serverId, taskId: listed.id });
    check();
    if (
      detail.id !== listed.id ||
      detail.runnerId !== listed.runnerId ||
      detail.provider !== listed.provider ||
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
  selected = tasks.filter((task) => threadId(serverId, task) === selectedThreadId);
  const replays = new Map<string, readonly RemoteRunnerEvent[]>();
  const resumes = new Map<string, RemoteRunnerTaskResume>();
  const replayComplete = new Set<string>();
  const replayTruncated = new Set<string>();
  const latestSelected = selected.reduce<RemoteRunnerTask | undefined>(
    (latest, task) => (!latest || task.sequence > latest.sequence ? task : latest),
    undefined,
  );
  const replayCursors = new Map<string, number>();
  const replayGaps = new Map<string, RemoteReplayGap>();
  const olderTurnBytes = Math.floor(3_000_000 / Math.max(1, selected.length - 1));
  let error: string | null = null;
  for (const task of selected) {
    const perTurnBytes = task === latestSelected ? 3_000_000 : olderTurnBytes;
    let events = previous.replays.get(task.id) ?? [];
    let cursor = previous.replayCursors?.get(task.id) ?? events[events.length - 1]?.sequence ?? 0;
    let gap = previous.replayGaps?.get(task.id);
    let truncated = previous.replayTruncated.has(task.id);
    let complete = isRemoteTaskTerminal(task) && previous.replayComplete.has(task.id);
    if (!complete) {
      for (let pageNumber = 0; pageNumber < 24; pageNumber++) {
        const page = await gateway.listEvents({ serverId, taskId: task.id, after: cursor });
        check();
        let next = cursor;
        for (const event of page.items) {
          if (event.taskId !== task.id || event.sequence <= next)
            throw new Error("The runner returned invalid event ordering; output is incomplete.");
          next = event.sequence;
        }
        if (page.nextCursor !== null && (page.nextCursor !== next || next === cursor))
          throw new Error("The runner returned an invalid event page cursor.");
        const removed = page.outputTruncatedBeforeSequence;
        if (removed !== undefined && removed > (gap?.throughSequence ?? 0)) {
          gap = {
            throughSequence: removed,
            startsAtLineBoundary: page.outputStartsAtLineBoundary === true,
          };
          truncated = true;
        }
        const retained = retainRemoteReplayWindow([...events, ...page.items], perTurnBytes, gap);
        events = retained.events;
        gap = retained.gap;
        truncated ||= retained.truncated;
        cursor = next;
        if (page.nextCursor === null) {
          complete = isRemoteTaskTerminal(task);
          break;
        }
      }
    }
    const retained = retainRemoteReplayWindow(events, perTurnBytes, gap);
    events = retained.events;
    gap = retained.gap;
    truncated ||= retained.truncated;
    replayCursors.set(task.id, cursor);
    if (gap) replayGaps.set(task.id, gap);
    replays.set(task.id, events);
    if (complete) replayComplete.add(task.id);
    if (truncated) {
      replayTruncated.add(task.id);
      error = "Showing recent server output; earlier output is incomplete.";
    }
    // Only the latest turn owns continuation. Older output remains fully replayed;
    // querying its resume status adds no display information or launch authority.
    if (descriptor.capabilities.taskContinuation && task === latestSelected) {
      const resume = await gateway.getTaskResume({ serverId, taskId: task.id });
      check();
      resumes.set(task.id, resume);
    }
  }
  const pendingMessages = new Map<string, readonly RemoteRunnerPendingMessage[]>();
  if (latestSelected && descriptor.capabilities.pendingMessages && gateway.listPendingMessages) {
    const page = await gateway.listPendingMessages({ serverId, taskId: latestSelected.id });
    check();
    if (
      page.items.length > 16 ||
      page.items.some(
        (item) =>
          item.conversationId !== (latestSelected.conversationId ?? latestSelected.id) ||
          (item.status !== "queued" && item.status !== "paused"),
      )
    )
      throw new Error("The runner returned an invalid pending message queue.");
    pendingMessages.set(threadId(serverId, latestSelected), page.items);
  }
  return {
    pendingMessages,
    serverId,
    listingCursor: after,
    detailedTaskIds,
    connected: true,
    descriptor,
    projects: projectPage.items,
    tasks,
    replays,
    resumes,
    replayComplete,
    replayCursors,
    replayGaps,
    replayTruncated,
    error,
  };
}
