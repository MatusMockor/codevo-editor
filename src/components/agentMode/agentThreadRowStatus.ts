import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  projectAgentBackgroundActivity,
  type AgentBackgroundActivity,
} from "../../domain/agentBackgroundActivity";
import type { AgentSessionBackground } from "../../domain/agentSessionBackground";
import { agentAgentsRunningLabel } from "./agentBackgroundIndicatorPresentation";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import {
  runningTurn,
  type AgentThread,
  type AgentTurn,
  type AgentTurnStatus,
} from "../../domain/agentThread";
import {
  NO_AGENT_TURN_LOG_EVIDENCE,
  agentTurnContentLost,
  type AgentTurnLogEvidenceLookup,
} from "../../domain/agentTurnContentLoss";

export type AgentRowStatus =
  | {
      readonly kind: "working";
      readonly startedAtEpochMs: number;
      readonly activity?: "background" | "monitoring";
    }
  | { readonly kind: "approval" }
  | { readonly kind: "input" }
  | {
      readonly kind: "agents";
      readonly count: number;
      readonly lead: "working" | "waiting";
      readonly startedAtEpochMs: number;
    }
  | { readonly kind: "failed" }
  | { readonly kind: "stopped" }
  | { readonly kind: "done" }
  | { readonly kind: "none" };

export type AgentRowStatusTone = "work" | "warn" | "ok" | "fail" | "quiet";

export interface AgentRowSignals {
  readonly pending: AgentPendingInteraction | null;
  readonly workingAgents: number;
}

export const NO_ROW_SIGNALS: AgentRowSignals = Object.freeze({ pending: null, workingAgents: 0 });

export function agentRowStatus(
  view: AgentThreadView,
  evidenceOf: AgentTurnLogEvidenceLookup = NO_AGENT_TURN_LOG_EVIDENCE,
  background?: AgentBackgroundActivity | null,
  signals: AgentRowSignals = NO_ROW_SIGNALS,
): AgentRowStatus {
  const running = runningTurn(view.thread);
  const session = view.sessionBackground;
  if (running !== null) {
    if (signals.pending === "approval") return { kind: "approval" };
    if (signals.pending === "input") return { kind: "input" };
    const activity =
      background === undefined ? immediateRowBackground(view, running, evidenceOf) : background;
    const agents = Math.max(signals.workingAgents, liveAgentTasks(activity), session?.agents ?? 0);
    if (agents > 0)
      return {
        kind: "agents",
        count: agents,
        lead: activity?.foregroundSettled === true ? "waiting" : "working",
        startedAtEpochMs: running.startedAtEpochMs,
      };
    return {
      kind: "working",
      startedAtEpochMs: running.startedAtEpochMs,
      ...(activity?.foregroundSettled && activity.phase !== "inactive"
        ? {
            activity:
              activity.phase === "monitoring" ? ("monitoring" as const) : ("background" as const),
          }
        : {}),
    };
  }
  if (session !== undefined) return sessionBackgroundStatus(session);
  const last = lastTurnStatus(view.thread);
  if (last !== null && isFailedTurnStatus(last)) return { kind: "failed" };
  if (last !== null && isStoppedTurnStatus(last)) return { kind: "stopped" };
  if (view.unread && !view.thread.archived) return { kind: "done" };
  return { kind: "none" };
}

export function agentRowWorkingAgents(view: AgentThreadView): number {
  const running = runningTurn(view.thread);
  if (running === null) return 0;
  return (
    running.subagentLifecycle?.entries.filter(
      (entry) => entry.parentToolId === undefined && entry.state === "running",
    ).length ?? 0
  );
}

export function agentRowIsLive(status: AgentRowStatus): boolean {
  return agentRowStatusTone(status) === "work" || agentRowStatusTone(status) === "warn";
}

export function agentRowStatusLabel(status: AgentRowStatus): string | null {
  switch (status.kind) {
    case "working":
      if (status.activity === "monitoring") return "Monitoring";
      if (status.activity === "background") return "Working in background";
      return "Working";
    case "approval":
      return "Approval";
    case "input":
      return "Input";
    case "agents":
      return agentAgentsRunningLabel(status.count);
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "done":
      return "Done";
    case "none":
      return null;
    default:
      return unsupportedRowStatus(status);
  }
}

export function agentRowStatusTitle(status: AgentRowStatus): string | null {
  if (status.kind === "agents")
    return status.lead === "waiting"
      ? `Waiting for ${agentCountLabel(status.count)}`
      : `Working with ${agentCountLabel(status.count)}`;
  if (status.kind === "approval") return "Waiting for your approval";
  if (status.kind === "input") return "Waiting for your answer";
  return null;
}

export function agentRowStatusTone(status: AgentRowStatus): AgentRowStatusTone {
  switch (status.kind) {
    case "working":
    case "agents":
      return "work";
    case "approval":
    case "input":
      return "warn";
    case "done":
      return "ok";
    case "failed":
      return "fail";
    case "stopped":
    case "none":
      return "quiet";
    default:
      return unsupportedRowStatus(status);
  }
}

export function agentRowBelongsInWorkingSection(
  status: AgentRowStatus,
): status is Extract<AgentRowStatus, { readonly kind: "working" | "agents" }> {
  switch (status.kind) {
    case "working":
    case "agents":
      return true;
    case "approval":
    case "input":
    case "failed":
    case "stopped":
    case "done":
    case "none":
      return false;
    default:
      return unsupportedRowStatus(status);
  }
}

export function agentRowWorkingDurationLabel(elapsedMs: number): string {
  const seconds = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 1_000)) : 0;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function agentCountLabel(count: number): string {
  return count === 1 ? "1 agent" : `${count} agents`;
}

function liveAgentTasks(activity: AgentBackgroundActivity | null): number {
  if (activity === null || !activity.foregroundSettled || activity.phase === "inactive") return 0;
  return activity.tasks.filter((task) => task.taskType === "agent").length;
}

function sessionBackgroundStatus(session: AgentSessionBackground): AgentRowStatus {
  if (session.agents > 0)
    return {
      kind: "agents",
      count: session.agents,
      lead: "waiting",
      startedAtEpochMs: session.sinceEpochMs,
    };
  const monitoring =
    session.tasks.length === session.total &&
    session.tasks.every((task) => task.taskType === "monitor");
  return {
    kind: "working",
    startedAtEpochMs: session.sinceEpochMs,
    activity: monitoring ? "monitoring" : "background",
  };
}

function immediateRowBackground(
  view: AgentThreadView,
  running: AgentTurn,
  evidenceOf: AgentTurnLogEvidenceLookup,
): AgentBackgroundActivity | null {
  if (view.thread.provider.kind !== "claudeCode") return null;
  const lost = agentTurnContentLost(running.eventsTruncated, evidenceOf(running.turnId));
  return projectAgentBackgroundActivity(running.events, true, lost);
}

function lastTurnStatus(thread: AgentThread): AgentTurnStatus | null {
  const last = thread.turns[thread.turns.length - 1];
  if (last === undefined) return null;
  return last.status;
}

function isFailedTurnStatus(status: AgentTurnStatus): boolean {
  if (status.kind === "failed") return true;
  return status.kind === "exited" && status.exitCode !== 0;
}

function isStoppedTurnStatus(status: AgentTurnStatus): boolean {
  return status.kind === "stopped" || status.kind === "interrupted";
}

function unsupportedRowStatus(status: never): never {
  throw new TypeError(`Unsupported agent row status: ${String(status)}.`);
}
