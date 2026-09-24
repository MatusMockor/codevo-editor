import { createContext, useContext, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { agentWorkingAgentNames } from "../agentAgentsPanelPresentation";
import type { AgentThreadAgents } from "../useAgentThreadAgents";
interface AgentAgentsStore {
  getSnapshot(): AgentThreadAgents | null;
  subscribe(listener: () => void): () => void;
  publish(agents: AgentThreadAgents | null): void;
}

export interface AgentAgentsPanelContextValue {
  readonly store: AgentAgentsStore;
  readonly isOpen: boolean;
  open(): void;
  toggle(): void;
}

export interface AgentAgentsPanelControls {
  readonly isOpen: boolean;
  readonly working: number;
  readonly names: ReadonlyArray<string>;
  open(): void;
  toggle(): void;
}

export const AgentAgentsPanelContext = createContext<AgentAgentsPanelContextValue | null>(null);
const NOOP = (): void => undefined;
const NO_SUBSCRIPTION = (): (() => void) => NOOP;
const NO_AGENTS = (): AgentThreadAgents | null => null;
const EMPTY_NAMES: ReadonlyArray<string> = [];

export function createAgentAgentsStore(): AgentAgentsStore {
  let current: AgentThreadAgents | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(agents) {
      if (agents === current) return;
      current = agents;
      for (const listener of [...listeners]) listener();
    },
  };
}

export function usePublishAgentThreadAgents(agents: AgentThreadAgents): void {
  const context = useContext(AgentAgentsPanelContext);
  useLayoutEffect(() => {
    if (context === null) return;
    context.store.publish(agents);
    return () => {
      if (context.store.getSnapshot() === agents) context.store.publish(null);
    };
  }, [agents, context]);
}

export function useAgentThreadAgentsSnapshot(): AgentThreadAgents | null {
  const context = useContext(AgentAgentsPanelContext);
  return useSyncExternalStore(
    context?.store.subscribe ?? NO_SUBSCRIPTION,
    context?.store.getSnapshot ?? NO_AGENTS,
  );
}

export function useAgentAgentsPanelOpener(): () => void {
  return useContext(AgentAgentsPanelContext)?.open ?? NOOP;
}

export function useAgentAgentsPanelControls(): AgentAgentsPanelControls {
  const context = useContext(AgentAgentsPanelContext);
  const agents = useAgentThreadAgentsSnapshot();
  return useMemo(
    () => ({
      isOpen: context?.isOpen ?? false,
      working: agents?.working ?? 0,
      names: agents === null ? EMPTY_NAMES : agentWorkingAgentNames(agents.groups),
      open: context?.open ?? NOOP,
      toggle: context?.toggle ?? NOOP,
    }),
    [agents, context],
  );
}
