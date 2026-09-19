export const MAX_RUNTIME_SUBAGENTS = 32;
export const MAX_RUNTIME_SUBAGENT_TITLE_CHARACTERS = 120;
export const MAX_RUNTIME_SUBAGENT_ROLE_CHARACTERS = 48;
export const MAX_RUNTIME_SUBAGENT_MODEL_CHARACTERS = 64;
export const MAX_RUNTIME_SUBAGENT_ACTIVITY_CHARACTERS = 2_000;
export const RUNTIME_SUBAGENT_FALLBACK_TITLE = "Subagent";
export const RUNTIME_SUBAGENT_TURN_BATCH_ID = "turn";
export const RUNTIME_SUBAGENT_LEGACY_BATCH_ID = "legacy";
export const RUNTIME_SUBAGENT_ENTRY_BATCH_PREFIX = "entry:";

export type AgentRuntimeSubagentStatus =
  "working" | "idle" | "completed" | "failed" | "stopped" | "unknown";

export type AgentRuntimeSubagentObservedState =
  "running" | "completed" | "failed" | "interrupted" | "unknown";

export type AgentRuntimeSubagentElapsed =
  | { readonly kind: "settled"; readonly durationMs: number }
  | { readonly kind: "live"; readonly observedDurationMs: number }
  | { readonly kind: "unknown" };

export interface AgentRuntimeSubagentSource {
  readonly id: string;
  readonly batchId: string;
  readonly observedState: AgentRuntimeSubagentObservedState;
  readonly resumable: boolean;
  readonly activityOrder: number;
  readonly title?: string;
  readonly role?: string;
  readonly model?: string;
  readonly progress?: string;
  readonly lastToolName?: string;
  readonly outcome?: string;
  readonly durationMs?: number;
  readonly totalTokens?: number;
  readonly toolUses?: number;
  readonly nestedCount?: number;
}

export interface AgentRuntimeSubagent {
  readonly id: string;
  readonly batchId: string;
  readonly title: string;
  readonly titleKnown: boolean;
  readonly role: string | null;
  readonly model: string | null;
  readonly status: AgentRuntimeSubagentStatus;
  readonly activity: string | null;
  readonly activityTruncated: boolean;
  readonly elapsed: AgentRuntimeSubagentElapsed;
  readonly totalTokens: number | null;
  readonly toolUses: number | null;
  readonly nestedAgents: number;
  readonly activityOrder: number;
}

export interface AgentRuntimeSubagentBatch {
  readonly id: string;
  readonly agents: ReadonlyArray<AgentRuntimeSubagent>;
}

export interface AgentRuntimeSubagents {
  readonly agents: ReadonlyArray<AgentRuntimeSubagent>;
  readonly batches: ReadonlyArray<AgentRuntimeSubagentBatch>;
  readonly truncated: boolean;
}

export type AgentRuntimeSubagentTone = "working" | "failed" | "completed" | "inactive";

export interface AgentRuntimeSubagentSummary {
  readonly live: boolean;
  readonly count: number;
  readonly counts: Readonly<Record<AgentRuntimeSubagentStatus, number>>;
  readonly tone: AgentRuntimeSubagentTone;
}

export const EMPTY_AGENT_RUNTIME_SUBAGENTS: AgentRuntimeSubagents = Object.freeze({
  agents: Object.freeze([]),
  batches: Object.freeze([]),
  truncated: false,
});

export function projectAgentRuntimeSubagents(
  sources: ReadonlyArray<AgentRuntimeSubagentSource>,
  sourcesTruncated: boolean,
): AgentRuntimeSubagents {
  if (sources.length === 0 && !sourcesTruncated) return EMPTY_AGENT_RUNTIME_SUBAGENTS;
  const seen = new Set<string>();
  const agents: AgentRuntimeSubagent[] = [];
  let truncated = sourcesTruncated;
  for (const source of sources) {
    if (seen.has(source.id)) continue;
    if (agents.length >= MAX_RUNTIME_SUBAGENTS) {
      truncated = true;
      break;
    }
    seen.add(source.id);
    agents.push(runtimeSubagent(source));
  }
  return { agents, batches: spawnBatches(agents), truncated };
}

export function agentRuntimeSubagentStatus(
  observedState: AgentRuntimeSubagentObservedState,
  resumable: boolean,
): AgentRuntimeSubagentStatus {
  switch (observedState) {
    case "running":
      return "working";
    case "completed":
      return resumable ? "idle" : "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "stopped";
    case "unknown":
      return "unknown";
    default:
      return unsupportedObservedState(observedState);
  }
}

