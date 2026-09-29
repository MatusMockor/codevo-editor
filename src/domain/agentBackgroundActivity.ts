import type { AgentTurnEvent } from "./agentThread";

export const MAX_AGENT_BACKGROUND_TASKS = 256;
export const MAX_AGENT_BACKGROUND_OBSERVED_TASKS = 4096;
export const MAX_AGENT_BACKGROUND_OPEN_ROOT_TOOLS = 1024;
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
export type AgentForeground =
  | { readonly kind: "running" }
  | { readonly kind: "settled" }
  | { readonly kind: "inferredIdle"; readonly anchor: string };
export interface AgentBackgroundState {
  readonly foreground: AgentForeground;
  readonly tasks: ReadonlyArray<AgentBackgroundTask>;
  readonly truncated: boolean;
}
export type AgentInferredIdleResolution = "settled" | "pending";

/** Events are from one exact owned run. Persisted history alone never proves liveness. */
export function projectAgentBackgroundActivity(
  events: ReadonlyArray<AgentTurnEvent>,
  processAlive: boolean,
  eventsTruncated = false,
): AgentBackgroundActivity {
  return resolveAgentBackgroundActivity(
    projectAgentBackgroundState(events, processAlive, eventsTruncated),
    "pending",
  );
}

export function resolveAgentBackgroundActivity(
  state: AgentBackgroundState,
  inferredIdle: AgentInferredIdleResolution,
): AgentBackgroundActivity {
  const foregroundSettled = foregroundSettledBy(state.foreground, inferredIdle);
  const { tasks, truncated } = state;
  const phase = truncated
    ? "working"
    : tasks.length === 0
      ? "inactive"
      : !foregroundSettled ||
          tasks.some((task) => task.taskType === "agent" || task.taskType === "other")
        ? "working"
        : "monitoring";
  return { phase, foregroundSettled, tasks, truncated };
}

function foregroundSettledBy(
  foreground: AgentForeground,
  inferredIdle: AgentInferredIdleResolution,
): boolean {
  switch (foreground.kind) {
    case "running":
      return false;
    case "settled":
      return true;
    case "inferredIdle":
      return inferredIdle === "settled";
    default:
      return unreachableForeground(foreground);
  }
}

function unreachableForeground(foreground: never): never {
  throw new Error(`Unsupported foreground: ${JSON.stringify(foreground)}`);
}

