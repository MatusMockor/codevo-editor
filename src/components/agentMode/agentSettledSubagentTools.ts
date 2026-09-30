import type { AgentTurnEvent } from "../../domain/agentThread";

export type AgentSubagentOutcome = "completed" | "failed" | "stopped";

type SubagentEvent = Extract<AgentTurnEvent, { kind: "subagent" }>;
type BackgroundTaskEvent = Extract<AgentTurnEvent, { kind: "backgroundTask" }>;
type Observation = { readonly order: number; readonly outcome: AgentSubagentOutcome | null };

export function agentSettledSubagentTools(
  events: ReadonlyArray<AgentTurnEvent>,
): ReadonlyMap<string, AgentSubagentOutcome> {
  const byTool = new Map<string, Observation>();
  const byTask = new Map<string, Observation>();
  const taskOfTool = new Map<string, string>();
  events.forEach((event, order) => {
    if (event.kind === "backgroundTask") {
      byTask.set(event.taskId, { order, outcome: backgroundTaskOutcome(event.status) });
      return;
    }
    if (event.kind !== "subagent") return;
    const observation = { order, outcome: subagentOutcome(event.status) };
    if (event.toolId !== undefined) byTool.set(event.toolId, observation);
    if (event.taskId === undefined) return;
    byTask.set(event.taskId, observation);
    if (event.toolId !== undefined) taskOfTool.set(event.toolId, event.taskId);
  });
  const settled = new Map<string, AgentSubagentOutcome>();
  for (const [toolId, own] of byTool) {
    const taskId = taskOfTool.get(toolId);
    const task = taskId === undefined ? undefined : byTask.get(taskId);
    const latest = task !== undefined && task.order > own.order ? task : own;
    if (latest.outcome !== null) settled.set(toolId, latest.outcome);
  }
  return settled;
}

function subagentOutcome(status: SubagentEvent["status"]): AgentSubagentOutcome | null {
  switch (status) {
    case "starting":
    case "running":
      return null;
    case "completed":
    case "failed":
      return status;
    default:
      return unsupportedStatus(status);
  }
}

function backgroundTaskOutcome(status: BackgroundTaskEvent["status"]): AgentSubagentOutcome | null {
  switch (status) {
    case "starting":
    case "running":
      return null;
    case "completed":
    case "failed":
    case "stopped":
      return status;
    default:
      return unsupportedStatus(status);
  }
}

function unsupportedStatus(status: never): never {
  throw new TypeError(`Unsupported subagent status: ${String(status)}`);
}
