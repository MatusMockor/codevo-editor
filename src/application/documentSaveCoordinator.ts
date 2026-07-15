import {
  createDocumentSaveIdentity,
  documentSaveIdentitySegments,
  legacyDocumentSaveIdentity,
  type DocumentSaveIdentity,
  type LegacyDocumentSaveOwnership,
} from "./documentSaveIdentity";

export type DocumentSaveOutcome<TResult> =
  | { status: "saved"; result: TResult }
  | { status: "stale" }
  | { status: "disposed" };

export type DocumentSaveKey =
  | DocumentSaveIdentity
  | LegacyDocumentSaveOwnership;

export interface DocumentSaveLease {
  readonly path: string;
  readonly rootPath: string;
  readonly epoch: number;
  isCurrent(): boolean;
  tryBeginWrite(): DocumentSaveWritePermit | null;
}

export interface DocumentSaveWritePermit {
  readonly granted: true;
  settle(): void;
}

export class DocumentSaveCoordinatorDisposedError extends Error {
  constructor() {
    super("Document save coordinator disposed while draining issued writes");
    this.name = "DocumentSaveCoordinatorDisposedError";
  }
}

export type DocumentSaveOperation<TResult> = (
  lease: DocumentSaveLease,
) => Promise<TResult>;

export type DocumentSaveInvalidationScope =
  | { kind: "workspace"; canonicalRoot: string; rootPath?: never }
  | ({ kind: "file" | "directory"; rootPath?: never } &
      DocumentSaveIdentity)
  | LegacyDocumentSaveInvalidationScope;

/** @deprecated Resolve selected paths before calling the coordinator. */
export type LegacyDocumentSaveInvalidationScope =
  | { kind: "workspace"; canonicalRoot?: never; rootPath: string }
  | {
      kind: "file" | "directory";
      canonicalRoot?: never;
      rootPath: string;
      path: string;
    };

type CanonicalDocumentSaveInvalidationScope =
  | { kind: "workspace"; canonicalRoot: string }
  | ({ kind: "file" | "directory" } & DocumentSaveIdentity);

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

interface SaveBarrier {
  promise: Promise<void>;
  resolve: () => void;
}

interface ActiveSave {
  issuedWrite: IssuedWrite | null;
  operation: Promise<unknown> | null;
  operationBarrier: SaveBarrier;
  sequence: number;
  writeDenied: boolean;
}

interface IssuedWrite {
  barrier: SaveBarrier;
  permit: DocumentSaveWritePermit;
  settled: boolean;
}

interface IssuedWriteDrain {
  cancellation: SaveBarrier;
  cancelled: boolean;
  waiting: boolean;
}

interface SaveLane<TResult> {
  active: ActiveSave | null;
  epoch: number;
  issuedWrites: Set<IssuedWrite>;
  identity: DocumentSaveIdentity;
  nextSequence: number;
  pending: PendingSave<TResult> | null;
  waiters: SaveWaiter<TResult>[];
}

/** Coordinates save operations without owning document or React state. */
export class DocumentSaveCoordinator<TResult = void> {
  private readonly issuedWriteDrains = new Set<IssuedWriteDrain>();
  private readonly exclusions =
    new Set<CanonicalDocumentSaveInvalidationScope>();
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
    const identity = resolveDocumentSaveIdentity(key);
    if (!identity || this.isExcluded(identity)) {
      return Promise.resolve({ status: "stale" });
    }