export function projectAgentBackgroundState(
  events: ReadonlyArray<AgentTurnEvent>,
  processAlive: boolean,
  eventsTruncated = false,
): AgentBackgroundState {
  const observed = new Map<string, AgentBackgroundTask | null>();
  const runs = new AgentTaskRuns();
  const root = new RootForegroundTracker();
  let foregroundSettled = false;
  let truncated = processAlive && eventsTruncated;
  let liveCount = 0;
  for (const event of events) {
    root.observe(event);
    if (event.kind === "result") foregroundSettled = true;
    if (startsRootForeground(event)) foregroundSettled = false;
    if (event.kind === "subagent" && processAlive) {
      const revived = runs.resumed(event, observed);
      if (revived === null) continue;
      if (liveCount >= MAX_AGENT_BACKGROUND_TASKS) {
        truncated = true;
        continue;
      }
      liveCount += 1;
      observed.set(revived.taskId, revived);
      continue;
    }
    if (event.kind !== "backgroundTask" || !processAlive) continue;
    const previous = observed.get(event.taskId);
    if (previous === null && event.status !== "starting") continue;
    if (!observed.has(event.taskId) && observed.size >= MAX_AGENT_BACKGROUND_OBSERVED_TASKS) {
      truncated = true;
      continue;
    }
    if (event.status === "completed" || event.status === "failed" || event.status === "stopped") {
      if (previous !== undefined) liveCount -= 1;
      if (previous) runs.finish(previous);
      observed.set(event.taskId, null);
    } else if (event.status === "starting" || previous !== undefined) {
      if (!previous && liveCount >= MAX_AGENT_BACKGROUND_TASKS) {
        truncated = true;
        continue;
      }
      if (!previous) liveCount += 1;
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
  if (foregroundSettled) return { foreground: { kind: "settled" }, tasks, truncated };
  const anchor = root.idleAnchor();
  if (!processAlive || truncated || tasks.length === 0 || anchor === null)
    return { foreground: { kind: "running" }, tasks, truncated };
  return { foreground: { kind: "inferredIdle", anchor }, tasks, truncated };
}

type SubagentEvent = Extract<AgentTurnEvent, { kind: "subagent" }>;

class AgentTaskRuns {
  private readonly current = new Map<string, string>();
  private readonly finished = new Map<string, { run?: string; task: AgentBackgroundTask }>();

  resumed(
    event: SubagentEvent,
    observed: ReadonlyMap<string, AgentBackgroundTask | null>,
  ): AgentBackgroundTask | null {
    const { taskId, toolId } = event;
    if (taskId === undefined || toolId === undefined) return null;
    if (event.status !== "starting" && event.status !== "running") return null;
    this.remember(taskId, toolId);
    const finished = this.finished.get(taskId);
    if (event.status !== "running" || observed.get(taskId) !== null) return null;
    if (finished?.run === undefined || finished.run === toolId) return null;
    if (finished.task.taskType !== "agent") return null;
    this.finished.delete(taskId);
    return finished.task;
  }

  finish(task: AgentBackgroundTask): void {
    if (this.finished.size >= MAX_AGENT_BACKGROUND_OBSERVED_TASKS) return;
    const run = this.current.get(task.taskId);
    this.finished.set(task.taskId, run === undefined ? { task } : { run, task });
  }

  private remember(taskId: string, toolId: string): void {
    if (!this.current.has(taskId) && this.current.size >= MAX_AGENT_BACKGROUND_OBSERVED_TASKS)
      return;
    this.current.set(taskId, toolId);
  }
}

function startsRootForeground(event: AgentTurnEvent): boolean {
  switch (event.kind) {
    case "assistantText":
    case "reasoning":
    case "toolCall":
      return event.parentToolId === undefined;
    case "userMessage":
      return true;
    default:
      return false;
  }
}

type RootForegroundEvent = "assistantText" | "other";

class RootForegroundTracker {
  private readonly openTools = new Set<string>();
  private overflow = false;
  private last: RootForegroundEvent | null = null;
  private index = -1;
  private lastRootIndex = -1;
  private lastTextLength = 0;

  observe(event: AgentTurnEvent): void {
    this.index += 1;
    switch (event.kind) {
      case "assistantText":
        if (event.parentToolId !== undefined) return;
        this.markRoot("assistantText", event.text.length);
        return;
      case "reasoning":
        if (event.parentToolId !== undefined) return;
        this.markRoot("other", 0);
        return;
      case "toolCall":
        if (event.parentToolId !== undefined) return;
        this.markRoot("other", 0);
        this.openTool(event.toolId);
        return;
      case "toolResult":
        if (event.parentToolId !== undefined) return;
        this.markRoot("other", 0);
        this.openTools.delete(event.toolId);
        return;
      case "userMessage":
      case "error":
        this.markRoot("other", 0);
        return;
      default:
        return;
    }
  }

  idleAnchor(): string | null {
    if (this.last !== "assistantText" || this.openTools.size > 0 || this.overflow) return null;
    return `${this.lastRootIndex}:${this.lastTextLength}`;
  }

  private markRoot(kind: RootForegroundEvent, textLength: number): void {
    this.last = kind;
    this.lastRootIndex = this.index;
    this.lastTextLength = textLength;
  }

  private openTool(toolId: string): void {
    if (this.openTools.has(toolId)) return;
    if (this.openTools.size >= MAX_AGENT_BACKGROUND_OPEN_ROOT_TOOLS) {
      this.overflow = true;
      return;
    }
    this.openTools.add(toolId);
  }
}