export function isLiveAgentRuntimeSubagentStatus(status: AgentRuntimeSubagentStatus): boolean {
  return status === "working";
}

export function summarizeAgentRuntimeSubagents(
  agents: ReadonlyArray<Pick<AgentRuntimeSubagent, "status">>,
): AgentRuntimeSubagentSummary {
  const counts: Record<AgentRuntimeSubagentStatus, number> = {
    working: 0,
    idle: 0,
    completed: 0,
    failed: 0,
    stopped: 0,
    unknown: 0,
  };
  for (const agent of agents) counts[agent.status] += 1;
  const live = counts.working > 0;
  return { live, count: agents.length, counts, tone: summaryTone(counts) };
}

export function latestLiveAgentRuntimeSubagent(
  agents: ReadonlyArray<AgentRuntimeSubagent>,
): AgentRuntimeSubagent | null {
  let latest: AgentRuntimeSubagent | null = null;
  for (const agent of agents) {
    if (!isLiveAgentRuntimeSubagentStatus(agent.status)) continue;
    if (latest !== null && latest.activityOrder > agent.activityOrder) continue;
    latest = agent;
  }
  return latest;
}

export function reconcileAgentRuntimeSubagents(
  previous: AgentRuntimeSubagents | null,
  next: AgentRuntimeSubagents,
): AgentRuntimeSubagents {
  if (previous === null) return next;
  const known = new Map(previous.agents.map((agent) => [agent.id, agent]));
  const agents = next.agents.map((agent) => {
    const prior = known.get(agent.id);
    return reusedAgent(prior, carriedBatchId(prior, agent));
  });
  const grouped = spawnBatches(agents);
  const unchanged =
    previous.truncated === next.truncated &&
    sameMembers(previous.agents, agents) &&
    previous.batches.length === grouped.length &&
    previous.batches.every((batch, index) => batch.id === grouped[index]?.id);
  if (unchanged) return previous;
  const priorBatches = new Map(previous.batches.map((batch) => [batch.id, batch]));
  const batches = grouped.map((batch) => reusedBatch(priorBatches.get(batch.id), batch));
  return { agents, batches, truncated: next.truncated };
}

function carriedBatchId(
  previous: AgentRuntimeSubagent | undefined,
  next: AgentRuntimeSubagent,
): AgentRuntimeSubagent {
  if (previous === undefined) return next;
  if (next.batchId !== RUNTIME_SUBAGENT_LEGACY_BATCH_ID) return next;
  if (!previous.batchId.startsWith(RUNTIME_SUBAGENT_ENTRY_BATCH_PREFIX)) return next;
  return { ...next, batchId: previous.batchId };
}

function runtimeSubagent(source: AgentRuntimeSubagentSource): AgentRuntimeSubagent {
  const status = agentRuntimeSubagentStatus(source.observedState, source.resumable);
  const role = boundedLine(source.role, MAX_RUNTIME_SUBAGENT_ROLE_CHARACTERS);
  const taskTitle = boundedLine(source.title, MAX_RUNTIME_SUBAGENT_TITLE_CHARACTERS);
  const title = taskTitle ?? role ?? RUNTIME_SUBAGENT_FALLBACK_TITLE;
  const activity = boundedActivity(activityText(source, status));
  return {
    id: source.id,
    batchId: source.batchId,
    title,
    titleKnown: taskTitle !== null,
    role: visibleRole(role, taskTitle),
    model: boundedLine(source.model, MAX_RUNTIME_SUBAGENT_MODEL_CHARACTERS),
    status,
    activity: activity.text,
    activityTruncated: activity.truncated,
    elapsed: elapsed(source, status),
    totalTokens: source.totalTokens ?? null,
    toolUses: source.toolUses ?? null,
    nestedAgents: Math.max(0, source.nestedCount ?? 0),
    activityOrder: source.activityOrder,
  };
}

function visibleRole(role: string | null, taskTitle: string | null): string | null {
  if (role === null || taskTitle === null) return role;
  return sameLabel(role, taskTitle) ? null : role;
}

function activityText(
  source: AgentRuntimeSubagentSource,
  status: AgentRuntimeSubagentStatus,
): string | null {
  const progress = presentText(source.progress);
  const tool = presentText(source.lastToolName);
  const toolLine = tool === null ? null : `▸ ${tool}`;
  const outcome = presentText(source.outcome);
  if (isLiveAgentRuntimeSubagentStatus(status)) return progress ?? toolLine ?? outcome;
  return outcome ?? progress ?? toolLine;
}

