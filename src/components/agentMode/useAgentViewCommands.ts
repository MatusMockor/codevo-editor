import { useEffect, useRef } from "react";
import type {
  AgentViewCommandBridge,
  AgentViewCommandHandlers,
} from "../../application/agentViewCommandBridge";
import { editorTextFocused } from "../../application/editorTextFocus";

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
      newThreadIn: () => ref.current.newThreadIn?.(),
      previousThread: () => ref.current.previousThread(),
      nextThread: () => ref.current.nextThread(),
      jumpToThread: (slot) => ref.current.jumpToThread(slot),
      searchThreads: () => ref.current.searchThreads(),
      findInThread: () => ref.current.findInThread(),
      goToTurn: () => ref.current.goToTurn?.(),
      threadFindFocused: () => ref.current.threadFindFocused?.() ?? false,
      editorTextFocused: () => editorTextFocused(document),
      runPreferredScript: () => ref.current.runPreferredScript?.(),
      openCommitMenu: () => ref.current.openCommitMenu?.(),
      toggleMaximizedPanel: () => ref.current.toggleMaximizedPanel?.(),
      addProject: () => ref.current.addProject?.(),
      threadSelected: () => ref.current.threadSelected(),
      surfaceBlocked: (surface) => ref.current.surfaceBlocked(surface),
    });
  }, [bridge]);
}
