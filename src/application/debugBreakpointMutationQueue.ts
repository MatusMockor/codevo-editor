const MAX_QUEUED_BREAKPOINT_MUTATIONS_PER_FILE = 32;

export const BREAKPOINT_MUTATION_QUEUE_FULL_ERROR =
  "Too many breakpoint updates are pending. Try again.";

export interface DebugBreakpointMutationOwner {
  readonly adapterKind: "node" | "php" | null;
  readonly filePath: string;
  readonly key: string;
  readonly mutationGeneration: number;
  readonly observedSessionId: number | null;
  readonly rootPath: string;
  readonly sessionId: number | null;
  readonly workspaceEpoch: number;
  readonly workspaceId: string | null;
}

interface QueueEntry {
  depth: number;
  tail: Promise<void>;
}

/**
 * Serializes breakpoint mutations for one exact workspace owner and source file.
 *
 * A rejected operation never poisons the queue. The caller still receives the
 * rejection, while the next operation starts from the state left by its predecessor.
 */
export class DebugBreakpointMutationQueue {
  readonly #entries = new Map<string, QueueEntry>();

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.#entries.get(key);
    if (existing && existing.depth >= MAX_QUEUED_BREAKPOINT_MUTATIONS_PER_FILE) {
      return Promise.reject(new Error(BREAKPOINT_MUTATION_QUEUE_FULL_ERROR));
    }

    const entry = existing ?? { depth: 0, tail: Promise.resolve() };
    entry.depth += 1;
    const result = entry.tail.then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    entry.tail = settled;
    this.#entries.set(key, entry);
    void settled.then(() => {
      entry.depth -= 1;
      if (entry.depth === 0 && this.#entries.get(key) === entry) {
        this.#entries.delete(key);
      }
    });
    return result;
  }
}

export function debugBreakpointMutationQueueKey(
  rootKey: string,
  workspaceId: string | null,
  workspaceEpoch: number,
  filePath: string,
): string {
  return `${rootKey}\0${workspaceId ?? ""}\0${workspaceEpoch}\0${filePath}`;
}
