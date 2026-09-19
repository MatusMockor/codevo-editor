import { MAX_RUNTIME_SUBAGENT_TITLE_CHARACTERS } from "./agentRuntimeSubagent";
import type { AgentTurnEvent } from "./agentThread";

export const MAX_RETAINED_SUBAGENTS = 32;
export const MAX_SUBAGENT_TASK_TITLE_BYTES = MAX_RUNTIME_SUBAGENT_TITLE_CHARACTERS * 4;
export const MAX_SUBAGENT_BATCH_KEY_BYTES = 272;
export const MAX_SUBAGENT_PARENT_TOOL_ID_BYTES = 256;
export const MAX_SUBAGENT_NESTED_COUNT = 999;
export const MAX_SUBAGENT_COUNTED_NESTED_IDS = 32;
const MAX_NESTED_ANCESTOR_DEPTH = 8;
const SPAWN_BATCH_KEY_PREFIX = "spawn:";
export type AgentSubagentLifecycleState = "running" | "completed" | "failed" | "interrupted";
export interface AgentSubagentLifecycleEntry {
  readonly id: string;
  readonly toolId?: string;
  readonly taskId?: string;
  readonly agentThreadId?: string;
  readonly name: string;
  readonly description: string;
  readonly state: AgentSubagentLifecycleState;
  readonly telemetryState?: AgentSubagentLifecycleState;
  readonly resultState?: "completed" | "failed";
  readonly durationMs?: number;
  readonly totalTokens?: number;
  readonly steps?: number;
  readonly lastToolName?: string;
  readonly taskTitle?: string;
  readonly batchKey?: string;
  readonly nestedCount?: number;
  readonly parentToolId?: string;
}
export interface AgentSubagentLifecycle {
  readonly entries: ReadonlyArray<AgentSubagentLifecycleEntry>;
  readonly truncated: boolean;
  readonly openBatchKey?: string;
  readonly countedNestedToolIds?: ReadonlyArray<string>;
}
type SubagentEventIdentity = {
  readonly toolId?: string;
  readonly taskId?: string;
  readonly agentThreadId?: string;
};
const encoder = new TextEncoder();
function clip(value: string, bytes: number): string {
  const encoded = encoder.encode(value);
  if (encoded.length <= bytes) return value;
  let end = bytes;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1;
  return new TextDecoder().decode(encoded.subarray(0, end));
}
function validId(id: string | undefined): id is string {
  return id !== undefined && id.length > 0 && encoder.encode(id).length <= 256;
}
function spawn(name: string): boolean {
  return name === "Task" || name === "Agent" || name === "SpawnAgent" || name === "spawn_agent";
}
export function isAgentSubagentSpawnToolName(name: string): boolean {
  return spawn(name);
}

export function closesAgentSubagentSpawnBatch(event: AgentTurnEvent): boolean {
  switch (event.kind) {
    case "toolCall":
      return event.parentToolId === undefined && !spawn(event.name);
    case "assistantText":
      return event.parentToolId === undefined && event.text.trim() !== "";
    case "toolResult":
      return event.parentToolId === undefined;
    case "userMessage":
    case "result":
      return true;
    default:
      return false;
  }
}

function taskTitleOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const line = value.trim().replace(/\s+/gu, " ");
  if (line === "") return undefined;
  return [...line].slice(0, MAX_RUNTIME_SUBAGENT_TITLE_CHARACTERS).join("");
}

function backgroundTaskIdentity(
  event: Extract<AgentTurnEvent, { kind: "backgroundTask" }>,
): SubagentEventIdentity | null {
  if (event.status === "starting" && event.taskType === "agent") return { taskId: event.taskId };
  if (event.status !== "stopped") return null;
  if (event.taskType !== "agent" && event.taskType !== "other") return null;
  return { taskId: event.taskId };
}

function subagentEventIdentity(event: AgentTurnEvent): SubagentEventIdentity | null {
  switch (event.kind) {
    case "toolCall":
      return event.parentToolId === undefined && spawn(event.name)
        ? { toolId: event.toolId }
        : null;
    case "toolResult":
      return event.parentToolId === undefined ? { toolId: event.toolId } : null;
    case "subagent":
      return { toolId: event.toolId, taskId: event.taskId };
    case "backgroundTask":
      return backgroundTaskIdentity(event);
    case "subagentActivity":
    case "subagentTurnDone":
      return { agentThreadId: event.agentThreadId };
    default:
      return null;
  }
}

