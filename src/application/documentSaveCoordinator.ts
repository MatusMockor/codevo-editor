import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

export type DocumentSaveOutcome<TResult> =
  | { status: "saved"; result: TResult }
  | { status: "stale" }
  | { status: "disposed" };

export interface DocumentSaveKey {
  readonly rootPath: string;
  readonly path: string;
}

export interface DocumentSaveLease {
  readonly path: string;
  readonly rootPath: string;
  readonly epoch: number;
  isCurrent(): boolean;
}

export type DocumentSaveOperation<TResult> = (
  lease: DocumentSaveLease,
) => Promise<TResult>;

export type DocumentSaveInvalidationScope =
  | { kind: "workspace"; rootPath: string }
  | { kind: "file"; rootPath: string; path: string }
  | { kind: "directory"; rootPath: string; path: string };

export type RunWithDocumentSaveExclusion = <T>(
  scope: DocumentSaveInvalidationScope,
  operation: () => Promise<T>,
) => Promise<T>;

interface PendingSave<TResult> {
  epoch: number;
  operation: DocumentSaveOperation<TResult>;
  sequence: number;
}

type SaveExecution<TResult> =
  | { status: "pending" }
  | { status: "failed"; error: unknown }
  | { status: "succeeded"; result: TResult };

interface SaveWaiter<TResult> {
  epoch: number;
  execution: SaveExecution<TResult>;
  reject: (reason?: unknown) => void;
  resolve: (outcome: DocumentSaveOutcome<TResult>) => void;
  sequence: number;
  settled: boolean;
  terminalSequence: number;
}

interface ActiveSave {
  promise: Promise<unknown>;
  sequence: number;
}

interface SaveLane<TResult> {
  active: ActiveSave | null;
  epoch: number;
  key: DocumentSaveKey;
  nextSequence: number;
  pending: PendingSave<TResult> | null;
  waiters: SaveWaiter<TResult>[];
}

/** Coordinates save operations without owning document or React state. */
export class DocumentSaveCoordinator<TResult = void> {
  private readonly exclusions = new Set<DocumentSaveInvalidationScope>();
  private readonly lanes = new Map<string, SaveLane<TResult>>();
  private disposed = false;
  private nextEpoch = 0;

  request(
    key: DocumentSaveKey,
    operation: DocumentSaveOperation<TResult>,
  ): Promise<DocumentSaveOutcome<TResult>> {
    if (this.disposed) {
      return Promise.resolve({ status: "disposed" });
    }
    if (this.isExcluded(key)) {
      return Promise.resolve({ status: "stale" });
    }

    const laneId = documentSaveKeyId(key);
    let lane = this.lanes.get(laneId);
    if (!lane) {
      lane = {
        active: null,
        epoch: ++this.nextEpoch,
        key: { ...key },
        nextSequence: 0,
        pending: null,
        waiters: [],
      };
      this.lanes.set(laneId, lane);
    }

    const epoch = lane.epoch;
    const sequence = ++lane.nextSequence;
    if (lane.pending) {
      this.replacePendingExecution(lane, lane.pending.sequence, sequence);
    }
    lane.pending = { epoch, operation, sequence };

    const result = new Promise<DocumentSaveOutcome<TResult>>(
      (resolve, reject) => {
        lane.waiters.push({
          epoch,
          execution: { status: "pending" },
          reject,
          resolve,
          sequence,
          settled: false,
          terminalSequence: sequence,
        });
      },
    );

    if (sequence === 1) {
      void this.drain(laneId, lane);
    }

    return result;
  }

  invalidate(key: DocumentSaveKey): void {
    const laneId = documentSaveKeyId(key);
    const lane = this.lanes.get(laneId);
    if (!lane) {
      return;
    }

    lane.epoch = ++this.nextEpoch;
    lane.pending = null;
  }

  async runWithExclusion<T>(
    scope: DocumentSaveInvalidationScope,
    operation: () => Promise<T>,
  ): Promise<T> {
    const exclusion = { ...scope } as DocumentSaveInvalidationScope;
    this.exclusions.add(exclusion);
    const active: Promise<unknown>[] = [];

    for (const lane of this.lanes.values()) {
      if (!matchesInvalidationScope(lane.key, exclusion)) {
        continue;
      }

      this.dropPending(lane);
      if (lane.active) {
        active.push(lane.active.promise);
      }
    }

    try {
      await Promise.allSettled(active);
      return await operation();
    } finally {
      this.exclusions.delete(exclusion);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const lane of this.lanes.values()) {
      lane.epoch = ++this.nextEpoch;
      lane.pending = null;
      for (const waiter of lane.waiters) {
        this.resolveWaiter(waiter, { status: "disposed" });
      }
      lane.waiters = [];
    }
  }

