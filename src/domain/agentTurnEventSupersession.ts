import type { AgentTurnEvent } from "./agentThread";

export type AgentTurnKeyedSnapshotScope = "backgroundTask" | "subagentUsage" | "contextUsage";
export type AgentTurnSnapshotScope = AgentTurnKeyedSnapshotScope | "subagent";

export interface AgentTurnSubagentIds {
  readonly toolId?: string;
  readonly taskId?: string;
}

export type AgentTurnSnapshotTarget =
  | {
      readonly reach: "identity";
      readonly scope: AgentTurnKeyedSnapshotScope;
      readonly identity: string;
    }
  | { readonly reach: "subagentIds"; readonly ids: AgentTurnSubagentIds };

export type AgentTurnBarrierTarget =
  AgentTurnSnapshotTarget | { readonly reach: "scope"; readonly scope: AgentTurnSnapshotScope };

export type AgentTurnEventSupersession =
  | { readonly kind: "snapshot"; readonly target: AgentTurnSnapshotTarget }
  | { readonly kind: "barrier"; readonly targets: ReadonlyArray<AgentTurnBarrierTarget> }
  | { readonly kind: "content" };

type BackgroundTaskEvent = Extract<AgentTurnEvent, { kind: "backgroundTask" }>;
type SubagentEvent = Extract<AgentTurnEvent, { kind: "subagent" }>;
type SubagentActivityEvent = Extract<AgentTurnEvent, { kind: "subagentActivity" }>;
type ContextUsageEvent = Extract<AgentTurnEvent, { kind: "contextUsage" }>;
type ToolEvent = Extract<AgentTurnEvent, { kind: "toolCall" | "toolResult" }>;

const CONTENT: AgentTurnEventSupersession = { kind: "content" };
const SUBAGENT_SCOPE: AgentTurnBarrierTarget = { reach: "scope", scope: "subagent" };
const CONTEXT_BARRIER: AgentTurnEventSupersession = {
  kind: "barrier",
  targets: [{ reach: "scope", scope: "contextUsage" }],
};

export function agentTurnEventSupersession(event: AgentTurnEvent): AgentTurnEventSupersession {
  switch (event.kind) {
    case "backgroundTask":
      return backgroundTaskSupersession(event);
    case "subagent":
      return subagentSupersession(event);
    case "subagentUsage":
      return { kind: "snapshot", target: subagentUsageTarget(event.agentThreadId) };
    case "contextUsage":
      return contextUsageSupersession(event);
    case "contextCompaction":
    case "error":
      return CONTEXT_BARRIER;
    case "result":
      return event.isError ? CONTEXT_BARRIER : CONTENT;
    case "contextCompactionStatus":
      return event.status === "idle" ? CONTENT : CONTEXT_BARRIER;
    case "subagentActivity":
      return subagentActivitySupersession(event);
    case "subagentTurnDone":
      return {
        kind: "barrier",
        targets: [SUBAGENT_SCOPE, subagentUsageTarget(event.agentThreadId)],
      };
    case "toolCall":
    case "toolResult":
      return toolSupersession(event);
    case "subagentEvent":
    case "queued":
    case "assistantText":
    case "reasoning":
    case "userMessage":
    case "unknownLine":
      return CONTENT;
    default:
      return unsupportedSupersessionEvent(event);
  }
}

export function isAgentTurnSnapshotEvent(event: AgentTurnEvent): boolean {
  return agentTurnEventSupersession(event).kind === "snapshot";
}

export function isAgentTurnCoalescibleTextEvent(event: AgentTurnEvent): boolean {
  return (
    event.kind === "assistantText" || event.kind === "reasoning" || event.kind === "subagentEvent"
  );
}

export function agentTurnSubagentAlias(
  event: AgentTurnEvent,
): Required<AgentTurnSubagentIds> | null {
  if (event.kind !== "subagent") return null;
  if (event.toolId === undefined || event.taskId === undefined) return null;
  return { toolId: event.toolId, taskId: event.taskId };
}

export function withAgentTurnSubagentIds(
  event: AgentTurnEvent,
  ids: AgentTurnSubagentIds,
): AgentTurnEvent {
  if (event.kind !== "subagent") return event;
  const toolId = event.toolId ?? ids.toolId;
  const taskId = event.taskId ?? ids.taskId;
  if (toolId === event.toolId && taskId === event.taskId) return event;
  return { ...event, ...defined("toolId", toolId), ...defined("taskId", taskId) };
}

export function mergeSupersededAgentTurnEvent(
  previous: AgentTurnEvent,
  next: AgentTurnEvent,
): AgentTurnEvent | null {
  if (previous.kind === "backgroundTask" && next.kind === "backgroundTask")
    return mergeBackgroundTask(previous, next);
  if (previous.kind === "subagent" && next.kind === "subagent")
    return mergeSubagent(previous, next);
  if (previous.kind === "subagentUsage" && next.kind === "subagentUsage")
    return previous.agentThreadId === next.agentThreadId ? next : null;
  if (previous.kind === "contextUsage" && next.kind === "contextUsage")
    return contextUsageIdentity(previous) === contextUsageIdentity(next) ? next : null;
  return null;
}