function nestedRoot(
  entries: ReadonlyMap<string, AgentSubagentLifecycleEntry>,
  parentToolId: string,
): AgentSubagentLifecycleEntry | undefined {
  let toolId: string | undefined = parentToolId;
  for (let depth = 0; depth < MAX_NESTED_ANCESTOR_DEPTH && toolId !== undefined; depth += 1) {
    const current: string = toolId;
    const parent = [...entries.values()].find((entry) => entry.toolId === current);
    if (parent === undefined) return undefined;
    if (parent.parentToolId === undefined) return parent;
    toolId = parent.parentToolId;
  }
  return undefined;
}

function rememberCountedNested(counted: Set<string>, toolId: string): void {
  counted.add(toolId);
  for (const oldest of counted) {
    if (counted.size <= MAX_SUBAGENT_COUNTED_NESTED_IDS) break;
    counted.delete(oldest);
  }
}

function resolveAlias(
  entries: Map<string, AgentSubagentLifecycleEntry>,
  identity: SubagentEventIdentity,
): AgentSubagentLifecycleEntry | undefined {
  const { toolId, taskId, agentThreadId } = identity;
  const [first, ...aliases] = [...entries.values()].filter(
    (entry) =>
      (toolId !== undefined && entry.toolId === toolId) ||
      (taskId !== undefined && entry.taskId === taskId) ||
      (agentThreadId !== undefined && entry.agentThreadId === agentThreadId),
  );
  if (first === undefined) return undefined;
  let found = first;
  for (const alias of aliases) {
    entries.delete(alias.id);
    found = mergeAliases(found, alias);
  }
  entries.set(found.id, found);
  return found;
}

function retainNestedSpawn(
  entries: Map<string, AgentSubagentLifecycleEntry>,
  counted: Set<string>,
  event: Extract<AgentTurnEvent, { kind: "toolCall" }>,
  parentToolId: string,
): "retained" | "truncated" {
  if (!validId(event.toolId) || !validId(parentToolId)) return "truncated";
  const existing = resolveAlias(entries, { toolId: event.toolId });
  if (existing?.parentToolId !== undefined) return "retained";
  if (counted.has(event.toolId)) return "retained";
  const root = nestedRoot(entries, parentToolId);
  if (root === undefined) return "truncated";
  if (existing?.id === root.id) return "retained";
  entries.set(root.id, {
    ...root,
    nestedCount: Math.min(MAX_SUBAGENT_NESTED_COUNT, (root.nestedCount ?? 0) + 1),
  });
  const description = clip(event.description ?? event.inputSummary, 512);
  const taskTitle = existing?.taskTitle ?? taskTitleOf(event.description ?? event.inputSummary);
  if (existing !== undefined) {
    entries.set(existing.id, {
      ...existing,
      parentToolId,
      description: existing.description || description,
      ...(taskTitle === undefined ? {} : { taskTitle }),
    });
    return "retained";
  }
  if (entries.size >= MAX_RETAINED_SUBAGENTS) {
    rememberCountedNested(counted, event.toolId);
    return "truncated";
  }
  entries.set(`tool:${event.toolId}`, {
    id: `tool:${event.toolId}`,
    toolId: event.toolId,
    parentToolId,
    name: clip(event.name, 128),
    description,
    state: "running",
    ...(taskTitle === undefined ? {} : { taskTitle }),
  });
  return "retained";
}

