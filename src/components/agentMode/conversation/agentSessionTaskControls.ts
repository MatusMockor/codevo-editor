import type { AgentBackgroundTask } from "../../../domain/agentBackgroundActivity";
import type { AgentSessionBackground } from "../../../domain/agentSessionBackground";

export const MAX_AGENT_SESSION_TASK_ROWS = 3;

export interface AgentSessionTaskRow {
  readonly taskId: string;
  readonly label: string;
  readonly stopLabel: string;
  readonly pending: boolean;
}

export type AgentSessionEndOffer = "hidden" | "offered" | "suggested";

export interface AgentSessionTaskControls {
  readonly rows: ReadonlyArray<AgentSessionTaskRow>;
  readonly hiddenCount: number;
  readonly endSession: AgentSessionEndOffer;
}

export function agentSessionTaskControls(
  session: AgentSessionBackground | null,
  pendingTaskIds: ReadonlySet<string>,
  endSession: AgentSessionEndOffer,
): AgentSessionTaskControls | null {
  if (session === null || session.tasks.length === 0) return null;
  const rows = session.tasks.slice(0, MAX_AGENT_SESSION_TASK_ROWS).map((task) => {
    const label = agentSessionTaskLabel(task);
    return {
      taskId: task.taskId,
      label,
      stopLabel: `Stop background task "${label}"`,
      pending: pendingTaskIds.has(task.taskId),
    };
  });
  return {
    rows,
    hiddenCount: Math.max(session.total, session.tasks.length) - rows.length,
    endSession,
  };
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
