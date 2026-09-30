import type { AgentBackgroundTask } from "../../../domain/agentBackgroundActivity";
import type { AgentRuntimeSubagent } from "../../../domain/agentRuntimeSubagent";
import type { AgentSessionBackground } from "../../../domain/agentSessionBackground";
import type { AgentCliKind } from "../../../domain/agentTask";
import {
  agentAgentsPanelRowKey,
  type AgentAgentsPanelGroup,
} from "../agentAgentsPanelPresentation";
import { agentSessionTaskLabel } from "../conversation/agentSessionTaskControls";

export const MAX_AGENT_RUNNING_ROWS = 96;

export type AgentRunningStopReason = "codex" | "turn" | "unlisted" | "remote" | "unavailable";

export function agentRunningStopReasonText(reason: AgentRunningStopReason): string {
  switch (reason) {
    case "codex":
      return "Codex can't stop one subagent on its own. Stop the turn to stop it.";
    case "turn":
      return "Claude runs this agent inside the turn. Stop the turn to stop it.";
    case "unlisted":
      return "Claude's session doesn't list this task, so it can't be stopped on its own. Stop the turn or end the session instead.";
    case "remote":
      return "Stopping one task isn't available on a remote server. Stop the turn instead.";
    case "unavailable":
      return "Codevo can't stop one task here. Stop the turn instead.";
    default:
      return unsupported(reason);
  }
}

export interface AgentLiveBackground {
  readonly tasks: ReadonlyArray<AgentBackgroundTask>;
  readonly truncated: boolean;
}

export type AgentRunningStopPolicy =
  | { readonly kind: "perTask"; readonly pendingTaskIds: ReadonlySet<string> }
  | { readonly kind: "unavailable"; readonly reason: "remote" | "unavailable" };

export type AgentRunningStop =
  | { readonly kind: "stoppable"; readonly taskId: string }
  | { readonly kind: "stopping"; readonly taskId: string }
  | { readonly kind: "unavailable"; readonly reason: AgentRunningStopReason };

export type AgentRunningElapsed =
  { readonly kind: "since"; readonly sinceEpochMs: number } | { readonly kind: "unknown" };

export type AgentRunningRow =
  | {
      readonly kind: "subagent";
      readonly key: string;
      readonly agent: AgentRuntimeSubagent;
      readonly stop: AgentRunningStop;
    }
  | {
      readonly kind: "task";
      readonly key: string;
      readonly taskId: string;
      readonly taskType: AgentBackgroundTask["taskType"];
      readonly title: string;
      readonly typeLabel: string;
      readonly elapsed: AgentRunningElapsed;
      readonly stop: AgentRunningStop;
    };

export interface AgentRunningWork {
  readonly rows: ReadonlyArray<AgentRunningRow>;
  readonly unlisted: number;
  readonly agents: number;
  readonly agentsLowerBound: boolean;
  readonly tasks: number;
  readonly tasksUnknown: boolean;
}

export interface AgentRunningWorkSource {
  readonly provider: AgentCliKind;
  readonly groups: ReadonlyArray<AgentAgentsPanelGroup>;
  readonly session: AgentSessionBackground | null;
  readonly live: AgentLiveBackground | null;
  readonly stop: AgentRunningStopPolicy;
}

export const NO_AGENT_RUNNING_WORK: AgentRunningWork = Object.freeze({
  rows: Object.freeze([]),
  unlisted: 0,
  agents: 0,
  agentsLowerBound: false,
  tasks: 0,
  tasksUnknown: false,
});

export function agentRunningStopPolicy(input: {
  readonly remote: boolean;
  readonly pendingTaskIds: ReadonlySet<string> | null;
}): AgentRunningStopPolicy {
  if (input.remote) return { kind: "unavailable", reason: "remote" };
  if (input.pendingTaskIds === null) return { kind: "unavailable", reason: "unavailable" };
  return { kind: "perTask", pendingTaskIds: input.pendingTaskIds };
}

