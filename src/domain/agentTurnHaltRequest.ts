import { isTerminalAgentTurnStatus, type AgentThreadsState, type AgentTurn } from "./agentThread";
import {
  recordAgentTurnHalt,
  type AgentTurnHaltMode,
  type AgentTurnHaltTrigger,
} from "./agentTurnHaltRecord";

export interface AgentTurnHaltIntent {
  readonly threadId: string;
  readonly ownerId: string;
  readonly turnId: string;
  readonly trigger: AgentTurnHaltTrigger;
  readonly mode: AgentTurnHaltMode;
}

export interface AgentTurnHaltRequest extends AgentTurnHaltIntent {
  readonly requestedAtEpochMs: number;
}

export function requestAgentTurnHalt(
  state: AgentThreadsState,
  request: AgentTurnHaltRequest,
): AgentThreadsState {
  const thread = state.threads.get(request.threadId);
  if (thread === undefined || thread.owner.ownerId !== request.ownerId) return state;
  const index = thread.turns.findIndex((turn) => turn.turnId === request.turnId);
  const turn = thread.turns[index];
  if (turn === undefined || isTerminalAgentTurnStatus(turn.status)) return state;
  const haltRequest = recordAgentTurnHalt(turn.haltRequest, request);
  if (turn.haltRequested === true && haltRequest === turn.haltRequest) return state;
  const halted = haltedTurn(turn, haltRequest);
  const turns = thread.turns.map((candidate, position) =>
    position === index ? halted : candidate,
  );
  const threads = new Map(state.threads);
  threads.set(thread.threadId, { ...thread, turns });
  return { threads };
}

function haltedTurn(turn: AgentTurn, haltRequest: AgentTurn["haltRequest"]): AgentTurn {
  if (haltRequest === undefined) return { ...turn, haltRequested: true };
  return { ...turn, haltRequested: true, haltRequest };
}
