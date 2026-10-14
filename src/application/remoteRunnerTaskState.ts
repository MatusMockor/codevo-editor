import type { RemoteRunnerTask } from "../domain/remoteRunner";

type RemoteTaskUpdate = "replace" | "settle" | "keep";

interface RemoteTaskInteractions {
  readonly interactionSequence: number | undefined;
  readonly awaiting: "approval" | undefined;
}

export function isRemoteTaskTerminal(task: RemoteRunnerTask): boolean {
  return !["draft", "queued", "running"].includes(task.status);
}

function unsupported(update: never): never {
  throw new TypeError(`Unsupported remote task update: ${String(update)}.`);
}

const TERMINAL_STATUS_RANK = 3;

function unknownStatusRank(_status: never): number {
  return TERMINAL_STATUS_RANK;
}

function statusRank(task: RemoteRunnerTask): number {
  switch (task.status) {
    case "draft":
      return 0;
    case "queued":
      return 1;
    case "running":
      return 2;
    case "succeeded":
    case "failed":
    case "interrupted":
    case "cancelled":
      return TERMINAL_STATUS_RANK;
    default:
      return unknownStatusRank(task.status);
  }
}

function isolationOf(task: RemoteRunnerTask): string {
  return task.isolation ?? "worktree";
}

function regressesInteractions(previous: RemoteRunnerTask, incoming: RemoteRunnerTask): boolean {
  if (previous.interactionSequence === undefined) return false;
  if (incoming.interactionSequence === undefined) return true;
  return incoming.interactionSequence < previous.interactionSequence;
}

function advancesInteractions(previous: RemoteRunnerTask, incoming: RemoteRunnerTask): boolean {
  if (incoming.interactionSequence === undefined) return false;
  if (previous.interactionSequence === undefined) return true;
  return incoming.interactionSequence > previous.interactionSequence;
}

function terminalTaskUpdate(
  previous: RemoteRunnerTask,
  incoming: RemoteRunnerTask,
): RemoteTaskUpdate {
  if (incoming.status !== previous.status) return "keep";
  if (!advancesInteractions(previous, incoming)) return "keep";
  return "settle";
}

function remoteTaskUpdate(
  previous: RemoteRunnerTask,
  incoming: RemoteRunnerTask,
): RemoteTaskUpdate {
  if (isolationOf(previous) !== isolationOf(incoming)) return "keep";
  if (isRemoteTaskTerminal(previous)) return terminalTaskUpdate(previous, incoming);
  const rise = statusRank(incoming) - statusRank(previous);
  if (rise > 0) return "replace";
  if (rise < 0) return "keep";
  if (regressesInteractions(previous, incoming)) return "keep";
  return "replace";
}

function interactionsOf(task: RemoteRunnerTask): RemoteTaskInteractions {
  return { interactionSequence: task.interactionSequence, awaiting: task.awaiting };
}

function withInteractions(
  task: RemoteRunnerTask,
  interactions: RemoteTaskInteractions,
): RemoteRunnerTask {
  const { interactionSequence: _sequence, awaiting: _awaiting, ...record } = task;
  return {
    ...record,
    ...(interactions.interactionSequence === undefined
      ? {}
      : { interactionSequence: interactions.interactionSequence }),
    ...(interactions.awaiting === undefined ? {} : { awaiting: interactions.awaiting }),
  };
}

function retainedInteractions(
  previous: RemoteRunnerTask,
  incoming: RemoteRunnerTask,
): RemoteTaskInteractions {
  if (isRemoteTaskTerminal(incoming))
    return { interactionSequence: previous.interactionSequence, awaiting: undefined };
  return interactionsOf(previous);
}

export function supersedeRemoteTask(
  previous: RemoteRunnerTask,
  incoming: RemoteRunnerTask,
): RemoteRunnerTask {
  if (!regressesInteractions(previous, incoming)) return incoming;
  return withInteractions(incoming, retainedInteractions(previous, incoming));
}

function updatedTask(previous: RemoteRunnerTask, incoming: RemoteRunnerTask): RemoteRunnerTask {
  const update = remoteTaskUpdate(previous, incoming);
  switch (update) {
    case "replace":
      return supersedeRemoteTask(previous, incoming);
    case "settle":
      return withInteractions(previous, interactionsOf(incoming));
    case "keep":
      return previous;
    default:
      return unsupported(update);
  }
}

function sameTurnIdentity(listed: RemoteRunnerTask, detail: RemoteRunnerTask): boolean {
  return (
    detail.id === listed.id &&
    detail.runnerId === listed.runnerId &&
    detail.provider === listed.provider &&
    isolationOf(detail) === isolationOf(listed) &&
    detail.sequence === listed.sequence &&
    detail.createdAt === listed.createdAt &&
    detail.projectId === listed.projectId &&
    (detail.conversationId ?? detail.id) === (listed.conversationId ?? listed.id) &&
    detail.parentTaskId === listed.parentTaskId
  );
}

function followsStatus(listed: RemoteRunnerTask, detail: RemoteRunnerTask): boolean {
  if (isRemoteTaskTerminal(listed)) return detail.status === listed.status;
  return statusRank(detail) >= statusRank(listed);
}

export function isRemoteTaskDetailOf(listed: RemoteRunnerTask, detail: RemoteRunnerTask): boolean {
  return sameTurnIdentity(listed, detail) && followsStatus(listed, detail);
}

export function acceptsRemoteTaskUpdate(
  previous: RemoteRunnerTask,
  incoming: RemoteRunnerTask,
): boolean {
  return remoteTaskUpdate(previous, incoming) !== "keep";
}

export function mergeRemoteTasks(
  previous: readonly RemoteRunnerTask[],
  incoming: readonly RemoteRunnerTask[],
): readonly RemoteRunnerTask[] {
  const merged = new Map(previous.map((task) => [task.id, task]));
  for (const task of incoming) {
    const existing = merged.get(task.id);
    if (existing && isolationOf(existing) !== isolationOf(task))
      throw new Error("Remote task isolation changed.");
    merged.set(task.id, existing === undefined ? task : updatedTask(existing, task));
  }
  return [...merged.values()].sort((a, b) => b.sequence - a.sequence);
}
