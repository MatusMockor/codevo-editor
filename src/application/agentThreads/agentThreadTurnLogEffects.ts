import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentRootOwnerId } from "../../domain/agentProject";
import { agentPromptLooksClipped } from "../../domain/agentPromptClipping";
import { isTerminalAgentTaskStatus } from "../../domain/agentTask";
import {
  isTerminalAgentTurnStatus,
  type AgentThread,
  type AgentThreadsAction,
  type AgentThreadsState,
  type AgentTurn,
} from "../../domain/agentThread";
import { NO_AGENT_TURN_LOG_LOSS, type AgentTurnLogLoss } from "../../domain/agentTurnLog";
import { isAgentBackgroundTurn } from "../../domain/agentTurnOrigin";
import type { AgentProjectAuthority } from "../agentProjectAuthority";
import type { AgentTurnLogIntegration } from "../useAgentTurnLogging";
import {
  MAX_INTERRUPTED_AGENT_THREADS_PER_LOAD,
  MAX_SEALED_INTERRUPTED_TURN_LOGS_PER_THREAD,
  isLoggedAgentThread,
  threadAuthority,
} from "./agentThreadStoreContract";

export function applyTurnLogEffects(
  turnLog: AgentTurnLogIntegration,
  projects: ReadonlyArray<AgentProjectDescriptor>,
  state: AgentThreadsState,
  next: AgentThreadsState,
  action: AgentThreadsAction,
): void {
  if (next === state) return;
  switch (action.kind) {
    case "threadCreated":
      return openCreatedThreadTurnLogSlots(turnLog, projects, next, action.thread.threadId);
    case "turnStarted":
      return openStartedTurnLogSlot(turnLog, projects, next, action);
    case "backgroundTurnRecorded":
      return recordBackgroundTurnLog(turnLog, projects, next, action);
    case "turnEventsAppended":
      return recordTurnLogEvents(turnLog, next, action);
    case "turnSteered":
      return turnLog.writer.recordEvents(action.turnId, [action.event]);
    case "taskStatusEvent":
      if (!isTerminalAgentTaskStatus(action.event.status)) return;
      return turnLog.writer.sealTurn(action.event.taskId);
    case "turnInterrupted":
      return turnLog.writer.sealTurn(action.turnId);
    case "deleted":
      return closeTurnLogSlots(turnLog, state, action.threadId);
    case "turnHydrated":
      return;
    default:
      return;
  }
}

function openStartedTurnLogSlot(
  turnLog: AgentTurnLogIntegration,
  projects: ReadonlyArray<AgentProjectDescriptor>,
  next: AgentThreadsState,
  action: Extract<AgentThreadsAction, { kind: "turnStarted" }>,
): void {
  const thread = next.threads.get(action.threadId);
  if (thread === undefined) return;
  openTurnLogSlot(turnLog, projects, thread, action.turn);
}

function recordBackgroundTurnLog(
  turnLog: AgentTurnLogIntegration,
  projects: ReadonlyArray<AgentProjectDescriptor>,
  next: AgentThreadsState,
  action: Extract<AgentThreadsAction, { kind: "backgroundTurnRecorded" }>,
): void {
  const thread = next.threads.get(action.threadId);
  const turn = thread?.turns.find((candidate) => candidate.turnId === action.turn.turnId);
  if (thread === undefined || turn === undefined) return;
  const priorLoss = backgroundTurnLoss(turn.eventsTruncated);
  if (!openTurnLogSlot(turnLog, projects, thread, turn, priorLoss)) return;
  turnLog.writer.recordEvents(turn.turnId, turn.events);
  if (turn.subagentLifecycle !== undefined) {
    turnLog.writer.recordLifecycle(turn.turnId, turn.subagentLifecycle);
  }
  turnLog.writer.sealTurn(turn.turnId);
}

function openCreatedThreadTurnLogSlots(
  turnLog: AgentTurnLogIntegration,
  projects: ReadonlyArray<AgentProjectDescriptor>,
  next: AgentThreadsState,
  threadId: string,
): void {
  const thread = next.threads.get(threadId);
  if (thread === undefined) return;
  for (const turn of thread.turns) {
    if (isTerminalAgentTurnStatus(turn.status)) continue;
    if (!openTurnLogSlot(turnLog, projects, thread, turn)) return;
    if (turn.events.length === 0) continue;
    turnLog.writer.recordEvents(turn.turnId, turn.events);
  }
}

