export const AGENT_SUBAGENT_SPAWN_STATUSES = [
  "inProgress",
  "completed",
  "failed",
  "interrupted",
] as const;
export type AgentSubagentSpawnStatus = (typeof AGENT_SUBAGENT_SPAWN_STATUSES)[number];

export const AGENT_SUBAGENT_SPAWN_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
export type AgentSubagentSpawnEffort = (typeof AGENT_SUBAGENT_SPAWN_EFFORTS)[number];

export const MAX_AGENT_SUBAGENT_SPAWN_ID_BYTES = 256;
export const MAX_AGENT_SUBAGENT_SPAWN_TITLE_BYTES = 480;
export const MAX_AGENT_SUBAGENT_SPAWN_MODEL_BYTES = 64;
export const MAX_AGENT_SUBAGENT_SPAWN_THREADS = 32;

export interface AgentSubagentSpawnEvent {
  readonly kind: "subagentSpawn";
  readonly callId: string;
  readonly status: AgentSubagentSpawnStatus;
  readonly taskTitle: string | null;
  readonly model: string | null;
  readonly reasoningEffort: AgentSubagentSpawnEffort | null;
  readonly agentThreadIds: ReadonlyArray<string>;
}

const encoder = new TextEncoder();
const CONTROL = /\p{Cc}/u;

export function parseAgentSubagentSpawnFields(
  value: Readonly<Record<string, unknown>>,
): AgentSubagentSpawnEvent {
  const ids = value.agentThreadIds;
  if (!Array.isArray(ids) || ids.length > MAX_AGENT_SUBAGENT_SPAWN_THREADS) fail("agentThreadIds");
  const agentThreadIds = ids.map((id) => boundedText(id, MAX_AGENT_SUBAGENT_SPAWN_ID_BYTES, "id"));
  if (new Set(agentThreadIds).size !== agentThreadIds.length) fail("agentThreadIds");
  return {
    kind: "subagentSpawn",
    callId: boundedText(value.callId, MAX_AGENT_SUBAGENT_SPAWN_ID_BYTES, "callId"),
    status: member(value.status, AGENT_SUBAGENT_SPAWN_STATUSES, "status"),
    taskTitle: nullable(value.taskTitle, (title) =>
      boundedText(title, MAX_AGENT_SUBAGENT_SPAWN_TITLE_BYTES, "taskTitle"),
    ),
    model: nullable(value.model, (model) =>
      boundedText(model, MAX_AGENT_SUBAGENT_SPAWN_MODEL_BYTES, "model"),
    ),
    reasoningEffort: nullable(value.reasoningEffort, (effort) =>
      member(effort, AGENT_SUBAGENT_SPAWN_EFFORTS, "reasoningEffort"),
    ),
    agentThreadIds,
  };
}

function boundedText(value: unknown, maxBytes: number, field: string): string {
  if (typeof value !== "string" || value === "" || CONTROL.test(value)) fail(field);
  if (encoder.encode(value).length > maxBytes) fail(field);
  return value;
}

function member<T extends string>(value: unknown, allowed: ReadonlyArray<T>, field: string): T {
  if (typeof value !== "string" || !(allowed as ReadonlyArray<string>).includes(value)) fail(field);
  return value as T;
}

function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function fail(field: string): never {
  throw new TypeError(`Invalid subagent spawn field: ${field}.`);
}
