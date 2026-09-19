import {
  RUNTIME_SUBAGENT_ENTRY_BATCH_PREFIX,
  RUNTIME_SUBAGENT_LEGACY_BATCH_ID,
  RUNTIME_SUBAGENT_TURN_BATCH_ID,
  projectAgentRuntimeSubagents,
  type AgentRuntimeSubagent,
  type AgentRuntimeSubagentSource,
  type AgentRuntimeSubagentStatus,
  type AgentRuntimeSubagentSummary,
  type AgentRuntimeSubagents,
} from "../../domain/agentRuntimeSubagent";
import {
  MAX_SUBAGENT_NESTED_COUNT,
  isAgentSubagentSpawnToolName,
  retainAgentSubagentLifecycle,
} from "../../domain/agentSubagentLifecycle";
import type { AgentTurn, AgentTurnEvent } from "../../domain/agentThread";
import {
  agentTurnDurationLabel,
  agentTurnSettlement,
  type AgentTurnSettlement,
} from "./agentModePresentation";
import {
  agentSubagentDisclosureEntries,
  type AgentSubagentDisclosureEntry,
} from "./agentSubagentDisclosurePresentation";

const UNKNOWN_TASK_ACTIVITY = "task unknown";
const TOOL_KEY_PREFIX = "tool:";
const THREAD_KEY_PREFIX = "thread:";
const FALLBACK_ROLE_NAMES = new Set(["subagent", "Subagent"]);

type RuntimeSubagentTurn = Pick<AgentTurn, "events" | "status" | "subagentLifecycle">;

interface EntryObservation {
  title?: string;
  progress?: string;
  lastToolName?: string;
  order: number;
}

export function agentTurnRuntimeSubagents(turn: RuntimeSubagentTurn): AgentRuntimeSubagents {
  const settlement = agentTurnSettlement(turn.status);
  const lifecycle = turn.subagentLifecycle ?? retainAgentSubagentLifecycle(undefined, turn.events);
  const entries = agentSubagentDisclosureEntries(turn.events, lifecycle, settlement).filter(
    (entry) => entry.parentToolId === undefined,
  );
  if (entries.length === 0 && lifecycle?.truncated !== true)
    return projectAgentRuntimeSubagents([], false);
  const observations = observeEntries(turn.events, entries);
  const sources = entries.map((entry, index): AgentRuntimeSubagentSource => {
    const observation = observations.get(entry.toolId);
    const title = entry.taskTitle ?? observation?.title ?? codexTitle(entry);
    return {
      id: entry.toolId,
      batchId: entryBatchId(entry, settlement),
      observedState: entry.state,
      resumable: entryThreadId(entry) !== undefined && settlement === "running",
      activityOrder: observation?.order ?? index - entries.length,
      ...present("title", title),
      ...present("role", entryRole(entry)),
      ...present("progress", observation?.progress ?? carriedProgress(entry, title)),
      ...present("lastToolName", observation?.lastToolName ?? entry.lastToolName),
      ...present("outcome", entry.detail),
      ...present("durationMs", entry.durationMs),
      ...present("totalTokens", entry.totalTokens),
      ...present("toolUses", entry.steps),
      ...present("nestedCount", entry.nestedCount),
    };
  });
  return projectAgentRuntimeSubagents(sources, lifecycle?.truncated === true);
}

export type AgentSpawnBatchOrigin = "spawn" | "legacy" | "codexTurn";

export function agentSpawnBatchOrigin(batchId: string): AgentSpawnBatchOrigin {
  if (batchId === RUNTIME_SUBAGENT_LEGACY_BATCH_ID) return "legacy";
  if (batchId === RUNTIME_SUBAGENT_TURN_BATCH_ID) return "codexTurn";
  return "spawn";
}

