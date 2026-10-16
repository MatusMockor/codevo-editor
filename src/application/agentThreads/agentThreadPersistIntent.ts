import { agentRootOwnerId } from "../../domain/agentProject";
import { isTerminalAgentTaskStatus } from "../../domain/agentTask";
import {
  agentThreadsReducer,
  runningTurn,
  type AgentThread,
  type AgentThreadsAction,
  type AgentThreadsState,
  type AgentTurnEvent,
} from "../../domain/agentThread";
import type { DeleteAgentThreadRequest } from "../agentThreadPorts";

export type PersistUrgency = "immediate" | "coalesced";

export interface PersistIntent {
  readonly saves: ReadonlyArray<readonly [string, PersistUrgency]>;
  readonly remove: DeleteAgentThreadRequest | null;
}

const NO_PERSIST: PersistIntent = Object.freeze({ saves: Object.freeze([]), remove: null });

export function persistIntent(
  state: AgentThreadsState,
  next: AgentThreadsState,
  action: AgentThreadsAction,
): PersistIntent {
  if (next === state) return NO_PERSIST;
  switch (action.kind) {
    case "threadCreated":
      return saveIntent(action.thread.threadId, "immediate");
    case "turnStarted":
    case "backgroundTurnRecorded":
    case "externalHistoryLoaded":
      return saveIntent(action.threadId, "immediate");
    case "taskStatusEvent":
      return liveTurnIntent(
        state,
        action.threadId,
        action.event.taskId,
        isTerminalAgentTaskStatus(action.event.status) ? "immediate" : "coalesced",
      );
    case "turnEventsAppended":
      return sessionCaptureIntent(
        state,
        action.threadId,
        action.turnId,
        action.sessionId,
        action.events,
      );
    case "turnSteered":
    case "turnHaltRequested":
      return liveTurnIntent(state, action.threadId, action.turnId, "immediate");
    case "turnInterrupted":
      return liveTurnIntentByTurnId(state, action.turnId, "immediate");
    case "threadViewed":
      return threadViewedIntent(state, action.threadId, action.atEpochMs);
    case "threadMarkedUnread":
      return changedThreadIntent(state, action, "coalesced");
    case "threadOrganizationUpdated":
      return saveIntent(action.threadId, "immediate");
    case "threadReordered":
      return {
        saves: [...next.threads.values()]
          .filter((thread) => thread !== state.threads.get(thread.threadId))
          .map((thread) => [thread.threadId, "immediate"] as const),
        remove: null,
      };
    case "threadRenamed":
      return changedThreadIntent(state, action, "immediate");
    case "ownerRebound":
      return NO_PERSIST;
    case "pinToggled":
    case "archived":
    case "unarchived":
    case "providerSessionInvalidated":
    case "integrationRecorded":
      return state.threads.has(action.threadId)
        ? saveIntent(action.threadId, "immediate")
        : NO_PERSIST;
    case "deleted":
      return removeIntent(state, action.threadId);
    case "loaded":
      return interruptedTurnsIntent(state, action.threads);
    case "ownerReleased":
    case "turnHydrated":
      return NO_PERSIST;
    default:
      return NO_PERSIST;
  }
}

function saveIntent(threadId: string, urgency: PersistUrgency): PersistIntent {
  return { saves: [[threadId, urgency]], remove: null };
}

function changedThreadIntent(
  state: AgentThreadsState,
  action: Extract<AgentThreadsAction, { kind: "threadMarkedUnread" | "threadRenamed" }>,
  urgency: PersistUrgency,
): PersistIntent {
  if (agentThreadsReducer(state, action) === state) return NO_PERSIST;
  return saveIntent(action.threadId, urgency);
}

function threadViewedIntent(
  state: AgentThreadsState,
  threadId: string,
  atEpochMs: number,
): PersistIntent {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return NO_PERSIST;
  if (!Number.isSafeInteger(atEpochMs) || atEpochMs < 0) return NO_PERSIST;
  if (thread.viewedAtEpochMs !== null && atEpochMs <= thread.viewedAtEpochMs) return NO_PERSIST;
  return saveIntent(threadId, "coalesced");
}

function liveTurnIntent(
  state: AgentThreadsState,
  threadId: string,
  turnId: string,
  urgency: PersistUrgency,
): PersistIntent {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return NO_PERSIST;
  if (!thread.turns.some((turn) => turn.turnId === turnId)) return NO_PERSIST;
  return saveIntent(thread.threadId, urgency);
}

function liveTurnIntentByTurnId(
  state: AgentThreadsState,
  turnId: string,
  urgency: PersistUrgency,
): PersistIntent {
  const thread = threadByLiveTurnId(state, turnId);
  if (thread === null) return NO_PERSIST;
  return saveIntent(thread.threadId, urgency);
}

function sessionCaptureIntent(
  state: AgentThreadsState,
  threadId: string,
  turnId: string,
  sessionId: string | null,
  events: ReadonlyArray<AgentTurnEvent>,
): PersistIntent {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return NO_PERSIST;
  if (!thread.turns.some((turn) => turn.turnId === turnId)) return NO_PERSIST;
  const captured = sessionId !== null && thread.provider.sessionId === null;
  const steered = events.some((event) => event.kind === "userMessage");
  return saveIntent(thread.threadId, captured || steered ? "immediate" : "coalesced");
}

function interruptedTurnsIntent(
  state: AgentThreadsState,
  loaded: ReadonlyArray<AgentThread>,
): PersistIntent {
  const saves: Array<readonly [string, PersistUrgency]> = [];
  for (const thread of loaded) {
    if (runningTurn(thread) === null) continue;
    const inMemory = state.threads.get(thread.threadId);
    if (inMemory !== undefined && runningTurn(inMemory) !== null) continue;
    saves.push([thread.threadId, "immediate"]);
  }
  if (saves.length === 0) return NO_PERSIST;
  return { saves, remove: null };
}

function removeIntent(state: AgentThreadsState, threadId: string): PersistIntent {
  const thread = state.threads.get(threadId);
  if (thread === undefined) return NO_PERSIST;
  if (runningTurn(thread) !== null) return NO_PERSIST;
  return {
    saves: [],
    remove: {
      rootKey: thread.owner.rootKey,
      ownerId: agentRootOwnerId(thread.owner.rootKey),
      threadId,
    },
  };
}

function threadByLiveTurnId(state: AgentThreadsState, turnId: string): AgentThread | null {
  for (const thread of state.threads.values()) {
    const last = thread.turns[thread.turns.length - 1];
    if (last !== undefined && last.turnId === turnId) return thread;
  }
  return null;
}