function openTurnLogSlot(
  turnLog: AgentTurnLogIntegration,
  projects: ReadonlyArray<AgentProjectDescriptor>,
  thread: AgentThread,
  turn: AgentTurn,
  priorLoss: AgentTurnLogLoss = resumedTurnLoss(turn.eventsTruncated),
): boolean {
  if (!isLoggedAgentThread(thread)) return false;
  const authority = threadAuthority(projects, thread);
  if (authority === null) return false;
  turnLog.writer.openTurn({
    scope: {
      rootKey: thread.owner.rootKey,
      ownerId: agentRootOwnerId(thread.owner.rootKey),
      threadId: thread.threadId,
      turnId: turn.turnId,
    },
    generation: authority.generation,
    provider: thread.provider.kind,
    priorLoss,
    prompt: loggablePrompt(turn),
  });
  return true;
}

function loggablePrompt(turn: AgentTurn): string | null {
  if (isAgentBackgroundTurn(turn)) return null;
  if (agentPromptLooksClipped(turn.prompt)) return null;
  return turn.prompt;
}

function resumedTurnLoss(eventsTruncated: boolean): AgentTurnLogLoss {
  if (!eventsTruncated) return NO_AGENT_TURN_LOG_LOSS;
  return { kind: "legacyWindow" };
}

function backgroundTurnLoss(eventsTruncated: boolean): AgentTurnLogLoss {
  if (!eventsTruncated) return NO_AGENT_TURN_LOG_LOSS;
  return { kind: "backgroundBuffer" };
}

function recordTurnLogEvents(
  turnLog: AgentTurnLogIntegration,
  next: AgentThreadsState,
  action: Extract<AgentThreadsAction, { kind: "turnEventsAppended" }>,
): void {
  turnLog.writer.recordEvents(action.turnId, action.events);
  recordTurnLogLifecycle(turnLog, next, action.threadId, action.turnId);
  if (!action.supervisorTruncated) return;
  turnLog.writer.reportLoss(action.turnId, { kind: "supervisorGap" });
}

function recordTurnLogLifecycle(
  turnLog: AgentTurnLogIntegration,
  next: AgentThreadsState,
  threadId: string,
  turnId: string,
): void {
  const turn = next.threads.get(threadId)?.turns.find((candidate) => candidate.turnId === turnId);
  if (turn?.subagentLifecycle === undefined) return;
  turnLog.writer.recordLifecycle(turnId, turn.subagentLifecycle);
}

export function interruptedLoggedThreads(
  threads: ReadonlyArray<AgentThread>,
): ReadonlyArray<AgentThread> {
  const interrupted: AgentThread[] = [];
  for (const thread of threads) {
    if (interrupted.length >= MAX_INTERRUPTED_AGENT_THREADS_PER_LOAD) return interrupted;
    if (!isLoggedAgentThread(thread)) continue;
    if (thread.turns.every((turn) => isTerminalAgentTurnStatus(turn.status))) continue;
    interrupted.push(thread);
  }
  return interrupted;
}

export function sealInterruptedTurnLogs(
  turnLog: AgentTurnLogIntegration,
  authority: AgentProjectAuthority,
  thread: AgentThread,
  losses: ReadonlyMap<string, AgentTurnLogLoss>,
): void {
  if (losses.size === 0) return;
  let sealed = 0;
  for (const turn of thread.turns) {
    if (sealed >= MAX_SEALED_INTERRUPTED_TURN_LOGS_PER_THREAD) return;
    if (isTerminalAgentTurnStatus(turn.status)) continue;
    const loss = losses.get(turn.turnId);
    if (loss === undefined) continue;
    turnLog.writer.openTurn({
      scope: {
        rootKey: thread.owner.rootKey,
        ownerId: agentRootOwnerId(thread.owner.rootKey),
        threadId: thread.threadId,
        turnId: turn.turnId,
      },
      generation: authority.generation,
      provider: thread.provider.kind,
      priorLoss: loss,
      prompt: loggablePrompt(turn),
    });
    turnLog.writer.sealTurn(turn.turnId);
    sealed += 1;
  }
}

function closeTurnLogSlots(
  turnLog: AgentTurnLogIntegration,
  state: AgentThreadsState,
  threadId: string,
): void {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return;
  for (const turn of thread.turns) {
    turnLog.writer.closeTurn(turn.turnId);
    turnLog.facts.forgetTurn(turn.turnId);
  }
}