/** Lifecycle-only metadata outlives the bounded output window; terminal entries are tombstones. */
export function retainAgentSubagentLifecycle(
  previous: AgentSubagentLifecycle | undefined,
  events: ReadonlyArray<AgentTurnEvent>,
): AgentSubagentLifecycle | undefined {
  const entries = new Map((previous?.entries ?? []).map((entry) => [entry.id, entry]));
  const counted = new Set(previous?.countedNestedToolIds ?? []);
  let truncated = previous?.truncated ?? false;
  let openBatchKey = previous?.openBatchKey;
  let changed = false;
  for (const event of events) {
    if (openBatchKey !== undefined && closesAgentSubagentSpawnBatch(event)) {
      openBatchKey = undefined;
      changed = true;
    }
    if (event.kind === "toolCall" && event.parentToolId !== undefined && spawn(event.name)) {
      if (retainNestedSpawn(entries, counted, event, event.parentToolId) === "truncated")
        truncated = true;
      changed = true;
      continue;
    }
    // Codex child thread telemetry is authoritative. Spawn-tool acknowledgements
    // have no child identity and must not count as additional agents.
    if (event.kind === "subagentActivity" || event.kind === "subagentTurnDone") {
      for (const [id, entry] of entries) {
        if (entry.name === "spawn_agent" || entry.name === "SpawnAgent") entries.delete(id);
      }
    }
    if (
      event.kind === "toolCall" &&
      (event.name === "spawn_agent" || event.name === "SpawnAgent") &&
      [...entries.values()].some((entry) => entry.agentThreadId !== undefined)
    )
      continue;
    const identity = subagentEventIdentity(event);
    if (identity === null) continue;
    const { toolId, taskId, agentThreadId } = identity;
    const found = resolveAlias(entries, identity);
    if (event.kind === "toolResult" && found === undefined) continue;
    if (event.kind === "backgroundTask" && found === undefined && event.taskType !== "agent")
      continue;
    if (event.kind === "backgroundTask" && found === undefined && event.status !== "stopped")
      continue;
    const key =
      found?.id ??
      (validId(toolId)
        ? `tool:${toolId}`
        : validId(taskId)
          ? `task:${taskId}`
          : validId(agentThreadId)
            ? `thread:${agentThreadId}`
            : null);
    if (key === null) {
      truncated = true;
      changed = true;
      continue;
    }
    if (found === undefined && entries.size >= MAX_RETAINED_SUBAGENTS) {
      truncated = true;
      changed = true;
      continue;
    }
    let entry: AgentSubagentLifecycleEntry = found ?? {
      id: key,
      name: "subagent",
      description: "",
      state: "running",
    };
    entry = {
      ...entry,
      ...(validId(toolId) ? { toolId } : {}),
      ...(validId(taskId) ? { taskId } : {}),
      ...(validId(agentThreadId) ? { agentThreadId } : {}),
    };
    if (event.kind === "toolCall") {
      const taskTitle = entry.taskTitle ?? taskTitleOf(event.description ?? event.inputSummary);
      if (entry.batchKey === undefined) openBatchKey ??= spawnBatchKey(toolId);
      const batchKey = entry.batchKey ?? openBatchKey;
      entry = {
        ...entry,
        name: clip(event.name, 128),
        description: clip(event.description ?? event.inputSummary, 512),
        ...(taskTitle === undefined ? {} : { taskTitle }),
        ...(batchKey === undefined ? {} : { batchKey }),
      };
    }
    if (
      (event.kind === "subagent" || event.kind === "backgroundTask") &&
      event.status === "starting" &&
      entry.taskTitle === undefined
    ) {
      const taskTitle = taskTitleOf(event.description);
      entry = { ...entry, ...(taskTitle === undefined ? {} : { taskTitle }) };
    }
    if (event.kind === "toolResult" && entry.resultState === undefined)
      entry = { ...entry, resultState: event.isError ? "failed" : "completed" };
    if (
      event.kind === "backgroundTask" &&
      event.status === "stopped" &&
      (entry.telemetryState === undefined || entry.telemetryState === "running")
    )
      entry = { ...entry, telemetryState: "interrupted" };
    if (event.kind === "subagent") {
      const next = event.status === "starting" ? "running" : event.status;
      const telemetryState =
        entry.telemetryState === "failed"
          ? "failed"
          : (entry.telemetryState === "completed" || entry.telemetryState === "interrupted") &&
              next === "running"
            ? entry.telemetryState
            : next;
      entry = {
        ...entry,
        telemetryState,
        ...(event.subagentType === undefined ? {} : { name: clip(event.subagentType, 128) }),
        ...(event.description === undefined ? {} : { description: clip(event.description, 512) }),
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        ...(event.totalTokens === undefined ? {} : { totalTokens: event.totalTokens }),
        ...(event.toolUses === undefined ? {} : { steps: event.toolUses }),
        ...(event.lastToolName === undefined
          ? {}
          : { lastToolName: clip(event.lastToolName, 128) }),
      };
    }
    if (event.kind === "subagentActivity") {
      const next =
        event.activity === "completed"
          ? "completed"
          : event.activity === "interrupted"
            ? "interrupted"
            : "running";
      if (
        event.activity === "interacted" ||
        entry.telemetryState === undefined ||
        entry.telemetryState === "running"
      )
        entry = { ...entry, telemetryState: next };
      entry = { ...entry, name: clip(event.agentPath || "subagent", 128) };
    }
    if (event.kind === "subagentTurnDone")
      entry = {
        ...entry,
        telemetryState: event.isError ? "failed" : "completed",
        ...(event.durationMs === null ? {} : { durationMs: event.durationMs }),
      };
    const state =
      entry.resultState === "failed" || entry.telemetryState === "failed"
        ? "failed"
        : (entry.telemetryState ?? entry.resultState ?? "running");
    entries.set(key, { ...entry, state });
    changed = true;
  }
  if (!changed) return previous;
  return {
    entries: [...entries.values()],
    truncated,
    ...(openBatchKey === undefined ? {} : { openBatchKey }),
    ...(counted.size === 0 ? {} : { countedNestedToolIds: [...counted] }),
  };
}