export function agentRunningWork(source: AgentRunningWorkSource): AgentRunningWork {
  const session = source.session;
  const sessionTasks = session?.tasks ?? [];
  const listed = new Set(sessionTasks.map((task) => task.taskId));
  const subagents = source.groups.flatMap((group) =>
    group.subagents.agents
      .filter((agent) => agent.status === "working")
      .map((agent): AgentRunningRow => ({
        kind: "subagent",
        key: agentAgentsPanelRowKey(group.key, agent.id),
        agent,
        stop: rowStop(source, listed, agent.taskId, agent.taskId === null ? "turn" : "unlisted"),
      })),
  );
  const claimed = new Set(subagents.flatMap(subagentTaskIds));
  const tasks = uniqueTasks([...sessionTasks, ...(source.live?.tasks ?? [])])
    .filter((task) => !claimed.has(task.taskId))
    .map((task): AgentRunningRow => {
      const since = session?.taskSinceEpochMs.get(task.taskId);
      return {
        kind: "task",
        key: `task:${task.taskId}`,
        taskId: task.taskId,
        taskType: task.taskType,
        title: agentSessionTaskLabel(task),
        typeLabel: taskTypeLabel(task.taskType),
        elapsed: since === undefined ? { kind: "unknown" } : { kind: "since", sinceEpochMs: since },
        stop: rowStop(source, listed, task.taskId, "unlisted"),
      };
    });
  const outsideAgents =
    [...claimed].filter((taskId) => !listed.has(taskId)).length +
    tasks.filter((row) => isTaskRow(row) && row.taskType === "agent" && !listed.has(row.taskId))
      .length;
  const outsideOthers = tasks.filter(
    (row) => isTaskRow(row) && row.taskType !== "agent" && !listed.has(row.taskId),
  ).length;
  const listedAgents = sessionTasks.filter((task) => task.taskType === "agent").length;
  const listedOthers = sessionTasks.length - listedAgents;
  const sessionAgents = session?.agents ?? 0;
  const unlistedAgents = Math.max(0, sessionAgents - listedAgents - outsideAgents);
  const unlistedOthers = Math.max(
    0,
    (session?.total ?? 0) - sessionAgents - listedOthers - outsideOthers,
  );
  const all = [...subagents, ...tasks];
  const rows = all.slice(0, MAX_AGENT_RUNNING_ROWS);
  const agentTaskRows = tasks.filter((row) => isTaskRow(row) && row.taskType === "agent").length;
  const agents = subagents.length + agentTaskRows + unlistedAgents;
  const liveGroup = source.groups[source.groups.length - 1];
  return {
    rows,
    unlisted: all.length - rows.length + unlistedAgents + unlistedOthers,
    agents,
    agentsLowerBound:
      agents > 0 && (liveGroup?.subagents.truncated === true || source.live?.truncated === true),
    tasks: tasks.length - agentTaskRows + unlistedOthers,
    tasksUnknown: source.live?.truncated === true,
  };
}

export function reuseAgentRunningWork(
  previous: AgentRunningWork | null,
  next: AgentRunningWork,
): AgentRunningWork {
  if (previous === null) return next;
  const known = new Map(previous.rows.map((row) => [row.key, row]));
  const rows = next.rows.map((row) => {
    const prior = known.get(row.key);
    return prior !== undefined && sameRow(prior, row) ? prior : row;
  });
  const unchanged =
    rows.length === previous.rows.length &&
    rows.every((row, index) => row === previous.rows[index]) &&
    previous.unlisted === next.unlisted &&
    previous.agents === next.agents &&
    previous.agentsLowerBound === next.agentsLowerBound &&
    previous.tasks === next.tasks &&
    previous.tasksUnknown === next.tasksUnknown;
  return unchanged ? previous : { ...next, rows };
}

const NO_ROW_KEYS: ReadonlySet<string> = new Set();

