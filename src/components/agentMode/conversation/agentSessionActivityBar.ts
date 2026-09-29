import {
  agentAgentsRunningLabel,
  agentBackgroundWaitStatus,
  type AgentBackgroundWait,
} from "../agentBackgroundIndicatorPresentation";
import type { AgentSessionBackground } from "../../../domain/agentSessionBackground";
import {
  MAX_AGENTS_BANNER_NAMES,
  type AgentAgentsBannerModel,
} from "./agentAgentsBannerPresentation";

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
  session: AgentSessionBackground | null = null,
): AgentSessionActivityBar | null {
  if (agents === null && background === null && session === null) return null;
  const actions: AgentSessionActivityAction[] = [];
  if (agents !== null) actions.push("view");
  if (background !== null) actions.push("stop");
  return {
    label: activityLabel(agents, background, session),
    names: agents?.names ?? sessionAgentNames(session),
    actions,
    announce: background !== null,
  };
}

function activityLabel(
  agents: AgentAgentsBannerModel | null,
  background: AgentBackgroundWait | null,
  session: AgentSessionBackground | null,
): string {
  const backgroundAgents = background?.kind === "agents" ? background.count : 0;
  const count = Math.max(agents?.count ?? 0, backgroundAgents, session?.agents ?? 0);
  const sessionTasks = session === null ? 0 : session.total - session.agents;
  if (count === 0 && background !== null) return agentBackgroundWaitStatus(background);
  if (count === 0) return `${backgroundTasksLabel(sessionTasks)} running`;
  const label = agentAgentsRunningLabel(count);
  if (background?.kind === "tasks") return `${label} · ${backgroundTasksLabel(background.count)}`;
  if (sessionTasks > 0) return `${label} · ${backgroundTasksLabel(sessionTasks)}`;
  return label;
}

function sessionAgentNames(session: AgentSessionBackground | null): string {
  if (session === null) return "";
  const labels = [
    ...new Set(
      session.tasks
        .filter((task) => task.taskType === "agent")
        .map((task) => task.description?.trim() ?? "")
        .filter((label) => label !== ""),
    ),
  ];
  const shown = labels.slice(0, MAX_AGENTS_BANNER_NAMES);
  const hidden = labels.length - shown.length;
  return hidden > 0 ? `${shown.join(", ")} +${hidden}` : shown.join(", ");
}

function backgroundTasksLabel(count: number | null): string {
  if (count === null) return "background tasks";
  return `${count} background task${count === 1 ? "" : "s"}`;
}
