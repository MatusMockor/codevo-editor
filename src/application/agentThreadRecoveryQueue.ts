export const MAX_RECOVERING_AGENT_ROOTS = 8;
export const MAX_QUEUED_REPLIES_PER_RECOVERING_ROOT = 32;

interface RecoveryChain {
  tail: Promise<void>;
  size: number;
}

export class AgentThreadRecoveryQueue {
  private readonly chains = new Map<string, RecoveryChain>();

  constructor(private readonly onFailure: (error: unknown) => void) {}

  isRecovering(rootKey: string): boolean {
    return this.chains.has(rootKey);
  }

  enqueue(rootKey: string, job: () => Promise<void>): boolean {
    const existing = this.chains.get(rootKey);
    if (existing === undefined && this.chains.size >= MAX_RECOVERING_AGENT_ROOTS) return false;
    if (existing !== undefined && existing.size >= MAX_QUEUED_REPLIES_PER_RECOVERING_ROOT)
      return false;
    const chain = existing ?? { tail: Promise.resolve(), size: 0 };
    chain.size += 1;
    chain.tail = chain.tail
      .then(job)
      .catch(this.onFailure)
      .finally(() => this.settle(rootKey, chain));
    this.chains.set(rootKey, chain);
    return true;
  }

  private settle(rootKey: string, chain: RecoveryChain): void {
    chain.size -= 1;
    if (chain.size > 0) return;
    if (this.chains.get(rootKey) === chain) this.chains.delete(rootKey);
  }
}
