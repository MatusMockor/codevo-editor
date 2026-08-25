import { useEffect, useRef } from "react";
import type {
  AgentViewCommandBridge,
  AgentViewCommandHandlers,
} from "../../application/agentViewCommandBridge";

export function useAgentViewCommands(
  bridge: AgentViewCommandBridge | null,
  handlers: AgentViewCommandHandlers,
): void {
  const ref = useRef(handlers);

  useEffect(() => {
    ref.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (bridge === null) return;
    return bridge.bind({
      newThread: () => ref.current.newThread(),
      previousThread: () => ref.current.previousThread(),
      nextThread: () => ref.current.nextThread(),
      jumpToThread: (slot) => ref.current.jumpToThread(slot),
      searchThreads: () => ref.current.searchThreads(),
      findInThread: () => ref.current.findInThread(),
      threadSelected: () => ref.current.threadSelected(),
    });
  }, [bridge]);
}
