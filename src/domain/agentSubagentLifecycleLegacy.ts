import {
  readAgentSubagentLifecycle,
  type AgentSubagentLifecycle,
  type AgentSubagentLifecycleEntry,
  type AgentSubagentLifecycleState,
} from "./agentSubagentLifecycle";

export const LEGACY_SUBAGENT_LIFECYCLE_ROOT_KEYS: ReadonlyArray<string> = ["entries", "truncated"];

export const LEGACY_SUBAGENT_LIFECYCLE_ENTRY_KEYS: ReadonlyArray<string> = [
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

export function legacyAgentSubagentLifecycle(
  lifecycle: AgentSubagentLifecycle,
): AgentSubagentLifecycle {
  const entries = lifecycle.entries
    .filter((entry) => entry.parentToolId === undefined)
    .map(legacyEntry);
  return {
    entries,
    truncated: lifecycle.truncated || entries.length !== lifecycle.entries.length,
  };
}

export function agentSubagentLifecycleHasRetainedDetail(
  lifecycle: AgentSubagentLifecycle,
): boolean {
  if (lifecycle.openBatchKey !== undefined) return true;
  if (lifecycle.countedNestedToolIds !== undefined) return true;
  return lifecycle.entries.some(
    (entry) =>
      entry.taskTitle !== undefined ||
      entry.batchKey !== undefined ||
      entry.nestedCount !== undefined ||
      entry.parentToolId !== undefined,
  );
}

export function persistedAgentSubagentLifecycle(
  lifecycle: AgentSubagentLifecycle | undefined,
): AgentSubagentLifecycle | undefined {
  if (lifecycle === undefined) return undefined;
  const validated = readAgentSubagentLifecycle(legacyAgentSubagentLifecycle(lifecycle));
  if (validated === undefined) return undefined;
  if (!isLegacyAgentSubagentLifecycleShape(validated)) return undefined;
  return validated;
}

export function isLegacyAgentSubagentLifecycleShape(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  if (!hasOnlyKeys(root, LEGACY_SUBAGENT_LIFECYCLE_ROOT_KEYS)) return false;
  if (!Array.isArray(root.entries)) return false;
  return root.entries.every(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      hasOnlyKeys(entry as Record<string, unknown>, LEGACY_SUBAGENT_LIFECYCLE_ENTRY_KEYS),
  );
}

export function sameLegacyAgentSubagentLifecycle(
  left: AgentSubagentLifecycle,
  right: AgentSubagentLifecycle,
): boolean {
  const first = persistedAgentSubagentLifecycle(left);
  const second = persistedAgentSubagentLifecycle(right);
  if (first === undefined || second === undefined) return false;
  return JSON.stringify(first) === JSON.stringify(second);
}

function legacyEntry(entry: AgentSubagentLifecycleEntry): AgentSubagentLifecycleEntry {
  const {
    taskTitle: _taskTitle,
    batchKey: _batchKey,
    nestedCount: _nestedCount,
    parentToolId: _parentToolId,
    ...legacy
  } = entry;
  return { ...legacy, state: derivedState(legacy) };
}

function derivedState(entry: AgentSubagentLifecycleEntry): AgentSubagentLifecycleState {
  if (entry.resultState === "failed") return "failed";
  if (entry.telemetryState === "failed") return "failed";
  return entry.telemetryState ?? entry.resultState ?? "running";
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: ReadonlyArray<string>): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}
