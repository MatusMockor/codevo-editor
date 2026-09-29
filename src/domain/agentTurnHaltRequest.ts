import { isTerminalAgentTurnStatus, type AgentThreadsState } from "./agentThread";

export interface AgentTurnHaltRequest {
  readonly threadId: string;
  readonly ownerId: string;
  readonly turnId: string;
}

export function requestAgentTurnHalt(
  state: AgentThreadsState,
  request: AgentTurnHaltRequest,
): AgentThreadsState {
  const thread = state.threads.get(request.threadId);
  if (thread === undefined || thread.owner.ownerId !== request.ownerId) return state;
  const index = thread.turns.findIndex((turn) => turn.turnId === request.turnId);
  const turn = thread.turns[index];
  if (turn === undefined || turn.haltRequested === true) return state;
  if (isTerminalAgentTurnStatus(turn.status)) return state;
  const turns = thread.turns.map((candidate, position) =>
    position === index ? { ...turn, haltRequested: true } : candidate,
  );
  const threads = new Map(state.threads);
  threads.set(thread.threadId, { ...thread, turns });
  return { threads };
}