export function agentSpawnLeadLabel(
  summary: AgentRuntimeSubagentSummary,
  origin: AgentSpawnBatchOrigin,
): string {
  const plural = summary.count === 1 ? "" : "s";
  if (origin === "legacy" && summary.live) return `${summary.count} earlier subagent${plural}`;
  const verb = summary.live ? "Kicked off" : "Ran";
  return `${verb} ${summary.count} subagent${plural}`;
}

export function agentSpawnStatusLabel(summary: AgentRuntimeSubagentSummary): string {
  const { counts } = summary;
  if (summary.live) return `${counts.working} working`;
  if (counts.failed > 0) return `${counts.failed} failed`;
  if (counts.stopped > 0)
    return counts.stopped === summary.count ? "stopped" : `${counts.stopped} stopped`;
  if (counts.unknown > 0 || summary.count === 0) return "status unavailable";
  if (counts.idle > 0) return `${counts.idle} idle`;
  return "✓ completed";
}

const MEMBER_STATUS_LABELS: Readonly<Record<AgentRuntimeSubagentStatus, string>> = {
  working: "Working",
  idle: "Idle",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
  unknown: "Status unavailable",
};

export function agentRuntimeSubagentStatusLabel(status: AgentRuntimeSubagentStatus): string {
  return MEMBER_STATUS_LABELS[status];
}

export function agentRuntimeSubagentMemberLabel(agent: AgentRuntimeSubagent): string {
  const status = MEMBER_STATUS_LABELS[agent.status];
  if (agent.status === "working") return status;
  const metrics = [
    agent.elapsed.kind === "settled" ? agentTurnDurationLabel(agent.elapsed.durationMs) : null,
    agent.totalTokens === null || agent.totalTokens === 0
      ? null
      : `${agentTokenCountLabel(agent.totalTokens)} tok`,
  ].filter((value): value is string => value !== null);
  if (metrics.length === 0) return status;
  if (agent.status === "completed") return metrics.join(" · ");
  return `${status} · ${metrics.join(" · ")}`;
}

