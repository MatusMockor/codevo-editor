import type { AgentTurnEvent } from "../agentTurnEvent.js";

const MONITOR_TOOL = "Monitor";
const MAX_PENDING_MONITOR_CALLS = 64;
const MAX_MONITOR_TASKS = 256;
const NO_IDS: ReadonlySet<string> = new Set();

type BackgroundEvent = Extract<AgentTurnEvent, { kind: "backgroundTask" }>;
type Frame = Readonly<Record<string, unknown>>;

export interface ClaudeMonitorTasks {
  readonly calls: ReadonlySet<string>;
  readonly tasks: ReadonlySet<string>;
}

export function classifyClaudeMonitorTasks(
  previous: ClaudeMonitorTasks | undefined,
  line: string,
  events: ReadonlyArray<AgentTurnEvent>,
): {
  readonly state: ClaudeMonitorTasks | undefined;
  readonly events: ReadonlyArray<AgentTurnEvent>;
} {
  if (!events.some(concernsMonitors)) return { state: previous, events };
  const calls = new Set(previous?.calls ?? NO_IDS);
  const tasks = new Set(previous?.tasks ?? NO_IDS);
  const root = rootFrame(line);
  const classified = events.map((event) => {
    if (event.kind === "toolCall") {
      if (root !== null) rememberCall(calls, event);
      return event;
    }
    if (event.kind !== "backgroundTask") return event;
    return classifiedTask(calls, tasks, root, event);
  });
  return { state: { calls, tasks }, events: classified };
}

function concernsMonitors(event: AgentTurnEvent): boolean {
  if (event.kind === "backgroundTask") return true;
  return event.kind === "toolCall" && isRootMonitorCall(event);
}

function isRootMonitorCall(event: Extract<AgentTurnEvent, { kind: "toolCall" }>): boolean {
  return event.name === MONITOR_TOOL && event.parentToolId === undefined;
}

function rememberCall(
  calls: Set<string>,
  event: Extract<AgentTurnEvent, { kind: "toolCall" }>,
): void {
  if (!isRootMonitorCall(event)) return;
  calls.delete(event.toolId);
  calls.add(event.toolId);
  for (const oldest of calls) {
    if (calls.size <= MAX_PENDING_MONITOR_CALLS) return;
    calls.delete(oldest);
  }
}

function classifiedTask(
  calls: Set<string>,
  tasks: Set<string>,
  root: Frame | null,
  event: BackgroundEvent,
): BackgroundEvent {
  if (tasks.has(event.taskId)) return knownMonitor(tasks, event);
  if (event.status !== "starting" || calls.size === 0) return event;
  if (tasks.size >= MAX_MONITOR_TASKS) return event;
  const call = startingToolUseId(root, event.taskId);
  if (call === null || !calls.delete(call)) return event;
  tasks.add(event.taskId);
  return { ...event, taskType: "monitor" };
}

function knownMonitor(tasks: Set<string>, event: BackgroundEvent): BackgroundEvent {
  if (ended(event.status)) tasks.delete(event.taskId);
  return { ...event, taskType: "monitor" };
}

function ended(status: BackgroundEvent["status"]): boolean {
  switch (status) {
    case "completed":
    case "failed":
    case "stopped":
      return true;
    case "starting":
    case "running":
      return false;
    default:
      return unsupportedStatus(status);
  }
}

function startingToolUseId(root: Frame | null, taskId: string): string | null {
  if (root === null || root.subtype !== "task_started" || root.task_id !== taskId) return null;
  return typeof root.tool_use_id === "string" ? root.tool_use_id : null;
}

function rootFrame(line: string): Frame | null {
  const frame = parsedFrame(line);
  if (frame === null || frame.parent_tool_use_id != null) return null;
  return frame;
}

function parsedFrame(line: string): Frame | null {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return value as Frame;
  } catch {
    return null;
  }
}

function unsupportedStatus(status: never): never {
  throw new TypeError(`Unsupported background task status: ${String(status)}.`);
}