function spawnBatchKey(toolId: string | undefined): string | undefined {
  return validId(toolId) ? `${SPAWN_BATCH_KEY_PREFIX}${toolId}` : undefined;
}

function mergeAliases(
  first: AgentSubagentLifecycleEntry,
  second: AgentSubagentLifecycleEntry,
): AgentSubagentLifecycleEntry {
  const terminal = (
    a: AgentSubagentLifecycleState | undefined,
    b: AgentSubagentLifecycleState | undefined,
  ): AgentSubagentLifecycleState | undefined =>
    a === "failed" || b === "failed"
      ? "failed"
      : a === "interrupted" || b === "interrupted"
        ? "interrupted"
        : a === "completed" || b === "completed"
          ? "completed"
          : (a ?? b);
  const telemetryState = terminal(first.telemetryState, second.telemetryState);
  const resultState =
    first.resultState === "failed" || second.resultState === "failed"
      ? "failed"
      : (first.resultState ?? second.resultState);
  const { parentToolId: firstParent, ...firstFields } = first;
  const { parentToolId: secondParent, ...secondFields } = second;
  const parentToolId = firstParent === secondParent ? firstParent : undefined;
  return {
    ...secondFields,
    ...firstFields,
    id: first.id,
    description: first.description || second.description,
    ...(telemetryState === undefined ? {} : { telemetryState }),
    ...(resultState === undefined ? {} : { resultState }),
    ...(parentToolId === undefined ? {} : { parentToolId }),
  };
}

export function readAgentSubagentLifecycle(value: unknown): AgentSubagentLifecycle | undefined {
  try {
    return parseAgentSubagentLifecycle(value);
  } catch {
    return undefined;
  }
}

