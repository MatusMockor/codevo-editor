import type {
  AgentRuntimeSubagent,
  AgentRuntimeSubagentStatus,
  AgentRuntimeSubagents,
} from "../../domain/agentRuntimeSubagent";
import { agentElapsedLabel, agentTokenCountLabel } from "./agentRuntimeSubagentPresentation";

export const MAX_AGENTS_PANEL_ROWS = 96;

export interface AgentAgentsPanelGroup {
  readonly key: string;
  readonly subagents: AgentRuntimeSubagents;
}

export interface AgentAgentsPanelRow {
  readonly key: string;
  readonly agent: AgentRuntimeSubagent;
}

export interface AgentAgentsPanelEarlierGroup {
  readonly key: string;
  readonly label: string;
  readonly summary: string;
  readonly tone: "completed" | "failed" | "inactive";
  readonly rows: ReadonlyArray<AgentAgentsPanelRow>;
}

export interface AgentAgentsPanelModel {
  readonly current: ReadonlyArray<AgentAgentsPanelRow>;
  readonly earlier: ReadonlyArray<AgentAgentsPanelEarlierGroup>;
  readonly notice: string | null;
  readonly truncated: boolean;
  readonly working: number;
  readonly idle: number;
  readonly unknown: number;
  readonly settled: number;
  readonly totalTokens: number;
}

export function agentAgentsPanelRowKey(groupKey: string, agentId: string): string {
  return `${groupKey}:${agentId}`;
}

const NO_ROW_KEYS: ReadonlySet<string> = new Set();

export function agentAgentsPanelModel(
  groups: ReadonlyArray<AgentAgentsPanelGroup>,
  shownElsewhere: ReadonlySet<string> = NO_ROW_KEYS,
): AgentAgentsPanelModel {
  const populated = groups.filter((group) => group.subagents.agents.length > 0);
  const all = populated.flatMap(rowsOf);
  const retained = all.slice(-MAX_AGENTS_PANEL_ROWS).map((row) => row.key);
  const kept = new Set(retained.filter((key) => !shownElsewhere.has(key)));
  const latest = populated[populated.length - 1];
  const current = latest === undefined ? [] : rowsOf(latest).filter((row) => kept.has(row.key));
  const earlier = populated
    .slice(0, -1)
    .reverse()
    .map((group) => earlierGroup(group, kept))
    .filter((group) => group.rows.length > 0);
  const working = all.filter((row) => row.agent.status === "working").length;
  const idle = all.filter((row) => row.agent.status === "idle").length;
  const unknown = all.filter((row) => row.agent.status === "unknown").length;
  const truncated = groups.some((group) => group.subagents.truncated);
  return {
    current,
    earlier,
    notice: panelNotice(retained.length, all.length, truncated),
    truncated,
    working,
    idle,
    unknown,
    settled: all.length - working - idle - unknown,
    totalTokens: all.reduce((total, row) => total + (row.agent.totalTokens ?? 0), 0),
  };
}

function rowsOf(group: AgentAgentsPanelGroup): ReadonlyArray<AgentAgentsPanelRow> {
  return group.subagents.agents.map((agent) => ({
    key: agentAgentsPanelRowKey(group.key, agent.id),
    agent,
  }));
}

function earlierGroup(
  group: AgentAgentsPanelGroup,
  kept: ReadonlySet<string>,
): AgentAgentsPanelEarlierGroup {
  const agents = group.subagents.agents;
  const count = agents.length;
  const plural = count === 1 ? "" : "s";
  return {
    key: group.key,
    label: `Ran ${count} subagent${plural}`,
    summary: earlierSummary(agents),
    tone: earlierTone(agents),
    rows: rowsOf(group).filter((row) => kept.has(row.key)),
  };
}

function earlierSummary(agents: ReadonlyArray<AgentRuntimeSubagent>): string {
  const tokens = agents.reduce((total, agent) => total + (agent.totalTokens ?? 0), 0);
  const longest = agents.reduce(
    (max, agent) =>
      agent.elapsed.kind === "settled" ? Math.max(max, agent.elapsed.durationMs) : max,
    0,
  );
  return [
    `${agents.length} agent${agents.length === 1 ? "" : "s"}`,
    tokens === 0 ? null : `${agentTokenCountLabel(tokens)} tok`,
    longest === 0 ? null : agentElapsedLabel(longest),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

function earlierTone(
  agents: ReadonlyArray<AgentRuntimeSubagent>,
): AgentAgentsPanelEarlierGroup["tone"] {
  if (agents.some((agent) => agent.status === "failed")) return "failed";
  if (agents.every((agent) => agent.status === "completed")) return "completed";
  return "inactive";
}

function panelNotice(shown: number, total: number, truncated: boolean): string | null {
  if (shown < total) return `Showing the latest ${shown} agents`;
  if (!truncated) return null;
  return `Showing the first ${shown} agent${shown === 1 ? "" : "s"}`;
}

export function agentAgentsRunningCountLabel(running: number, truncated: boolean): string {
  const bound = truncated ? "at least " : "";
  return `${bound}${running} agent${running === 1 ? "" : "s"} running`;
}

export type AgentSubagentStatusCounts = Readonly<Record<AgentRuntimeSubagentStatus, number>>;

export function agentSubagentAnnouncement(
  previousWorking: number | null,
  counts: AgentSubagentStatusCounts,
  truncated: boolean,
): string | null {
  const { working } = counts;
  if (previousWorking === working) return null;
  if (working > 0) return capitalized(agentAgentsRunningCountLabel(working, truncated));
  if (previousWorking === null || previousWorking === 0) return null;
  return settledAnnouncement(counts.failed, counts.stopped, counts.unknown);
}

function settledAnnouncement(failed: number, stopped: number, unknown: number): string {
  const failedLabel = failed === 0 ? null : `${failed} agent${failed === 1 ? "" : "s"} failed`;
  const stoppedPlural = stopped === 1 ? "" : "s";
  const stoppedLabel =
    stopped === 0
      ? null
      : failedLabel === null
        ? `${stopped} agent${stoppedPlural} stopped`
        : `${stopped} stopped`;
  const unknownLabel =
    unknown === 0 ? null : `status of ${unknown} agent${unknown === 1 ? "" : "s"} unknown`;
  const parts = [failedLabel, stoppedLabel, unknownLabel].filter(
    (part): part is string => part !== null,
  );
  if (parts.length === 0) return "All agents finished";
  if (failedLabel === null && stoppedLabel === null && unknownLabel !== null)
    return capitalized(unknownLabel);
  return parts.join(", ");
}

function capitalized(text: string): string {
  return `${text.charAt(0).toLocaleUpperCase()}${text.slice(1)}`;
}