    const laneId = documentSaveKeyId(identity);
    let lane = this.lanes.get(laneId);
    if (!lane) {
      lane = {
        active: null,
        epoch: ++this.nextEpoch,
        issuedWrites: new Set(),
        identity,
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
    const identity = resolveDocumentSaveIdentity(key);
    if (!identity) {
      return;
    }

    const laneId = documentSaveKeyId(identity);
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
    const exclusion = resolveInvalidationScope(scope);
    if (!exclusion) {
      return operation();
    }
    this.exclusions.add(exclusion);
    const active: Promise<unknown>[] = [];

    for (const lane of this.lanes.values()) {
      if (!matchesInvalidationScope(lane.identity, exclusion)) {
        continue;
      }

      this.dropPending(lane);
      if (lane.active) {
        active.push(
          lane.active.operation ?? lane.active.operationBarrier.promise,
        );
      }
    }

    try {
      await Promise.allSettled(active);
      return await operation();
    } finally {
      this.exclusions.delete(exclusion);
    }
  }

  async runWithIssuedWriteDrain<T>(
    scope: DocumentSaveInvalidationScope,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.disposed) {
      throw new DocumentSaveCoordinatorDisposedError();
    }

    const exclusion = resolveInvalidationScope(scope);
    if (!exclusion) {
      return operation();
    }
    const drain: IssuedWriteDrain = {
      cancellation: saveBarrier(),
      cancelled: false,
      waiting: true,
    };
    this.issuedWriteDrains.add(drain);
    this.exclusions.add(exclusion);
    const issuedWrites: Promise<void>[] = [];

    for (const lane of this.lanes.values()) {
      if (!matchesInvalidationScope(lane.identity, exclusion)) {
        continue;
      }

      this.dropPending(lane);
      if (lane.active && !lane.active.issuedWrite) {
        lane.active.writeDenied = true;
      }
      for (const issuedWrite of lane.issuedWrites) {
        issuedWrites.push(issuedWrite.barrier.promise);
      }
    }

    try {
      if (issuedWrites.length > 0) {
        await Promise.race([
          Promise.allSettled(issuedWrites),
          drain.cancellation.promise,
        ]);
      }
      if (drain.cancelled || this.disposed) {
        throw new DocumentSaveCoordinatorDisposedError();
      }

      drain.waiting = false;
      return await operation();
    } finally {
      drain.waiting = false;
      this.exclusions.delete(exclusion);
      this.issuedWriteDrains.delete(drain);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const drain of this.issuedWriteDrains) {
      if (!drain.waiting) {
        continue;
      }

      drain.cancelled = true;
      drain.cancellation.resolve();
    }
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

  private isExcluded(identity: DocumentSaveIdentity): boolean {
    for (const scope of this.exclusions) {
      if (matchesInvalidationScope(identity, scope)) {
        return true;
      }
    }

    return false;
  }

  private createLease(
    laneId: string,
    lane: SaveLane<TResult>,
    epoch: number,
    active: ActiveSave,
  ): DocumentSaveLease {
    return {
      epoch,
      isCurrent: () =>
        !this.disposed &&
        this.lanes.get(laneId) === lane &&
        lane.epoch === epoch,
      path: lane.identity.workspaceRelativePath,
      rootPath: lane.identity.canonicalRoot,
      tryBeginWrite: () =>
        this.tryBeginWrite(laneId, lane, active, epoch),
    };
  }

  private tryBeginWrite(
    laneId: string,
    lane: SaveLane<TResult>,
    active: ActiveSave,
    epoch: number,
  ): DocumentSaveWritePermit | null {
    if (active.issuedWrite) {
      return active.issuedWrite.permit;
    }
    if (this.disposed || active.writeDenied) {
      return null;
    }
    if (this.lanes.get(laneId) !== lane || lane.active !== active) {
      return null;
    }
    if (lane.epoch !== epoch || this.isExcluded(lane.identity)) {
      return null;
    }

    const issuedWrite = this.createIssuedWrite(lane, active);
    active.issuedWrite = issuedWrite;
    lane.issuedWrites.add(issuedWrite);
    return issuedWrite.permit;
  }

  private createIssuedWrite(
    lane: SaveLane<TResult>,
    active: ActiveSave,
  ): IssuedWrite {
    let issuedWrite!: IssuedWrite;
    const permit: DocumentSaveWritePermit = {
      granted: true,
      settle: () => this.settleIssuedWrite(lane, active, issuedWrite),
    };
    issuedWrite = {
      barrier: saveBarrier(),
      permit,
      settled: false,
    };
    return issuedWrite;
  }

  private settleIssuedWrite(
    lane: SaveLane<TResult>,
    active: ActiveSave,
    issuedWrite: IssuedWrite,
  ): void {
    if (issuedWrite.settled) {
      return;
    }

    issuedWrite.settled = true;
    if (active.issuedWrite === issuedWrite) {
      active.issuedWrite = null;
      active.writeDenied = true;
    }
    lane.issuedWrites.delete(issuedWrite);
    issuedWrite.barrier.resolve();
  }

  private async drain(
    laneId: string,
    lane: SaveLane<TResult>,
  ): Promise<void> {
    while (lane.pending) {
      const pending = lane.pending;
      lane.pending = null;
      const active: ActiveSave = {
        issuedWrite: null,
        operation: null,
        operationBarrier: saveBarrier(),
        sequence: pending.sequence,
        writeDenied: false,
      };
      lane.active = active;

      try {
        const promise = pending.operation(
          this.createLease(laneId, lane, pending.epoch, active),
        );
        active.operation = promise;
        const result = await promise;
        this.recordResult(lane, pending, result);
      } catch (error) {
        this.recordFailure(lane, pending, error);
      } finally {
        if (active.issuedWrite) {
          this.settleIssuedWrite(lane, active, active.issuedWrite);
        }
        active.operationBarrier.resolve();
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

function saveBarrier(): SaveBarrier {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function documentSaveKeyId(identity: DocumentSaveIdentity): string {
  return JSON.stringify([
    identity.canonicalRoot,
    ...documentSaveIdentitySegments(identity),
  ]);
}

function matchesInvalidationScope(
  identity: DocumentSaveIdentity,
  scope: CanonicalDocumentSaveInvalidationScope,
): boolean {
  if (identity.canonicalRoot !== scope.canonicalRoot) {
    return false;
  }
  if (scope.kind === "workspace") {
    return true;
  }
  if (scope.kind === "file") {
    return identity.workspaceRelativePath === scope.workspaceRelativePath;
  }

  return isDirectoryOrDescendant(
    documentSaveIdentitySegments(scope),
    documentSaveIdentitySegments(identity),
  );
}

function isDirectoryOrDescendant(
  directory: readonly string[],
  path: readonly string[],
): boolean {
  if (path.length < directory.length) {
    return false;
  }

  for (let index = 0; index < directory.length; index += 1) {
    if (directory[index] !== path[index]) {
      return false;
    }
  }

  return true;
}

function resolveDocumentSaveIdentity(
  key: DocumentSaveKey,
): DocumentSaveIdentity | null {
  if ("canonicalRoot" in key) {
    return createDocumentSaveIdentity(
      key.canonicalRoot,
      key.workspaceRelativePath,
    );
  }

  return legacyDocumentSaveIdentity(key.rootPath, key.path);
}

function resolveInvalidationScope(
  scope: DocumentSaveInvalidationScope,
): CanonicalDocumentSaveInvalidationScope | null {
  if (scope.kind === "workspace") {
    const canonicalRoot =
      "canonicalRoot" in scope && scope.canonicalRoot !== undefined
        ? scope.canonicalRoot
        : scope.rootPath;
    const sentinel = createDocumentSaveIdentity(canonicalRoot, ".scope");
    return sentinel
      ? Object.freeze({ kind: "workspace", canonicalRoot: sentinel.canonicalRoot })
      : null;
  }

  const identity = resolveDocumentSaveIdentity(scope);
  return identity ? Object.freeze({ kind: scope.kind, ...identity }) : null;
}
