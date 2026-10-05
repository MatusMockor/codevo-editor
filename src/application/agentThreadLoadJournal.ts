import { MAX_AGENT_THREADS_PER_ROOT } from "../domain/agentThread";

export interface AgentThreadLoadLease {
  readonly rootKey: string;
  readonly removedThreadIds: ReadonlySet<string>;
  readonly overflowed: boolean;
  readonly abandoned: boolean;
}

interface PendingLoad extends AgentThreadLoadLease {
  readonly removedThreadIds: Set<string>;
  overflowed: boolean;
  abandoned: boolean;
}

/** Removal evidence belongs only to the current pending load of each project. */
export class AgentThreadLoadJournal {
  private readonly pending = new Map<string, PendingLoad>();

  begin(rootKey: string): AgentThreadLoadLease {
    this.discard(rootKey);
    const lease: PendingLoad = {
      rootKey,
      removedThreadIds: new Set(),
      overflowed: false,
      abandoned: false,
    };
    this.pending.set(rootKey, lease);
    return lease;
  }

  recordRemoval(rootKey: string, threadId: string): void {
    const lease = this.pending.get(rootKey);
    if (lease === undefined || lease.overflowed || lease.removedThreadIds.has(threadId)) return;
    if (lease.removedThreadIds.size >= MAX_AGENT_THREADS_PER_ROOT) {
      lease.overflowed = true;
      return;
    }
    lease.removedThreadIds.add(threadId);
  }

  settle(lease: AgentThreadLoadLease): void {
    if (this.pending.get(lease.rootKey) === lease) this.pending.delete(lease.rootKey);
  }

  discard(rootKey: string): void {
    const lease = this.pending.get(rootKey);
    if (lease !== undefined) {
      lease.abandoned = true;
      lease.removedThreadIds.clear();
    }
    this.pending.delete(rootKey);
  }

  clear(): void {
    for (const rootKey of this.pending.keys()) this.discard(rootKey);
  }
}
