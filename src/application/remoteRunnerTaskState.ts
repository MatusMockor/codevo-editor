import type { RemoteRunnerTask } from "../domain/remoteRunner";

export function isRemoteTaskTerminal(task: RemoteRunnerTask): boolean {
  return !["draft", "queued", "running"].includes(task.status);
}

export function acceptsRemoteTaskUpdate(
  previous: RemoteRunnerTask,
  incoming: RemoteRunnerTask,
): boolean {
  const rank = (task: RemoteRunnerTask): number =>
    task.status === "draft" ? 0 : task.status === "queued" ? 1 : task.status === "running" ? 2 : 3;
  return !isRemoteTaskTerminal(previous) && rank(incoming) >= rank(previous);
}

export function mergeRemoteTasks(
  previous: readonly RemoteRunnerTask[],
  incoming: readonly RemoteRunnerTask[],
): readonly RemoteRunnerTask[] {
  const merged = new Map(previous.map((task) => [task.id, task]));
  for (const task of incoming) {
    const existing = merged.get(task.id);
    if (existing === undefined || acceptsRemoteTaskUpdate(existing, task))
      merged.set(task.id, task);
  }
  return [...merged.values()].sort((a, b) => b.sequence - a.sequence);
}
