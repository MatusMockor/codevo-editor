import type { AgentTurn } from "../domain/agentThread";
import type { AgentThreadView } from "./agentThreadPorts";

/** Compare bounded display metadata only: never serialize transcript events or prompt text. */
function sameTurn(previous: AgentTurn, next: AgentTurn): boolean {
  if (previous.prompt !== next.prompt) return false;
  if (
    previous.events !== next.events &&
    (previous.events.length !== next.events.length ||
      !previous.events.every((event, index) => {
        const other = next.events[index];
        return (
          event === other ||
          (event.kind === "userMessage" &&
            other?.kind === "userMessage" &&
            event.remoteMessageId !== undefined &&
            event.remoteMessageId === other.remoteMessageId &&
            event.text === other.text &&
            JSON.stringify(event.attachments) === JSON.stringify(other.attachments))
        );
      }))
  )
    return false;
  const { events: _oldEvents, prompt: _oldPrompt, ...oldMetadata } = previous;
  const { events: _newEvents, prompt: _newPrompt, ...newMetadata } = next;
  return JSON.stringify(oldMetadata) === JSON.stringify(newMetadata);
}

/** Retains only the current inventory. Removed conversations/turns cannot be resurrected. */
export function stabilizeRemoteAgentViews(
  previous: readonly AgentThreadView[],
  next: readonly AgentThreadView[],
): readonly AgentThreadView[] {
  const known = new Map(previous.map((view) => [view.thread.threadId, view]));
  const views = next.map((view) => {
    const old = known.get(view.thread.threadId);
    if (!old || old.thread.owner.rootKey !== view.thread.owner.rootKey) return view;
    const knownTurns = new Map(old.thread.turns.map((turn) => [turn.turnId, turn]));
    const turns = view.thread.turns.map((turn) => {
      const previousTurn = knownTurns.get(turn.turnId);
      return previousTurn && sameTurn(previousTurn, turn) ? previousTurn : turn;
    });
    const sameTurns =
      turns.length === old.thread.turns.length &&
      turns.every((turn, index) => turn === old.thread.turns[index]);
    const { turns: _oldTurns, ...oldThreadMetadata } = old.thread;
    const { turns: _newTurns, ...newThreadMetadata } = view.thread;
    const thread =
      sameTurns && JSON.stringify(oldThreadMetadata) === JSON.stringify(newThreadMetadata)
        ? old.thread
        : { ...view.thread, turns };
    const { thread: _oldThread, ...oldViewMetadata } = old;
    const { thread: _newThread, ...newViewMetadata } = view;
    return thread === old.thread &&
      JSON.stringify(oldViewMetadata) === JSON.stringify(newViewMetadata)
      ? old
      : { ...view, thread };
  });
  return views.length === previous.length && views.every((view, index) => view === previous[index])
    ? previous
    : views;
}
