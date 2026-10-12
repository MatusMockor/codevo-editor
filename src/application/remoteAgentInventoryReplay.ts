import type {
  RemoteRunnerDescriptor,
  RemoteRunnerGateway,
  RemoteRunnerTask,
  RemoteRunnerTaskResume,
} from "../domain/remoteRunner";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import type { RemoteReplayRestoreTask } from "./remoteAgentReplayMemory";
import type { RemoteInventoryProgressUrgency } from "./remoteInventoryProgress";
import { REMOTE_OUTPUT_DISCARDED_ERROR } from "./remoteAgentReplayWindow";
import {
  appliedRemoteBackwardPage,
  forwardRemoteTaskReplay,
  MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS,
  MAX_REMOTE_REPLAY_BACKWARD_PAGES_PER_PASS,
  priorRemoteTaskReplay,
  REMOTE_BACKFILL_PAGES_PER_LIVE_POLL,
  REMOTE_TASK_REPLAY_TAIL_BEFORE,
  remoteReplayIndex,
  remoteReplayOutputDiscarded,
  remoteTaskReplayUnread,
  retainedRemoteTaskReplay,
  tailRemoteTaskReplay,
  type RemoteReplayDirection,
  type RemoteTaskReplay,
} from "./remoteAgentTaskReplay";

export const MAX_REMOTE_RESTORED_REPLAY_CATCH_UP_PAGES = 4;
type ListEventsBefore = NonNullable<RemoteRunnerGateway["listEventsBefore"]>;

interface RemoteInventoryReplayRequest {
  readonly gateway: RemoteRunnerGateway;
  readonly previous: RemoteAgentInventorySnapshot;
  readonly base: RemoteAgentInventorySnapshot;
  readonly descriptor: RemoteRunnerDescriptor;
  readonly selected: readonly RemoteRunnerTask[];
  readonly latestSelected: RemoteRunnerTask | undefined;
  readonly latestRunningSelected: RemoteRunnerTask | undefined;
  readonly resumes: Map<string, RemoteRunnerTaskResume>;
  readonly notice: string | null;
  readonly check: () => void;
  readonly progressed:
    | ((snapshot: RemoteAgentInventorySnapshot, urgency: RemoteInventoryProgressUrgency) => void)
    | undefined;
}

export async function loadRemoteInventoryReplay({
  gateway,
  previous,
  base,
  descriptor,
  selected,
  latestSelected,
  latestRunningSelected,
  resumes,
  notice,
  check,
  progressed,
}: RemoteInventoryReplayRequest): Promise<RemoteAgentInventorySnapshot> {
  const continuation =
    base.inventoryTruncated !== true && descriptor.capabilities.taskContinuation === true;
  const listEventsBefore =
    descriptor.capabilities.eventBackwardPaging === true
      ? gateway.listEventsBefore?.bind(gateway)
      : undefined;
  const direction: RemoteReplayDirection = listEventsBefore ? "backward" : "forward";
  const serverId = previous.serverId;
  const replayed = new Map<string, RemoteTaskReplay>();
  const catchUpTaskIds = new Set(
    selected.filter((task) => previous.replayCatchUpTaskIds?.has(task.id)).map((task) => task.id),
  );
  for (const task of selected) {
    if (remoteTaskReplayUnread(previous, task.id)) continue;
    const replay = priorRemoteTaskReplay(previous, task, direction);
    replayed.set(task.id, restoredReplaySeed(replay, previous.replayRestore?.get(task.id)));
  }
  const olderTurnBytes = Math.floor(3_000_000 / Math.max(1, selected.length - 1));
  const maxBytesOf = (task: RemoteRunnerTask) =>
    task === latestSelected ? 3_000_000 : olderTurnBytes;
  const replayOf = (task: RemoteRunnerTask) =>
    replayed.get(task.id) ?? priorRemoteTaskReplay(previous, task, direction);
  const unloaded = () => selected.filter((task) => !replayed.has(task.id)).map((task) => task.id);
  const snapshot = (): RemoteAgentInventorySnapshot => ({
    ...base,
    resumes: new Map(resumes),
    replayCatchUpTaskIds: new Set(catchUpTaskIds),
    ...remoteReplayIndex(replayed, unloaded()),
    error: remoteReplayOutputDiscarded(replayed) ? REMOTE_OUTPUT_DISCARDED_ERROR : notice,
  });
  const report = (urgency: RemoteInventoryProgressUrgency) => {
    check();
    progressed?.(snapshot(), urgency);
    check();
  };
  const readTail = async (task: RemoteRunnerTask, read: ListEventsBefore) => {
    const catchingUp = catchUpTaskIds.has(task.id);
    check();
    const page = await read({ serverId, taskId: task.id, before: REMOTE_TASK_REPLAY_TAIL_BEFORE });
    check();
    replayed.set(task.id, tailRemoteTaskReplay(task, page, maxBytesOf(task)));
    catchUpTaskIds.delete(task.id);
    if (page.items.length === 0 && !catchingUp) return;
    report(task === latestSelected ? "immediate" : "coalesced");
  };
  const readForwardPage = async (task: RemoteRunnerTask) => {
    const replay = replayOf(task);
    check();
    const page = await gateway.listEvents({ serverId, taskId: task.id, after: replay.cursor });
    check();
    const applied = forwardRemoteTaskReplay(replay, task, page, maxBytesOf(task));
    const events =
      page.items.length === 0 &&
      applied.events.length === replay.events.length &&
      applied.events.every((event, index) => event === replay.events[index])
        ? replay.events
        : applied.events;
    replayed.set(task.id, { ...applied, events });
    if (page.nextCursor === null) catchUpTaskIds.delete(task.id);
    return page;
  };
  const readForward = async (task: RemoteRunnerTask) => {
    const prior = replayOf(task);
    const pendingCatchUp = catchUpTaskIds.has(task.id);
    const restoredCatchUp = listEventsBefore !== undefined && pendingCatchUp;
    const limit = restoredCatchUp
      ? MAX_REMOTE_RESTORED_REPLAY_CATCH_UP_PAGES
      : MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS;
    for (let pageNumber = 0; pageNumber < limit; pageNumber++) {
      if (replayOf(task).complete) break;
      const catchingUp = catchUpTaskIds.has(task.id);
      const page = await readForwardPage(task);
      check();
      if (
        listEventsBefore &&
        (page.items.length > 0 ||
          replayOf(task).complete !== prior.complete ||
          (catchingUp && !catchUpTaskIds.has(task.id)))
      )
        report("coalesced");
      if (page.nextCursor === null) break;
      if (listEventsBefore && pageNumber === limit - 1 && restoredCatchUp) {
        await readTail(task, listEventsBefore);
        check();
      }
    }
    check();
    replayed.set(task.id, retainedRemoteTaskReplay(replayOf(task), maxBytesOf(task)));
    const settled = replayOf(task);
    if (
      !listEventsBefore &&
      (settled.cursor !== prior.cursor ||
        settled.complete !== prior.complete ||
        settled.events !== prior.events ||
        (pendingCatchUp && !catchUpTaskIds.has(task.id)))
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

function restoredReplaySeed(
  replay: RemoteTaskReplay,
  restore: RemoteReplayRestoreTask | undefined,
): RemoteTaskReplay {
  if (restore === undefined) return replay;
  switch (restore.kind) {
    case "recheckTail":
      return { ...replay, complete: false };
    case "retained":
    case "invalidated":
    case "missing":
      return replay;
    default: {
      const unsupported: never = restore.kind;
      return unsupported;
    }
  }
}
