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
  readonly settled: number;
  readonly totalTokens: number;
}

export function agentAgentsPanelRowKey(groupKey: string, agentId: string): string {
  return `${groupKey}:${agentId}`;
}

export function agentAgentsPanelModel(
  groups: ReadonlyArray<AgentAgentsPanelGroup>,
): AgentAgentsPanelModel {
  const populated = groups.filter((group) => group.subagents.agents.length > 0);
  const all = populated.flatMap(rowsOf);
  const kept = new Set(all.slice(-MAX_AGENTS_PANEL_ROWS).map((row) => row.key));
  const latest = populated[populated.length - 1];
  const current = latest === undefined ? [] : rowsOf(latest).filter((row) => kept.has(row.key));
  const earlier = populated
    .slice(0, -1)
    .reverse()
    .map((group) => earlierGroup(group, kept))
    .filter((group) => group.rows.length > 0);
  const working = all.filter((row) => row.agent.status === "working").length;
  const idle = all.filter((row) => row.agent.status === "idle").length;
  const truncated = groups.some((group) => group.subagents.truncated);
  return {
    current,
    earlier,
    notice: panelNotice(kept.size, all.length, truncated),
    truncated,
    working,
    idle,
    settled: all.length - working - idle,
    totalTokens: all.reduce((total, row) => total + (row.agent.totalTokens ?? 0), 0),
  };
}

export function agentWorkingAgentNames(
  groups: ReadonlyArray<AgentAgentsPanelGroup>,
): ReadonlyArray<string> {
  const names = groups.flatMap((group) =>
    group.subagents.agents
      .filter((agent) => agent.status === "working")
      .map((agent) => agent.role ?? agent.title),
  );
  return [...new Set(names)];
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

export function agentAgentsWorkingLabel(working: number, truncated: boolean): string {
  const bound = truncated ? "at least " : "";
  return `${bound}${working} agent${working === 1 ? "" : "s"} working`;
}

export type AgentSubagentStatusCounts = Readonly<Record<AgentRuntimeSubagentStatus, number>>;

export function agentSubagentAnnouncement(
  previousWorking: number | null,
  counts: AgentSubagentStatusCounts,
  truncated: boolean,
): string | null {
  const { working } = counts;
  if (previousWorking === working) return null;
  if (working > 0) return capitalized(agentAgentsWorkingLabel(working, truncated));
  if (previousWorking === null || previousWorking === 0) return null;
  return settledAnnouncement(counts.failed, counts.stopped);
}

function settledAnnouncement(failed: number, stopped: number): string {
  const failedLabel = failed === 0 ? null : `${failed} agent${failed === 1 ? "" : "s"} failed`;
  const stoppedPlural = stopped === 1 ? "" : "s";
  const stoppedLabel =
    stopped === 0
      ? null
      : failedLabel === null
        ? `${stopped} agent${stoppedPlural} stopped`
        : `${stopped} stopped`;
  const parts = [failedLabel, stoppedLabel].filter((part): part is string => part !== null);
  if (parts.length === 0) return "All agents finished";
  return parts.join(", ");
}

function capitalized(text: string): string {
  return `${text.charAt(0).toLocaleUpperCase()}${text.slice(1)}`;
}
