import type { AgentThread, AgentThreadsState } from "../../domain/agentThread";
import { agentThreadQuietlyStreamed } from "../../domain/agentThreadQuietStream";

export interface AgentLiveThreadSource {
  subscribe(listener: () => void): () => void;
  liveThreadOf(shown: AgentThread): AgentThread;
}

export interface AgentThreadStateStore extends AgentLiveThreadSource {
  current(): AgentThreadsState;
  structural(): AgentThreadsState;
  stage(next: AgentThreadsState): void;
  notify(): void;
}

export function createAgentThreadStateStore(initial: AgentThreadsState): AgentThreadStateStore {
  let current = initial;
  let structural = initial;
  let notified = initial;
  const listeners = new Set<() => void>();
  const incarnations = new WeakMap<AgentThread, number>();
  let lastIncarnation = 0;
  const recordIncarnations = (previous: AgentThreadsState | null, next: AgentThreadsState) => {
    for (const [threadId, thread] of next.threads) {
      if (incarnations.has(thread)) continue;
      const prior = previous?.threads.get(threadId);
      const inherited =
        prior !== undefined && sameThreadIncarnation(prior, thread)
          ? incarnations.get(prior)
          : undefined;
      if (inherited !== undefined) {
        incarnations.set(thread, inherited);
        continue;
      }
      lastIncarnation += 1;
      incarnations.set(thread, lastIncarnation);
    }
  };
  recordIncarnations(null, initial);
  return {
    current: () => current,
    structural: () => structural,
    stage(next) {
      if (next === current) return;
      recordIncarnations(current, next);
      current = next;
      structural = agentThreadsStructuralSnapshot(structural, next);
    },
    notify() {
      if (notified === current) return;
      notified = current;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    liveThreadOf(shown) {
      const live = current.threads.get(shown.threadId);
      if (live === undefined || !sameThreadIncarnation(live, shown)) return shown;
      const incarnation = incarnations.get(shown);
      if (incarnation === undefined || incarnation !== incarnations.get(live)) return shown;
      return live;
    },
  };
}

export function agentThreadsStructuralSnapshot(
  shown: AgentThreadsState,
  next: AgentThreadsState,
): AgentThreadsState {
  if (shown === next) return shown;
  let changed = shown.threads.size !== next.threads.size;
  const shownOrder = shown.threads.keys();
  const threads = new Map<string, AgentThread>();
  for (const [threadId, thread] of next.threads) {
    if (shownOrder.next().value !== threadId) changed = true;
    const previous = shown.threads.get(threadId);
    const kept =
      previous !== undefined && agentThreadQuietlyStreamed(previous, thread) ? previous : thread;
    if (kept !== previous) changed = true;
    threads.set(threadId, kept);
  }
  return changed ? { threads } : shown;
}

export function agentLiveThreadSource(store: AgentLiveThreadSource): AgentLiveThreadSource {
  return Object.freeze({
    subscribe: (listener: () => void) => store.subscribe(listener),
    liveThreadOf: (shown: AgentThread) => store.liveThreadOf(shown),
  });
}

function sameThreadIncarnation(left: AgentThread, right: AgentThread): boolean {
  return (
    left.threadId === right.threadId &&
    left.createdAtEpochMs === right.createdAtEpochMs &&
    left.owner.rootKey === right.owner.rootKey &&
    left.owner.ownerId === right.owner.ownerId &&
    left.owner.repositoryRoot === right.owner.repositoryRoot &&
    left.target.isolation === right.target.isolation &&
    left.target.worktreePath === right.target.worktreePath
  );
}