export function agentRunningRowKeys(
  work: AgentRunningWork | null,
  groups: ReadonlyArray<AgentAgentsPanelGroup>,
): ReadonlySet<string> {
  if (work === null || work.rows.length === 0) return NO_ROW_KEYS;
  const taskIds = new Set(work.rows.flatMap((row) => (isTaskRow(row) ? [row.taskId] : [])));
  const echoed = groups.flatMap((group) =>
    group.subagents.agents
      .filter((agent) => agent.taskId !== null && taskIds.has(agent.taskId))
      .map((agent) => agentAgentsPanelRowKey(group.key, agent.id)),
  );
  return new Set([...work.rows.map((row) => row.key), ...echoed]);
}

export function agentRunningLabel(work: AgentRunningWork): string | null {
  const agents =
    work.agents === 0
      ? null
      : `${work.agentsLowerBound ? "at least " : ""}${countLabel(work.agents, "agent")}`;
  const tasks = work.tasksUnknown
    ? "background tasks"
    : work.tasks === 0
      ? null
      : countLabel(work.tasks, "background task");
  if (agents !== null && tasks !== null) return capitalized(`${agents} running · ${tasks}`);
  if (agents !== null) return capitalized(`${agents} running`);
  if (tasks !== null) return capitalized(`${tasks} running`);
  return null;
}

export function agentRunningHasWork(work: AgentRunningWork): boolean {
  return work.agents > 0 || work.tasks > 0 || work.tasksUnknown;
}

function rowStop(
  source: AgentRunningWorkSource,
  listed: ReadonlySet<string>,
  taskId: string | null,
  notListed: AgentRunningStopReason,
): AgentRunningStop {
  if (source.provider === "codex") return { kind: "unavailable", reason: "codex" };
  if (taskId === null || !listed.has(taskId)) return { kind: "unavailable", reason: notListed };
  const policy = source.stop;
  if (policy.kind === "unavailable") return { kind: "unavailable", reason: policy.reason };
  return policy.pendingTaskIds.has(taskId)
    ? { kind: "stopping", taskId }
    : { kind: "stoppable", taskId };
}

function subagentTaskIds(row: AgentRunningRow): ReadonlyArray<string> {
  return row.kind === "subagent" && row.agent.taskId !== null ? [row.agent.taskId] : [];
}

function isTaskRow(row: AgentRunningRow): row is Extract<AgentRunningRow, { kind: "task" }> {
  return row.kind === "task";
}

function sameRow(previous: AgentRunningRow, next: AgentRunningRow): boolean {
  if (previous.kind === "subagent" && next.kind === "subagent")
    return previous.agent === next.agent && sameStop(previous.stop, next.stop);
  if (previous.kind === "task" && next.kind === "task")
    return (
      previous.taskId === next.taskId &&
      previous.taskType === next.taskType &&
      previous.title === next.title &&
      sameElapsed(previous.elapsed, next.elapsed) &&
      sameStop(previous.stop, next.stop)
    );
  return false;
}

function sameStop(previous: AgentRunningStop, next: AgentRunningStop): boolean {
  if (previous.kind === "unavailable")
    return next.kind === "unavailable" && previous.reason === next.reason;
  if (next.kind === "unavailable") return false;
  return previous.kind === next.kind && previous.taskId === next.taskId;
}

function sameElapsed(previous: AgentRunningElapsed, next: AgentRunningElapsed): boolean {
  if (previous.kind === "since" && next.kind === "since")
    return previous.sinceEpochMs === next.sinceEpochMs;
  return previous.kind === next.kind;
}

function uniqueTasks(
  tasks: ReadonlyArray<AgentBackgroundTask>,
): ReadonlyArray<AgentBackgroundTask> {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    if (seen.has(task.taskId)) return false;
    seen.add(task.taskId);
    return true;
  });
}

function taskTypeLabel(taskType: AgentBackgroundTask["taskType"]): string {
  switch (taskType) {
    case "agent":
      return "Agent";
    case "shell":
      return "Shell";
    case "monitor":
      return "Monitor";
    case "other":
      return "Task";
    default:
      return unsupported(taskType);
  }
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function capitalized(text: string): string {
  return `${text.charAt(0).toLocaleUpperCase()}${text.slice(1)}`;
}

function unsupported(value: never): never {
  throw new TypeError(`Unsupported running work value: ${String(value)}.`);
}