/** Strict optional persistence boundary; old records omit this field. */
export function parseAgentSubagentLifecycle(value: unknown): AgentSubagentLifecycle | undefined {
  if (value === undefined) return undefined;
  const fail = (): never => {
    throw new TypeError("Invalid retained subagent lifecycle metadata.");
  };
  const object = (item: unknown): Record<string, unknown> => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return fail();
    return item as Record<string, unknown>;
  };
  const text = (item: unknown, max: number): string => {
    if (typeof item !== "string" || encoder.encode(item).length > max) return fail();
    return item;
  };
  const presentText = (item: unknown, max: number): string => {
    const value = text(item, max);
    if (value === "") return fail();
    return value;
  };
  const state = (item: unknown): AgentSubagentLifecycleState => {
    if (item !== "running" && item !== "completed" && item !== "failed" && item !== "interrupted")
      return fail();
    return item;
  };
  const countedIds = (item: unknown): ReadonlyArray<string> => {
    if (!Array.isArray(item) || item.length === 0 || item.length > MAX_SUBAGENT_COUNTED_NESTED_IDS)
      return fail();
    const ids = item.map((id) => presentText(id, 256));
    if (new Set(ids).size !== ids.length) return fail();
    return ids;
  };
  const rootFields = ["entries", "truncated", "openBatchKey", "countedNestedToolIds"];
  const record = object(value);
  if (
    Object.keys(record).some((key) => !rootFields.includes(key)) ||
    typeof record.truncated !== "boolean" ||
    !Array.isArray(record.entries) ||
    record.entries.length > MAX_RETAINED_SUBAGENTS
  )
    return fail();
  const seen = new Set<string>();
  const aliases = new Set<string>();
  const entries = record.entries.map((raw): AgentSubagentLifecycleEntry => {
    const entry = object(raw);
    const fields = [
      "id",
      "toolId",
      "taskId",
      "agentThreadId",
      "name",
      "description",
      "state",
      "telemetryState",
      "resultState",
      "durationMs",
      "totalTokens",
      "steps",
      "lastToolName",
      "taskTitle",
      "batchKey",
      "nestedCount",
      "parentToolId",
    ];
    if (Object.keys(entry).some((key) => !fields.includes(key))) return fail();
    const id = text(entry.id, 272);
    if (!id || seen.has(id)) return fail();
    seen.add(id);
    const identity: { toolId?: string; taskId?: string; agentThreadId?: string } = {};
    for (const key of ["toolId", "taskId", "agentThreadId"] as const) {
      if (entry[key] === undefined) continue;
      const value = text(entry[key], 256);
      const alias = `${key}:${value}`;
      if (!value || aliases.has(alias)) return fail();
      aliases.add(alias);
      identity[key] = value;
    }
    if (Object.keys(identity).length === 0) return fail();
    const metrics: { durationMs?: number; totalTokens?: number; steps?: number } = {};
    for (const key of ["durationMs", "totalTokens", "steps"] as const) {
      if (entry[key] === undefined) continue;
      if (typeof entry[key] !== "number" || !Number.isSafeInteger(entry[key]) || entry[key] < 0)
        return fail();
      metrics[key] = entry[key];
    }
    const nestedCount = entry.nestedCount;
    if (
      nestedCount !== undefined &&
      (typeof nestedCount !== "number" ||
        !Number.isSafeInteger(nestedCount) ||
        nestedCount < 1 ||
        nestedCount > MAX_SUBAGENT_NESTED_COUNT)
    )
      return fail();
    const telemetryState =
      entry.telemetryState === undefined ? undefined : state(entry.telemetryState);
    const resultState = entry.resultState === undefined ? undefined : state(entry.resultState);
    if (resultState === "running" || resultState === "interrupted") return fail();
    const expected =
      resultState === "failed" || telemetryState === "failed"
        ? "failed"
        : (telemetryState ?? resultState ?? "running");
    if (state(entry.state) !== expected) return fail();
    return {
      id,
      ...identity,
      name: text(entry.name, 128),
      description: text(entry.description, 512),
      state: expected,
      ...(telemetryState === undefined ? {} : { telemetryState }),
      ...(resultState === undefined ? {} : { resultState }),
      ...metrics,
      ...(entry.lastToolName === undefined ? {} : { lastToolName: text(entry.lastToolName, 128) }),
      ...(entry.taskTitle === undefined
        ? {}
        : { taskTitle: presentText(entry.taskTitle, MAX_SUBAGENT_TASK_TITLE_BYTES) }),
      ...(entry.batchKey === undefined
        ? {}
        : { batchKey: presentText(entry.batchKey, MAX_SUBAGENT_BATCH_KEY_BYTES) }),
      ...(nestedCount === undefined ? {} : { nestedCount }),
      ...(entry.parentToolId === undefined
        ? {}
        : { parentToolId: presentText(entry.parentToolId, MAX_SUBAGENT_PARENT_TOOL_ID_BYTES) }),
    };
  });
  return {
    entries,
    truncated: record.truncated,
    ...(record.openBatchKey === undefined
      ? {}
      : { openBatchKey: presentText(record.openBatchKey, MAX_SUBAGENT_BATCH_KEY_BYTES) }),
    ...(record.countedNestedToolIds === undefined
      ? {}
      : { countedNestedToolIds: countedIds(record.countedNestedToolIds) }),
  };
}