  private dropPending(lane: SaveLane<TResult>): void {
    lane.pending = null;
    const activeSequence = lane.active?.sequence ?? 0;

    for (const waiter of lane.waiters) {
      if (waiter.sequence <= activeSequence) {
        continue;
      }

      this.resolveWaiter(waiter, { status: "stale" });
    }

    lane.waiters = lane.waiters.filter((waiter) => !waiter.settled);
  }

  private isExcluded(key: DocumentSaveKey): boolean {
    for (const scope of this.exclusions) {
      if (matchesInvalidationScope(key, scope)) {
        return true;
      }
    }

    return false;
  }

  private createLease(
    laneId: string,
    lane: SaveLane<TResult>,
    epoch: number,
  ): DocumentSaveLease {
    return {
      epoch,
      isCurrent: () =>
        !this.disposed &&
        this.lanes.get(laneId) === lane &&
        lane.epoch === epoch,
      path: lane.key.path,
      rootPath: lane.key.rootPath,
    };
  }

  private async drain(
    laneId: string,
    lane: SaveLane<TResult>,
  ): Promise<void> {
    while (lane.pending) {
      const pending = lane.pending;
      lane.pending = null;

      try {
        const promise = pending.operation(
          this.createLease(laneId, lane, pending.epoch),
        );
        lane.active = { promise, sequence: pending.sequence };
        const result = await promise;
        this.recordResult(lane, pending, result);
      } catch (error) {
        this.recordFailure(lane, pending, error);
      } finally {
        lane.active = null;
      }
    }

    if (this.lanes.get(laneId) === lane) {
      this.lanes.delete(laneId);
    }

    this.settle(lane);
  }

  private recordFailure(
    lane: SaveLane<TResult>,
    pending: PendingSave<TResult>,
    error: unknown,
  ): void {
    for (const waiter of lane.waiters) {
      if (waiter.epoch !== pending.epoch) {
        continue;
      }
      if (waiter.terminalSequence !== pending.sequence) {
        continue;
      }

      waiter.execution = { status: "failed", error };
    }
  }

  private recordResult(
    lane: SaveLane<TResult>,
    pending: PendingSave<TResult>,
    result: TResult,
  ): void {
    for (const waiter of lane.waiters) {
      if (waiter.epoch !== pending.epoch) {
        continue;
      }
      if (waiter.terminalSequence !== pending.sequence) {
        continue;
      }

      waiter.execution = { status: "succeeded", result };
    }
  }

  private replacePendingExecution(
    lane: SaveLane<TResult>,
    replacedSequence: number,
    replacementSequence: number,
  ): void {
    for (const waiter of lane.waiters) {
      if (waiter.terminalSequence !== replacedSequence) {
        continue;
      }

      waiter.terminalSequence = replacementSequence;
    }
  }

  private settle(lane: SaveLane<TResult>): void {
    for (const waiter of lane.waiters) {
      if (this.disposed) {
        this.resolveWaiter(waiter, { status: "disposed" });
        continue;
      }
      if (waiter.epoch !== lane.epoch) {
        this.resolveWaiter(waiter, { status: "stale" });
        continue;
      }
      if (waiter.execution.status === "failed") {
        this.rejectWaiter(waiter, waiter.execution.error);
        continue;
      }
      if (waiter.execution.status !== "succeeded") {
        this.resolveWaiter(waiter, { status: "stale" });
        continue;
      }

      this.resolveWaiter(waiter, {
        status: "saved",
        result: waiter.execution.result,
      });
    }

    lane.waiters = [];
  }

  private rejectWaiter(waiter: SaveWaiter<TResult>, reason: unknown): void {
    if (waiter.settled) {
      return;
    }

    waiter.settled = true;
    waiter.reject(reason);
  }

  private resolveWaiter(
    waiter: SaveWaiter<TResult>,
    outcome: DocumentSaveOutcome<TResult>,
  ): void {
    if (waiter.settled) {
      return;
    }

    waiter.settled = true;
    waiter.resolve(outcome);
  }
}

function documentSaveKeyId(key: DocumentSaveKey): string {
  return JSON.stringify([normalizedWorkspaceRootKey(key.rootPath), key.path]);
}

function matchesInvalidationScope(
  key: DocumentSaveKey,
  scope: DocumentSaveInvalidationScope,
): boolean {
  if (
    normalizedWorkspaceRootKey(key.rootPath) !==
    normalizedWorkspaceRootKey(scope.rootPath)
  ) {
    return false;
  }
  if (scope.kind === "workspace") {
    return true;
  }
  if (scope.kind === "file") {
    return key.path === scope.path;
  }

  return isDirectoryOrDescendant(scope.path, key.path);
}

function isDirectoryOrDescendant(directory: string, path: string): boolean {
  if (path === directory) {
    return true;
  }

  if (directory.endsWith("/") || directory.endsWith("\\")) {
    return path.startsWith(directory);
  }

  return path.startsWith(`${directory}/`) || path.startsWith(`${directory}\\`);
}
