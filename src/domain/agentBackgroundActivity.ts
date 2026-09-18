import type { AgentTurnEvent } from "./agentThread";

export const MAX_AGENT_BACKGROUND_TASKS = 256;
export const MAX_AGENT_BACKGROUND_OBSERVED_TASKS = 4096;
export type AgentBackgroundTask = Pick<
  Extract<AgentTurnEvent, { kind: "backgroundTask" }>,
  "taskId" | "taskType" | "description"
>;
export interface AgentBackgroundActivity {
  readonly phase: "inactive" | "working" | "monitoring";
  readonly foregroundSettled: boolean;
  readonly tasks: ReadonlyArray<AgentBackgroundTask>;
  readonly truncated: boolean;
}

/** Events are from one exact owned run. Persisted history alone never proves liveness. */
export function projectAgentBackgroundActivity(
  events: ReadonlyArray<AgentTurnEvent>,
  processAlive: boolean,
  eventsTruncated = false,
): AgentBackgroundActivity {
  const observed = new Map<string, AgentBackgroundTask | null>();
  let foregroundSettled = false;
  let truncated = processAlive && eventsTruncated;
  let liveCount = 0;
  for (const event of events) {
    if (event.kind === "result") foregroundSettled = true;
    if (
      (event.kind === "assistantText" || event.kind === "toolCall") &&
      event.parentToolId === undefined
    )
      foregroundSettled = false;
    if (event.kind !== "backgroundTask" || !processAlive) continue;
    const previous = observed.get(event.taskId);
    // Tombstones prohibit duplicate/stale starts or progress resurrecting completed work.
    if (previous === null) continue;
    if (!observed.has(event.taskId) && observed.size >= MAX_AGENT_BACKGROUND_OBSERVED_TASKS) {
      truncated = true;
      continue;
    }
    if (event.status === "completed" || event.status === "failed" || event.status === "stopped") {
      if (previous !== undefined) liveCount -= 1;
      observed.set(event.taskId, null);
    } else if (event.status === "starting" || previous !== undefined) {
      if (previous === undefined && liveCount >= MAX_AGENT_BACKGROUND_TASKS) {
        truncated = true;
        continue;
      }
      if (previous === undefined) liveCount += 1;
      observed.set(event.taskId, {
        taskId: event.taskId,
        taskType: event.taskType === "other" && previous ? previous.taskType : event.taskType,
        ...(event.description !== undefined
          ? { description: event.description }
          : previous?.description !== undefined
            ? { description: previous.description }
            : {}),
      });
    }
  }
  const tasks = [...observed.values()].filter((task): task is AgentBackgroundTask => task !== null);
  const phase = !processAlive
    ? "inactive"
    : truncated
      ? "working"
      : tasks.length === 0
        ? "inactive"
        : !foregroundSettled ||
            tasks.some((task) => task.taskType === "agent" || task.taskType === "other")
          ? "working"
          : "monitoring";
  return { phase, foregroundSettled, tasks, truncated };
}
