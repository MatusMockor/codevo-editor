import type { AgentTurnEvent } from "./agentThread";

export const MAX_RETAINED_SUBAGENTS = 32;
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
}
export interface AgentSubagentLifecycle {
  readonly entries: ReadonlyArray<AgentSubagentLifecycleEntry>;
  readonly truncated: boolean;
}
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

/** Lifecycle-only metadata outlives the bounded output window; terminal entries are tombstones. */
export function retainAgentSubagentLifecycle(
  previous: AgentSubagentLifecycle | undefined,
  events: ReadonlyArray<AgentTurnEvent>,
): AgentSubagentLifecycle | undefined {
  const entries = new Map((previous?.entries ?? []).map((entry) => [entry.id, entry]));
  let truncated = previous?.truncated ?? false;
  let changed = false;
  for (const event of events) {
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
    let toolId: string | undefined;
    let taskId: string | undefined;
    let agentThreadId: string | undefined;
    if (event.kind === "toolCall" && event.parentToolId === undefined && spawn(event.name))
      toolId = event.toolId;
    else if (event.kind === "toolResult" && event.parentToolId === undefined) toolId = event.toolId;
    else if (event.kind === "subagent") {
      toolId = event.toolId;
      taskId = event.taskId;
    } else if (event.kind === "backgroundTask" && event.status === "stopped") {
      if (event.taskType !== "agent" && event.taskType !== "other") continue;
      taskId = event.taskId;
    } else if (event.kind === "subagentActivity" || event.kind === "subagentTurnDone")
      agentThreadId = event.agentThreadId;
    else continue;
    const matches = [...entries.values()].filter(
      (entry) =>
        (toolId !== undefined && entry.toolId === toolId) ||
        (taskId !== undefined && entry.taskId === taskId) ||
        (agentThreadId !== undefined && entry.agentThreadId === agentThreadId),
    );
    let found = matches[0];
    for (const alias of matches.slice(1)) {
      entries.delete(alias.id);
      found = mergeAliases(found!, alias);
    }
    if (event.kind === "toolResult" && found === undefined) continue;
    if (event.kind === "backgroundTask" && found === undefined && event.taskType !== "agent")
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
    if (event.kind === "toolCall")
      entry = {
        ...entry,
        name: clip(event.name, 128),
        description: clip(event.description ?? event.inputSummary, 512),
      };
    if (event.kind === "toolResult" && entry.resultState === undefined)
      entry = { ...entry, resultState: event.isError ? "failed" : "completed" };
    if (
      event.kind === "backgroundTask" &&
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
  return changed ? { entries: [...entries.values()], truncated } : previous;
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
  return {
    ...second,
    ...first,
    id: first.id,
    description: first.description || second.description,
    ...(telemetryState === undefined ? {} : { telemetryState }),
    ...(resultState === undefined ? {} : { resultState }),
  };
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
  const state = (item: unknown): AgentSubagentLifecycleState => {
    if (item !== "running" && item !== "completed" && item !== "failed" && item !== "interrupted")
      return fail();
    return item;
  };
  const record = object(value);
  if (
    Object.keys(record).some((key) => key !== "entries" && key !== "truncated") ||
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
    };
  });
  return { entries, truncated: record.truncated };
}