function elapsed(
  source: AgentRuntimeSubagentSource,
  status: AgentRuntimeSubagentStatus,
): AgentRuntimeSubagentElapsed {
  if (source.durationMs === undefined) return { kind: "unknown" };
  if (isLiveAgentRuntimeSubagentStatus(status))
    return { kind: "live", observedDurationMs: source.durationMs };
  return { kind: "settled", durationMs: source.durationMs };
}

function spawnBatches(
  agents: ReadonlyArray<AgentRuntimeSubagent>,
): ReadonlyArray<AgentRuntimeSubagentBatch> {
  const members = new Map<string, AgentRuntimeSubagent[]>();
  for (const agent of agents) {
    const batch = members.get(agent.batchId);
    if (batch !== undefined) {
      batch.push(agent);
      continue;
    }
    members.set(agent.batchId, [agent]);
  }
  return [...members].map(([id, batchAgents]) => ({ id, agents: batchAgents }));
}

function summaryTone(
  counts: Readonly<Record<AgentRuntimeSubagentStatus, number>>,
): AgentRuntimeSubagentTone {
  if (counts.working > 0) return "working";
  if (counts.failed > 0) return "failed";
  if (counts.unknown > 0 || counts.stopped > 0 || counts.idle > 0) return "inactive";
  if (counts.completed === 0) return "inactive";
  return "completed";
}

function reusedAgent(
  previous: AgentRuntimeSubagent | undefined,
  next: AgentRuntimeSubagent,
): AgentRuntimeSubagent {
  if (previous === undefined) return next;
  return sameAgent(previous, next) ? previous : next;
}

function reusedBatch(
  previous: AgentRuntimeSubagentBatch | undefined,
  next: AgentRuntimeSubagentBatch,
): AgentRuntimeSubagentBatch {
  if (previous === undefined) return next;
  return sameMembers(previous.agents, next.agents) ? previous : next;
}

function sameMembers(
  previous: ReadonlyArray<AgentRuntimeSubagent>,
  next: ReadonlyArray<AgentRuntimeSubagent>,
): boolean {
  return previous.length === next.length && previous.every((agent, index) => agent === next[index]);
}

function sameAgent(previous: AgentRuntimeSubagent, next: AgentRuntimeSubagent): boolean {
  return (
    previous.batchId === next.batchId &&
    previous.title === next.title &&
    previous.titleKnown === next.titleKnown &&
    previous.nestedAgents === next.nestedAgents &&
    previous.role === next.role &&
    previous.model === next.model &&
    previous.status === next.status &&
    previous.activity === next.activity &&
    previous.activityTruncated === next.activityTruncated &&
    previous.totalTokens === next.totalTokens &&
    previous.toolUses === next.toolUses &&
    previous.activityOrder === next.activityOrder &&
    sameElapsed(previous.elapsed, next.elapsed)
  );
}

function sameElapsed(
  previous: AgentRuntimeSubagentElapsed,
  next: AgentRuntimeSubagentElapsed,
): boolean {
  if (previous.kind === "settled" && next.kind === "settled")
    return previous.durationMs === next.durationMs;
  if (previous.kind === "live" && next.kind === "live")
    return previous.observedDurationMs === next.observedDurationMs;
  return previous.kind === "unknown" && next.kind === "unknown";
}

function presentText(value: string | undefined): string | null {
  if (value === undefined) return null;
  return value.trim() === "" ? null : value.trim();
}

function boundedLine(value: string | undefined, limit: number): string | null {
  const text = presentText(value);
  if (text === null) return null;
  const line = text.replace(/\s+/gu, " ");
  const characters = [...line];
  if (characters.length <= limit) return line;
  return `${characters.slice(0, limit - 1).join("")}…`;
}

function boundedActivity(value: string | null): {
  readonly text: string | null;
  readonly truncated: boolean;
} {
  if (value === null) return { text: null, truncated: false };
  const characters = [...value];
  if (characters.length <= MAX_RUNTIME_SUBAGENT_ACTIVITY_CHARACTERS)
    return { text: value, truncated: false };
  return {
    text: characters.slice(0, MAX_RUNTIME_SUBAGENT_ACTIVITY_CHARACTERS).join(""),
    truncated: true,
  };
}

function sameLabel(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function unsupportedObservedState(state: never): never {
  throw new TypeError(`Unsupported subagent state: ${String(state)}`);
}
