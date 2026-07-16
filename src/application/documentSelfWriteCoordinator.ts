import type {
  WorkspaceFileRevision,
  WorkspaceTextFileSnapshot,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { DocumentSaveOwnership } from "./documentSaveIdentity";
import { documentSaveOwnershipKey } from "./documentSaveIdentity";

export interface DocumentSelfWriteExpectation {
  readonly content: string;
  readonly revision: WorkspaceFileRevision | null;
  readonly token: object;
}

export interface DocumentSelfWriteLease {
  abort(): void;
  complete(revision: WorkspaceFileRevision | null): void;
}

export interface DocumentSelfWriteWaitOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

interface PendingSelfWrite {
  readonly content: string;
  readonly generation: number;
  readonly settled: Promise<DocumentSelfWriteExpectation | null>;
  readonly settle: (expectation: DocumentSelfWriteExpectation | null) => void;
  readonly token: object;
  completed: boolean;
}

const DEFAULT_SETTLEMENT_TIMEOUT_MS = 2_000;

/**
 * Coordinates filesystem watcher events with writes issued by the editor.
 * Entries are owner-scoped, generation-fenced, and consumed in issue order.
 */
export class DocumentSelfWriteCoordinator {
  private readonly generations = new Map<string, number>();
  private readonly writes = new Map<string, PendingSelfWrite[]>();

  begin(
    ownership: DocumentSaveOwnership,
    content: string,
  ): DocumentSelfWriteLease | null {
    const key = documentSaveOwnershipKey(ownership);
    if (!key) {
      return null;
    }

    const root = ownershipRootFromKey(key);
    const generation = this.generationForRoot(root);
    let settle!: (expectation: DocumentSelfWriteExpectation | null) => void;
    const token = {};
    const write: PendingSelfWrite = {
      content,
      completed: false,
      generation,
      settled: new Promise((resolve) => {
        settle = resolve;
      }),
      settle: (expectation) => settle(expectation),
      token,
    };
    const queue = this.writes.get(key) ?? [];
    queue.push(write);
    this.writes.set(key, queue);

    return {
      abort: () => this.abortWrite(key, write),
      complete: (revision) => this.completeWrite(key, write, revision),
    };
  }

  expectationsForEvent(
    ownership: DocumentSaveOwnership,
    options: DocumentSelfWriteWaitOptions = {},
  ): Promise<readonly DocumentSelfWriteExpectation[]> | null {
    const key = documentSaveOwnershipKey(ownership);
    if (!key || options.signal?.aborted) {
      return null;
    }

    const generation = this.generationForRoot(ownershipRootFromKey(key));
    const candidates = (this.writes.get(key) ?? []).filter(
      (write) => write.generation === generation,
    );
    if (candidates.length === 0) {
      return null;
    }

    const timeoutMs = normalizeTimeout(options.timeoutMs);
    return waitForSettlements(
      candidates.map((write) => write.settled),
      options.signal,
      timeoutMs,
    ).then((settled) => settled?.filter(
      (expectation): expectation is DocumentSelfWriteExpectation =>
        expectation !== null,
    ) ?? []);
  }

  waitForExpectations(
    ownership: DocumentSaveOwnership,
    options: DocumentSelfWriteWaitOptions = {},
  ): Promise<readonly DocumentSelfWriteExpectation[]> {
    return this.expectationsForEvent(ownership, options) ?? Promise.resolve([]);
  }

  consumeMatchingSnapshot(
    ownership: DocumentSaveOwnership,
    expectation: DocumentSelfWriteExpectation,
    snapshot: WorkspaceTextFileSnapshot,
  ): boolean {
    const key = documentSaveOwnershipKey(ownership);
    if (!key) {
      return false;
    }

    const queue = this.writes.get(key);
    if (!queue) {
      return false;
    }
    const index = queue.findIndex((write) => write.token === expectation.token);
    if (index < 0) {
      return false;
    }
    const write = queue[index];
    if (
      write.generation !==
      this.generationForRoot(ownershipRootFromKey(key))
    ) {
      return false;
    }
    if (snapshot.content !== expectation.content) {
      return false;
    }
    if (!revisionsMatchExactly(expectation.revision, snapshot.revision)) {
      return false;
    }

    const consumed = queue.splice(0, index + 1);
    this.settleAbandonedWrites(consumed, write);
    if (queue.length === 0) {
      this.writes.delete(key);
    }
    return true;
  }

  clear(ownership: DocumentSaveOwnership): void {
    const key = documentSaveOwnershipKey(ownership);
    if (!key) {
      return;
    }

    this.cancelQueue(key);
  }

  clearRoot(rootPath: string): void {
    const matchingRoots = new Set<string>();
    for (const key of this.writes.keys()) {
      const root = ownershipRootFromKey(key);
      if (workspaceRootKeysEqual(root, rootPath)) {
        matchingRoots.add(root);
        this.cancelQueue(key);
      }
    }
    for (const root of this.generations.keys()) {
      if (workspaceRootKeysEqual(root, rootPath)) {
        matchingRoots.add(root);
      }
    }
    if (matchingRoots.size === 0) {
      matchingRoots.add(rootPath);
    }
    for (const root of matchingRoots) {
      this.generations.set(root, this.generationForRoot(root) + 1);
    }
  }

  dispose(): void {
    for (const key of [...this.writes.keys()]) {
      this.cancelQueue(key);
    }
    this.generations.clear();
  }

  private abortWrite(key: string, write: PendingSelfWrite): void {
    if (write.completed) {
      return;
    }
    const queue = this.writes.get(key);
    if (!queue || !queue.includes(write)) {
      return;
    }

    write.completed = true;
    write.settle(null);
    this.removeWrite(key, queue, write);
  }

  private completeWrite(
    key: string,
    write: PendingSelfWrite,
    revision: WorkspaceFileRevision | null,
  ): void {
    if (write.completed) {
      return;
    }
    const queue = this.writes.get(key);
    if (!queue || !queue.includes(write)) {
      return;
    }
    if (
      write.generation !==
      this.generationForRoot(ownershipRootFromKey(key))
    ) {
      this.abortWrite(key, write);
      return;
    }

    write.completed = true;
    write.settle({ content: write.content, revision, token: write.token });
  }

  private cancelQueue(key: string): void {
    const queue = this.writes.get(key);
    if (!queue) {
      return;
    }

    this.writes.delete(key);
    for (const write of queue) {
      if (write.completed) {
        continue;
      }
      write.completed = true;
      write.settle(null);
    }
  }

  private generationForRoot(root: string): number {
    return this.generations.get(root) ?? 0;
  }

  private removeWrite(
    key: string,
    queue: PendingSelfWrite[],
    write: PendingSelfWrite,
  ): void {
    const index = queue.indexOf(write);
    if (index >= 0) {
      queue.splice(index, 1);
    }
    if (queue.length === 0) {
      this.writes.delete(key);
    }
  }

  private settleAbandonedWrites(
    writes: readonly PendingSelfWrite[],
    matched: PendingSelfWrite,
  ): void {
    for (const write of writes) {
      if (write === matched || write.completed) {
        continue;
      }
      write.completed = true;
      write.settle(null);
    }
  }
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return DEFAULT_SETTLEMENT_TIMEOUT_MS;
  }
  return Math.max(0, timeoutMs);
}

