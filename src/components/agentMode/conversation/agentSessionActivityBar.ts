import {
  agentAgentsRunningLabel,
  agentBackgroundWaitStatus,
  type AgentBackgroundWait,
} from "../agentBackgroundIndicatorPresentation";
import type { AgentAgentsBannerModel } from "./agentAgentsBannerPresentation";

export type AgentSessionActivityAction = "view" | "stop";

export interface AgentSessionActivityBar {
  readonly label: string;
  readonly names: string;
  readonly actions: ReadonlyArray<AgentSessionActivityAction>;
  readonly announce: boolean;
}

export function agentSessionActivityBar(
  agents: AgentAgentsBannerModel | null,
  background: AgentBackgroundWait | null,
): AgentSessionActivityBar | null {
  if (agents === null && background === null) return null;
  const actions: AgentSessionActivityAction[] = [];
  if (agents !== null) actions.push("view");
  if (background !== null) actions.push("stop");
  return {
    label: activityLabel(agents, background),
    names: agents?.names ?? "",
    actions,
    announce: background !== null,
  };
}

function activityLabel(
  agents: AgentAgentsBannerModel | null,
  background: AgentBackgroundWait | null,
): string {
  const backgroundAgents = background?.kind === "agents" ? background.count : 0;
  const count = Math.max(agents?.count ?? 0, backgroundAgents);
  if (count === 0 && background !== null) return agentBackgroundWaitStatus(background);
  const label = agentAgentsRunningLabel(count);
  if (background?.kind !== "tasks") return label;
  return `${label} · ${backgroundTasksLabel(background.count)}`;
}

function backgroundTasksLabel(count: number | null): string {
  if (count === null) return "background tasks";
  return `${count} background task${count === 1 ? "" : "s"}`;
}
