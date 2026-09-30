import { createContext, useContext, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { AgentThreadAgents } from "../useAgentThreadAgents";
import type { AgentRunningWork } from "./agentRunningWork";

interface AgentSnapshotStore<T> {
  getSnapshot(): T | null;
  subscribe(listener: () => void): () => void;
  publish(value: T | null): void;
}

export interface AgentRunningWorkSurface {
  readonly threadId: string;
  readonly work: AgentRunningWork;
  stopTask(taskId: string): void;
}

export interface AgentAgentsPanelContextValue {
  readonly store: AgentSnapshotStore<AgentThreadAgents>;
  readonly running: AgentSnapshotStore<AgentRunningWorkSurface>;
  readonly isOpen: boolean;
  open(): void;
  toggle(): void;
}

export interface AgentAgentsPanelControls {
  readonly isOpen: boolean;
  readonly working: number;
  open(): void;
  toggle(): void;
}

export const AgentAgentsPanelContext = createContext<AgentAgentsPanelContextValue | null>(null);
const NOOP = (): void => undefined;
const NO_SUBSCRIPTION = (): (() => void) => NOOP;
const NO_SNAPSHOT = (): null => null;

export function createAgentSnapshotStore<T>(): AgentSnapshotStore<T> {
  let current: T | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(value) {
      if (value === current) return;
      current = value;
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
    context?.store.getSnapshot ?? NO_SNAPSHOT,
  );
}

export function usePublishAgentRunningWork(surface: AgentRunningWorkSurface): void {
  const context = useContext(AgentAgentsPanelContext);
  useLayoutEffect(() => {
    if (context === null) return;
    context.running.publish(surface);
    return () => {
      if (context.running.getSnapshot() === surface) context.running.publish(null);
    };
  }, [context, surface]);
}

export function useAgentRunningWorkSnapshot(): AgentRunningWorkSurface | null {
  const context = useContext(AgentAgentsPanelContext);
  return useSyncExternalStore(
    context?.running.subscribe ?? NO_SUBSCRIPTION,
    context?.running.getSnapshot ?? NO_SNAPSHOT,
  );
}

export function useAgentAgentsPanelOpener(): () => void {
  return useContext(AgentAgentsPanelContext)?.open ?? NOOP;
}

export function useAgentAgentsPanelControls(): AgentAgentsPanelControls {
  const context = useContext(AgentAgentsPanelContext);
  const agents = useAgentThreadAgentsSnapshot();
  const running = useAgentRunningWorkSnapshot();
  const runningAgents =
    running !== null && running.threadId === agents?.threadId ? running.work.agents : null;
  return useMemo(
    () => ({
      isOpen: context?.isOpen ?? false,
      working: runningAgents ?? agents?.working ?? 0,
      open: context?.open ?? NOOP,
      toggle: context?.toggle ?? NOOP,
    }),
    [agents, context, runningAgents],
  );
}