async function waitForSettlements(
  settlements: readonly Promise<DocumentSelfWriteExpectation | null>[],
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<readonly (DocumentSelfWriteExpectation | null)[] | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let removeAbortListener: () => void = () => {};
  const cancelled = new Promise<null>((resolve) => {
    const finish = () => resolve(null);
    timeoutId = setTimeout(finish, timeoutMs);
    if (!signal) {
      return;
    }
    signal.addEventListener("abort", finish, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", finish);
  });

  try {
    return await Promise.race([Promise.all(settlements), cancelled]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    removeAbortListener();
  }
}

function ownershipRootFromKey(key: string): string {
  const separator = key.indexOf("\0");
  return separator < 0 ? key : key.slice(0, separator);
}

function revisionsMatchExactly(
  expected: WorkspaceFileRevision | null,
  actual: WorkspaceFileRevision | null,
): boolean {
  if (!expected || !actual) {
    return expected === actual;
  }
  return workspaceFileRevisionsEqual(expected, actual);
}

function workspaceFileRevisionsEqual(
  left: WorkspaceFileRevision,
  right: WorkspaceFileRevision,
): boolean {
  return left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedSeconds === right.modifiedSeconds &&
    left.modifiedNanoseconds === right.modifiedNanoseconds &&
    left.contentHash === right.contentHash;
}
