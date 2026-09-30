import { useMemo, useState, type ReactNode } from "react";
import type { AgentThreadAgents } from "../useAgentThreadAgents";
import {
  AgentAgentsPanelContext,
  createAgentSnapshotStore,
  type AgentRunningWorkSurface,
} from "./agentAgentsPanelHooks";

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
  const [store] = useState(createAgentSnapshotStore<AgentThreadAgents>);
  const [running] = useState(createAgentSnapshotStore<AgentRunningWorkSurface>);
  const value = useMemo(
    () => ({ store, running, isOpen, open: onOpen, toggle: onToggle }),
    [isOpen, onOpen, onToggle, running, store],
  );
  return (
    <AgentAgentsPanelContext.Provider value={value}>{children}</AgentAgentsPanelContext.Provider>
  );
}
