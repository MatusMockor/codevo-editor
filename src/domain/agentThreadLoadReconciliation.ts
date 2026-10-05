import type { AgentThread, AgentThreadLoadOwner, AgentThreadsState } from "./agentThread";

/** A load is a snapshot: it cannot replace mutations made after that load began. */
export function reconcileAgentThreadLoad(
  before: AgentThreadsState,
  current: AgentThreadsState,
  owner: AgentThreadLoadOwner,
  loaded: ReadonlyArray<AgentThread>,
  removedThreadIds: ReadonlySet<string> = new Set(),
): {
  readonly threads: ReadonlyArray<AgentThread>;
  readonly retainedThreadIds: ReadonlySet<string>;
} {
  const retainedThreadIds = new Set<string>();
  for (const [id, thread] of current.threads) {
    if (thread.owner.rootKey !== owner.rootKey) continue;
    if (before.threads.get(id) !== thread) retainedThreadIds.add(id);
  }
  return {
    retainedThreadIds,
    threads: loaded
      .filter(
        (thread) =>
          !removedThreadIds.has(thread.threadId) &&
          (!before.threads.has(thread.threadId) || current.threads.has(thread.threadId)),
      )
      .map((thread) =>
        thread.owner.ownerId === owner.ownerId
          ? thread
          : { ...thread, owner: { ...thread.owner, ownerId: owner.ownerId } },
      ),
  };
}
