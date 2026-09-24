import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentAttentionExplanation } from "./agentAttentionPresentation";
import { agentAttentionCount } from "./agentModePresentation";

export interface AgentThreadActivitySummary {
  readonly live: number;
  readonly capacity: number;
  readonly attention: number;
  readonly attentionExplanation: string;
}

export function agentThreadActivitySummary(
  threads: ReadonlyArray<AgentThreadView>,
  liveTaskCount: number,
  maxConcurrentAgentTasks: number,
): AgentThreadActivitySummary {
  return {
    live: Math.max(0, liveTaskCount),
    capacity: Math.max(0, maxConcurrentAgentTasks),
    attention: agentAttentionCount(threads),
    attentionExplanation: agentAttentionExplanation(threads),
  };
}

export function agentThreadActivitySlotsTitle(summary: AgentThreadActivitySummary): string {
  return `${summary.live} of ${summary.capacity} thread slots in use`;
}

export function agentThreadAttentionLabel(count: number): string {
  return `${count} ${count === 1 ? "needs" : "need"} attention`;
}

export function agentThreadActivityDetail(
  summary: AgentThreadActivitySummary,
  attentionVisible: boolean,
): string | null {
  const parts = [
    summary.live > 0 ? `${summary.live} running` : null,
    attentionVisible && summary.attention > 0 ? agentThreadAttentionLabel(summary.attention) : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function agentThreadActivityGroupLabel(
  summary: AgentThreadActivitySummary,
  attentionVisible: boolean,
): string {
  return `Thread activity: ${agentThreadActivityDetail(summary, attentionVisible) ?? "idle"}`;
}
