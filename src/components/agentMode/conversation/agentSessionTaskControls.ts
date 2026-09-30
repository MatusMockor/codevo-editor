import type { AgentBackgroundTask } from "../../../domain/agentBackgroundActivity";
import type { AgentSessionBackground } from "../../../domain/agentSessionBackground";

export type AgentSessionEndOffer = "hidden" | "offered" | "suggested";

export interface AgentSessionTaskControls {
  readonly pendingTaskIds: ReadonlySet<string>;
  readonly endSession: AgentSessionEndOffer;
}

export function agentSessionTaskControls(
  session: AgentSessionBackground | null,
  pendingTaskIds: ReadonlySet<string>,
  endSession: AgentSessionEndOffer,
  previous: AgentSessionTaskControls | null = null,
): AgentSessionTaskControls | null {
  if (session === null || session.tasks.length === 0) return null;
  const live = new Set(session.tasks.map((task) => task.taskId));
  const pending = new Set([...pendingTaskIds].filter((taskId) => live.has(taskId)));
  if (previous === null || !sameTaskIds(previous.pendingTaskIds, pending))
    return { pendingTaskIds: pending, endSession };
  if (previous.endSession === endSession) return previous;
  return { pendingTaskIds: previous.pendingTaskIds, endSession };
}

function sameTaskIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((taskId) => right.has(taskId));
}

export function agentSessionTaskLabel(task: AgentBackgroundTask): string {
  const description = task.description?.trim() ?? "";
  if (description !== "") return description;
  return `${taskTypeLabel(task.taskType)} ${task.taskId}`;
}

function taskTypeLabel(taskType: AgentBackgroundTask["taskType"]): string {
  switch (taskType) {
    case "shell":
      return "Shell command";
    case "agent":
      return "Agent";
    case "monitor":
      return "Monitor";
    case "other":
      return "Background task";
    default:
      return unsupportedTaskType(taskType);
  }
}

function unsupportedTaskType(taskType: never): never {
  throw new TypeError(`Unsupported background task type: ${String(taskType)}.`);
}
