import { useMemo, useState, type ReactNode } from "react";
import { AgentAgentsPanelContext, createAgentAgentsStore } from "./agentAgentsPanelHooks";

export function AgentAgentsPanelProvider({
  children,
  isOpen,
  onOpen,
  onToggle,
}: {
  readonly children: ReactNode;
  readonly isOpen: boolean;
  onOpen(): void;
  onToggle(): void;
}) {
  const [store] = useState(createAgentAgentsStore);
  const value = useMemo(
    () => ({ store, isOpen, open: onOpen, toggle: onToggle }),
    [isOpen, onOpen, onToggle, store],
  );
  return (
    <AgentAgentsPanelContext.Provider value={value}>{children}</AgentAgentsPanelContext.Provider>
  );
}