function backgroundTaskSupersession(event: BackgroundTaskEvent): AgentTurnEventSupersession {
  const task: AgentTurnSnapshotTarget = {
    reach: "identity",
    scope: "backgroundTask",
    identity: event.taskId,
  };
  if (event.status === "running") return { kind: "snapshot", target: task };
  return {
    kind: "barrier",
    targets: [task, { reach: "subagentIds", ids: { taskId: event.taskId } }],
  };
}

function subagentSupersession(event: SubagentEvent): AgentTurnEventSupersession {
  const target: AgentTurnSnapshotTarget = { reach: "subagentIds", ids: subagentIds(event) };
  if (event.status !== "running") return { kind: "barrier", targets: [target] };
  if (event.toolId === undefined && event.taskId === undefined) return CONTENT;
  return { kind: "snapshot", target };
}

function subagentActivitySupersession(event: SubagentActivityEvent): AgentTurnEventSupersession {
  if (event.activity === "interacted") return { kind: "barrier", targets: [SUBAGENT_SCOPE] };
  return { kind: "barrier", targets: [SUBAGENT_SCOPE, subagentUsageTarget(event.agentThreadId)] };
}

function toolSupersession(event: ToolEvent): AgentTurnEventSupersession {
  if (event.parentToolId !== undefined) return CONTENT;
  return { kind: "barrier", targets: [{ reach: "subagentIds", ids: { toolId: event.toolId } }] };
}

function subagentUsageTarget(agentThreadId: string): AgentTurnSnapshotTarget {
  return { reach: "identity", scope: "subagentUsage", identity: agentThreadId };
}

function subagentIds(event: SubagentEvent): AgentTurnSubagentIds {
  const { toolId, taskId } = event;
  if (toolId !== undefined && taskId !== undefined) return { toolId, taskId };
  if (toolId !== undefined) return { toolId };
  if (taskId !== undefined) return { taskId };
  return {};
}

function subagentIdentity(event: SubagentEvent): string {
  return JSON.stringify([event.toolId ?? null, event.taskId ?? null]);
}

function contextUsageSupersession(event: ContextUsageEvent): AgentTurnEventSupersession {
  const identity = contextUsageIdentity(event);
  if (identity === null) return CONTEXT_BARRIER;
  return { kind: "snapshot", target: { reach: "identity", scope: "contextUsage", identity } };
}

function contextUsageIdentity(event: ContextUsageEvent): string | null {
  if (event.contextWindow === null && validCount(event.inputTokens, 0)) return "occupancy";
  if (event.inputTokens === null && validCount(event.contextWindow, 1))
    return `capacity:${event.model}`;
  return null;
}

function validCount(value: number | null, minimum: number): boolean {
  return value !== null && Number.isSafeInteger(value) && value >= minimum;
}

function mergeBackgroundTask(
  previous: BackgroundTaskEvent,
  next: BackgroundTaskEvent,
): BackgroundTaskEvent | null {
  if (previous.status !== "running" || next.status !== "running") return null;
  if (previous.taskId !== next.taskId) return null;
  const description = next.description ?? previous.description;
  return {
    kind: "backgroundTask",
    taskId: next.taskId,
    status: "running",
    taskType: next.taskType === "other" ? previous.taskType : next.taskType,
    ...(description === undefined ? {} : { description }),
  };
}

function mergeSubagent(previous: SubagentEvent, next: SubagentEvent): SubagentEvent | null {
  if (previous.status !== "running" || next.status !== "running") return null;
  if (subagentIdentity(previous) !== subagentIdentity(next)) return null;
  if (conflicting(previous.description, next.description)) return null;
  return {
    kind: "subagent",
    status: "running",
    ...defined("toolId", next.toolId),
    ...defined("taskId", next.taskId),
    ...defined("subagentType", next.subagentType ?? previous.subagentType),
    ...defined("description", previous.description ?? next.description),
    ...defined("durationMs", next.durationMs ?? previous.durationMs),
    ...defined("totalTokens", next.totalTokens ?? previous.totalTokens),
    ...defined("toolUses", next.toolUses ?? previous.toolUses),
    ...defined("lastToolName", next.lastToolName ?? previous.lastToolName),
  };
}

function conflicting(previous: string | undefined, next: string | undefined): boolean {
  return previous !== undefined && next !== undefined && previous !== next;
}

function defined<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  if (value === undefined) return {};
  return { [key]: value } as { [P in K]?: V };
}

function unsupportedSupersessionEvent(event: never): never {
  throw new TypeError(`Unsupported agent turn event: ${JSON.stringify(event)}`);
}
