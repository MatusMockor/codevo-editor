import { useMemo, type ReactNode } from "react";
import { AgentWorkspaceCard } from "./AgentWorkspaceCard";
import { useAgentWorkspaceCard, type AgentWorkspaceCardSource } from "./useAgentWorkspaceCard";

export interface AgentWorkspaceCardActions {
  readonly newThreadInShortcut: string;
  onNewThreadIn(): void;
  onReveal(path: string): void;
}

export function useAgentWorkspaceCardSlot(
  source: AgentWorkspaceCardSource,
  { newThreadInShortcut, onNewThreadIn, onReveal }: AgentWorkspaceCardActions,
): ReactNode {
  const card = useAgentWorkspaceCard(source);
  return useMemo(
    () => (
      <AgentWorkspaceCard
        card={card}
        newThreadInShortcut={newThreadInShortcut}
        onNewThreadIn={onNewThreadIn}
        onReveal={onReveal}
      />
    ),
    [card, newThreadInShortcut, onNewThreadIn, onReveal],
  );
}
