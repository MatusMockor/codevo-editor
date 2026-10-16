import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { AgentThread } from "../../domain/agentThread";
import type { AgentThreadView } from "../agentThreadPorts";
import type { AgentLiveThreadSource } from "./agentThreadStateStore";

export const AgentLiveThreadContext = createContext<AgentLiveThreadSource | null>(null);

const NO_LIVE_THREADS: ReadonlyArray<AgentThread> = Object.freeze([]);

function subscribeToNothing(): () => void {
  return () => undefined;
}

export function useLiveAgentThread(shown: AgentThread | null): AgentThread | null {
  const source = useContext(AgentLiveThreadContext);
  const subscribe = source === null || shown === null ? subscribeToNothing : source.subscribe;
  const read = (): AgentThread | null =>
    source === null || shown === null ? shown : source.liveThreadOf(shown);
  return useSyncExternalStore(subscribe, read, read);
}

export function useLiveAgentThreadView(view: AgentThreadView | null): AgentThreadView | null {
  const thread = useLiveAgentThread(view?.thread ?? null);
  return useMemo(() => {
    if (view === null || thread === null || thread === view.thread) return view;
    return { ...view, thread };
  }, [thread, view]);
}

export function useLiveAgentThreads(
  shown: ReadonlyArray<AgentThread>,
  enabled: boolean,
): ReadonlyArray<AgentThread> {
  const source = useContext(AgentLiveThreadContext);
  const active = enabled && source !== null && shown.length > 0;
  const cacheRef = useRef<ReadonlyArray<AgentThread>>(NO_LIVE_THREADS);
  const read = useCallback((): ReadonlyArray<AgentThread> => {
    if (!active || source === null) return shown;
    const live = shown.map((thread) => source.liveThreadOf(thread));
    const cached = cacheRef.current;
    if (cached.length === live.length && live.every((thread, index) => thread === cached[index]))
      return cached;
    cacheRef.current = live;
    return live;
  }, [active, shown, source]);
  return useSyncExternalStore(
    active && source !== null ? source.subscribe : subscribeToNothing,
    read,
    read,
  );
}

export function useLiveAgentThreadViews(
  views: ReadonlyArray<AgentThreadView>,
  enabled: boolean,
): ReadonlyArray<AgentThreadView> {
  const shown = useMemo(() => views.map((view) => view.thread), [views]);
  const live = useLiveAgentThreads(shown, enabled);
  return useMemo(() => {
    if (live === shown) return views;
    let changed = false;
    const next = views.map((view, index) => {
      const thread = live[index] ?? view.thread;
      if (thread === view.thread) return view;
      changed = true;
      return { ...view, thread };
    });
    return changed ? next : views;
  }, [live, shown, views]);
}