export function agentRuntimeSubagentMetricsLabel(agent: AgentRuntimeSubagent): string {
  return [
    agent.model,
    agent.totalTokens === null ? "— tok" : `${agentTokenCountLabel(agent.totalTokens)} tok`,
    agent.toolUses === null ? null : `${agent.toolUses} tool${agent.toolUses === 1 ? "" : "s"}`,
    nestedAgentsLabel(agent.nestedAgents),
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");
}

export function agentRuntimeSubagentFirstLine(agent: AgentRuntimeSubagent): string | null {
  if (agent.activity === null) return null;
  return agent.activity.split("\n").find((line) => line.trim() !== "") ?? null;
}

export function agentRuntimeSubagentActivityLine(agent: AgentRuntimeSubagent): string | null {
  const line = agentRuntimeSubagentFirstLine(agent);
  if (line !== null || agent.titleKnown) return line;
  return UNKNOWN_TASK_ACTIVITY;
}

export function agentRuntimeSubagentBody(agent: AgentRuntimeSubagent): string | null {
  const activity =
    agent.activity === null
      ? null
      : `${agent.activity}${agent.activityTruncated ? "… (shortened)" : ""}`;
  const parts = [activity, agent.model].filter((value): value is string => value !== null);
  return parts.length === 0 ? null : parts.join("\n\n");
}

export function agentTokenCountLabel(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export function agentElapsedLabel(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function observeEntries(
  events: ReadonlyArray<AgentTurnEvent>,
  entries: ReadonlyArray<AgentSubagentDisclosureEntry>,
): ReadonlyMap<string, EntryObservation> {
  const byToolId = new Map<string, string>();
  const byTaskId = new Map<string, string>();
  const byThreadId = new Map<string, string>();
  for (const entry of entries) {
    if (entry.toolId.startsWith(TOOL_KEY_PREFIX))
      byToolId.set(entry.toolId.slice(TOOL_KEY_PREFIX.length), entry.toolId);
    if (entry.taskId !== undefined) byTaskId.set(entry.taskId, entry.toolId);
    const threadId = entryThreadId(entry);
    if (threadId !== undefined) byThreadId.set(threadId, entry.toolId);
  }
  const observations = new Map<string, EntryObservation>();
  const observe = (key: string, order: number): EntryObservation => {
    const known = observations.get(key);
    if (known !== undefined) {
      known.order = order;
      return known;
    }
    const created: EntryObservation = { order };
    observations.set(key, created);
    return created;
  };
  for (const [order, event] of events.entries()) {
    if (event.kind === "subagent") {
      const key = aliasKey(byToolId, byTaskId, event);
      if (key === undefined) continue;
      const observation = observe(key, order);
      if (event.lastToolName !== undefined) observation.lastToolName = event.lastToolName;
      if (event.description === undefined) continue;
      if (event.status === "starting") observation.title ??= event.description;
      if (event.status === "running") observation.progress = event.description;
      continue;
    }
    if (event.kind === "subagentEvent") {
      const key = byThreadId.get(event.agentThreadId);
      if (key === undefined || event.event.kind !== "toolCall") continue;
      const observation = observe(key, order);
      observation.lastToolName = event.event.name;
      observation.progress = event.event.description ?? event.event.inputSummary;
      continue;
    }
    if (event.kind !== "toolCall" || event.parentToolId !== undefined) continue;
    const key = byToolId.get(event.toolId);
    if (key === undefined) continue;
    const title = event.description ?? event.inputSummary;
    if (title.trim() !== "") observe(key, order).title = title;
  }
  return observations;
}

function entryBatchId(
  entry: AgentSubagentDisclosureEntry,
  settlement: AgentTurnSettlement,
): string {
  if (entry.batchKey !== undefined) return entry.batchKey;
  if (entryThreadId(entry) !== undefined) return RUNTIME_SUBAGENT_TURN_BATCH_ID;
  if (settlement === "running") return `${RUNTIME_SUBAGENT_ENTRY_BATCH_PREFIX}${entry.toolId}`;
  return RUNTIME_SUBAGENT_LEGACY_BATCH_ID;
}

function nestedAgentsLabel(count: number): string | null {
  if (count === 0) return null;
  const bound = count >= MAX_SUBAGENT_NESTED_COUNT ? "+" : "";
  return `+${count}${bound} nested agent${count === 1 ? "" : "s"}`;
}

function aliasKey(
  byToolId: ReadonlyMap<string, string>,
  byTaskId: ReadonlyMap<string, string>,
  event: Extract<AgentTurnEvent, { kind: "subagent" }>,
): string | undefined {
  const tool = event.toolId === undefined ? undefined : byToolId.get(event.toolId);
  if (tool !== undefined) return tool;
  return event.taskId === undefined ? undefined : byTaskId.get(event.taskId);
}

function entryThreadId(entry: AgentSubagentDisclosureEntry): string | undefined {
  if (entry.agentThreadId !== undefined) return entry.agentThreadId;
  if (!entry.toolId.startsWith(THREAD_KEY_PREFIX)) return undefined;
  return entry.toolId.slice(THREAD_KEY_PREFIX.length);
}

function entryRole(entry: AgentSubagentDisclosureEntry): string | undefined {
  if (entryThreadId(entry) !== undefined) return undefined;
  const name = entry.subagentType ?? entry.name;
  if (isAgentSubagentSpawnToolName(name) || FALLBACK_ROLE_NAMES.has(name)) return undefined;
  return name;
}

function codexTitle(entry: AgentSubagentDisclosureEntry): string | undefined {
  if (entryThreadId(entry) === undefined) return undefined;
  const segments = entry.name.split("/").filter((segment) => segment.trim() !== "");
  return segments[segments.length - 1] ?? entry.name;
}

function carriedProgress(
  entry: AgentSubagentDisclosureEntry,
  title: string | undefined,
): string | undefined {
  if (entry.description === "" || entry.description === title) return undefined;
  return entry.description;
}

function present<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
