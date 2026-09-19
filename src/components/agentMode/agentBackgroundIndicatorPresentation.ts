import type {
  AgentBackgroundActivity,
  AgentBackgroundTask,
} from "../../domain/agentBackgroundActivity";
import {
  latestLiveAgentRuntimeSubagent,
  type AgentRuntimeSubagents,
} from "../../domain/agentRuntimeSubagent";
import type { AgentCliKind } from "../../domain/agentTask";
import { agentAgentsWorkingLabel } from "./agentAgentsPanelPresentation";
import { agentRuntimeSubagentFirstLine } from "./agentRuntimeSubagentPresentation";

export type AgentBackgroundIndicator =
  | { readonly kind: "hidden" }
  | {
      readonly kind: "agents";
      readonly label: string;
      readonly latest: string | null;
    }
  | {
      readonly kind: "tasks";
      readonly label: string;
      readonly monitoring: boolean;
      readonly count: string | null;
      readonly tasks: ReadonlyArray<AgentBackgroundTask>;
      readonly truncated: boolean;
    };

const HIDDEN: AgentBackgroundIndicator = { kind: "hidden" };

export function agentBackgroundIndicator(
  activity: AgentBackgroundActivity,
  subagents: AgentRuntimeSubagents,
  provider: AgentCliKind,
): AgentBackgroundIndicator {
  const tasks = provider === "claudeCode" ? activity.tasks : [];
  const working = subagents.agents.filter((agent) => agent.status === "working").length;
  if (working > 0) return agentsIndicator(working, subagents, tasks);
  if (provider !== "claudeCode" || activity.phase === "inactive") return HIDDEN;
  if (activity.foregroundSettled)
    return {
      kind: "tasks",
      label: activity.phase === "monitoring" ? "Monitoring" : "Working in background",
      monitoring: activity.phase === "monitoring",
      count: tasks.length === 0 ? null : countLabel(tasks.length, "task"),
      tasks,
      truncated: activity.truncated,
    };
  if (tasks.length === 0) return HIDDEN;
  return {
    kind: "tasks",
    label: `${countLabel(tasks.length, "background task")} running`,
    monitoring: false,
    count: null,
    tasks,
    truncated: activity.truncated,
  };
}

function agentsIndicator(
  working: number,
  subagents: AgentRuntimeSubagents,
  tasks: ReadonlyArray<AgentBackgroundTask>,
): AgentBackgroundIndicator {
  const otherTasks = tasks.filter((task) => task.taskType !== "agent").length;
  const latest = latestLiveAgentRuntimeSubagent(subagents.agents);
  const activity = latest === null ? null : agentRuntimeSubagentFirstLine(latest);
  return {
    kind: "agents",
    label: [
      agentAgentsWorkingLabel(working, subagents.truncated),
      otherTasks === 0 ? null : countLabel(otherTasks, "background task"),
    ]
      .filter((value): value is string => value !== null)
      .join(" · "),
    latest:
      latest === null ? null : activity === null ? latest.title : `${latest.title} · ${activity}`,
  };
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
