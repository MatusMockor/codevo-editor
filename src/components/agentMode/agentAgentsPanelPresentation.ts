import type {
  AgentRuntimeSubagent,
  AgentRuntimeSubagentStatus,
  AgentRuntimeSubagents,
} from "../../domain/agentRuntimeSubagent";

export const MAX_AGENTS_PANEL_ROWS = 96;
export const AGENTS_DOCK_MIN_WIDTH = 760;

export type AgentAgentsDockMode = "closed" | "docked" | "overlay";

export function agentAgentsDockMode(panelOpen: boolean, width: number): AgentAgentsDockMode {
  if (!panelOpen) return "closed";
  return width < AGENTS_DOCK_MIN_WIDTH ? "overlay" : "docked";
}

export interface AgentAgentsPanelGroup {
  readonly key: string;
  readonly subagents: AgentRuntimeSubagents;
}

export interface AgentAgentsPanelRow {
  readonly key: string;
  readonly agent: AgentRuntimeSubagent;
}

export interface AgentAgentsPanelModel {
  readonly rows: ReadonlyArray<AgentAgentsPanelRow>;
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
  const all = groups.flatMap((group) =>
    group.subagents.agents.map((agent) => ({
      key: agentAgentsPanelRowKey(group.key, agent.id),
      agent,
    })),
  );
  const rows = all.slice(-MAX_AGENTS_PANEL_ROWS);
  const working = all.filter((row) => row.agent.status === "working").length;
  const idle = all.filter((row) => row.agent.status === "idle").length;
  const truncated = groups.some((group) => group.subagents.truncated);
  return {
    rows,
    notice: panelNotice(rows.length, all.length, truncated),
    truncated,
    working,
    idle,
    settled: all.length - working - idle,
    totalTokens: all.reduce((total, row) => total + (row.agent.totalTokens ?? 0), 0),
  };
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
