import { attempt, type Attempt } from "./agentProjectAuthority";

export const MAX_AGENT_ATTACHMENT_CONCURRENT_READS = 2;
export const AGENT_ATTACHMENT_READ_RETRY_DELAYS_MS: ReadonlyArray<number> = [250, 500, 1_000];
export const AGENT_ATTACHMENT_READ_QUEUE_FULL_REASON = "Too many image previews are waiting.";

const TRANSIENT_RUNNER_BUSY_MESSAGES: ReadonlySet<string> = new Set([
  "Runner request failed (HTTP 503).",
  "Runner is busy; retry shortly",
]);

export function isTransientRunnerBusyError(error: unknown): boolean {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return TRANSIENT_RUNNER_BUSY_MESSAGES.has(message.trim());
}

export interface AgentAttachmentReadJob<TValue> {
  readonly read: () => Promise<TValue>;
  readonly isCurrent: () => boolean;
  readonly settle: (result: Attempt<TValue>) => void;
}

export interface AgentAttachmentReadLimiter<TValue> {
  schedule(job: AgentAttachmentReadJob<TValue>): void;
  prune(): void;
  dispose(): void;
}

interface ReadSlot<TValue> {
  readonly job: AgentAttachmentReadJob<TValue>;
  timer: ReturnType<typeof setTimeout> | null;
}

export type AgentAttachmentReadRetryPredicate = (error: unknown) => boolean;

export function createAgentAttachmentReadLimiter<TValue>(
  queueCapacity: number,
  isRetryable: AgentAttachmentReadRetryPredicate = isTransientRunnerBusyError,
): AgentAttachmentReadLimiter<TValue> {
  const queue: AgentAttachmentReadJob<TValue>[] = [];
  const active = new Set<ReadSlot<TValue>>();
  let disposed = false;

  const pump = (): void => {
    while (!disposed && active.size < MAX_AGENT_ATTACHMENT_CONCURRENT_READS) {
      const job = queue.shift();
      if (job === undefined) return;
      if (!job.isCurrent()) continue;
      const slot: ReadSlot<TValue> = { job, timer: null };
      active.add(slot);
      void run(slot, 0);
    }
  };

  const release = (slot: ReadSlot<TValue>): void => {
    if (slot.timer !== null) clearTimeout(slot.timer);
    slot.timer = null;
    if (!active.delete(slot)) return;
    pump();
  };

  const run = async (slot: ReadSlot<TValue>, attemptIndex: number): Promise<void> => {
    const result = await attempt(slot.job.read);
    if (disposed || !active.has(slot)) return;
    if (!slot.job.isCurrent()) {
      release(slot);
      return;
    }
    const delay =
      result.ok || !isRetryable(result.error)
        ? undefined
        : AGENT_ATTACHMENT_READ_RETRY_DELAYS_MS[attemptIndex];
    if (delay === undefined) {
      active.delete(slot);
      try {
        slot.job.settle(result);
      } finally {
        pump();
      }
      return;
    }
    slot.timer = setTimeout(() => {
      slot.timer = null;
      if (disposed || !active.has(slot)) return;
      if (!slot.job.isCurrent()) {
        release(slot);
        return;
      }
      void run(slot, attemptIndex + 1);
    }, delay);
  };

  const prune = (): void => {
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (!queue[index]?.isCurrent()) queue.splice(index, 1);
    }
    for (const slot of [...active]) {
      if (slot.timer !== null && !slot.job.isCurrent()) release(slot);
    }
  };

  return {
    schedule(job) {
      if (disposed) return;
      if (queue.length >= queueCapacity) prune();
      if (queue.length >= queueCapacity) {
        job.settle({ ok: false, error: new Error(AGENT_ATTACHMENT_READ_QUEUE_FULL_REASON) });
        return;
      }
      queue.push(job);
      pump();
    },
    prune,
    dispose() {
      disposed = true;
      queue.length = 0;
      for (const slot of active) {
        if (slot.timer !== null) clearTimeout(slot.timer);
        slot.timer = null;
      }
      active.clear();
    },
  };
}
