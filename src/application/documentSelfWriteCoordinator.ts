import type { WorkspaceFileRevision, WorkspaceTextFileSnapshot } from "../domain/workspace";
import { boundedUtf8Length } from "../domain/incrementalDocumentSync";
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
  readonly contentUtf8Bytes: number;
  readonly content: string;
  readonly owner: PendingSelfWriteOwner;
  readonly settled: Promise<DocumentSelfWriteExpectation | null>;
  readonly settle: (expectation: DocumentSelfWriteExpectation | null) => void;
  readonly token: object;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  completed: boolean;
}

type PendingSelfWriteOwner =
  | {
      readonly canonicalRoot: string;
      readonly kind: "legacy";
    }
  | {
      readonly canonicalRoot: string;
      readonly kind: "registered";
      readonly workspaceId: string;
    };

export const DOCUMENT_SELF_WRITE_SETTLEMENT_TIMEOUT_MS = 5_000;
export const DOCUMENT_SELF_WRITE_MAX_PENDING_KEYS = 256;
export const DOCUMENT_SELF_WRITE_MAX_PENDING_WRITES_PER_KEY = 32;
export const DOCUMENT_SELF_WRITE_MAX_PENDING_UTF8_BYTES_PER_KEY = 32 * 1024 * 1024;
export const DOCUMENT_SELF_WRITE_MAX_PENDING_UTF8_BYTES_TOTAL = 128 * 1024 * 1024;
export const DOCUMENT_SELF_WRITE_MAX_IDENTITY_UTF8_BYTES_PER_KEY = 4 * 1024;
export const DOCUMENT_SELF_WRITE_MAX_IDENTITY_UTF8_BYTES_TOTAL = 1024 * 1024;

export interface DocumentSelfWriteCoordinatorOptions {
  readonly maxIdentityBytesPerKey?: number;
  readonly maxIdentityBytesTotal?: number;
  readonly maxPendingBytesPerKey?: number;
  readonly maxPendingBytesTotal?: number;
  readonly maxPendingKeys?: number;
  readonly maxPendingWritesPerKey?: number;
  readonly settlementTimeoutMs?: number;
}

/**
 * Coordinates filesystem watcher events with writes issued by the editor.
 * Entries are owner-scoped, generation-fenced, and consumed in issue order.
 */
export class DocumentSelfWriteCoordinator {
  private readonly writes = new Map<string, PendingSelfWrite[]>();
  private readonly identityUtf8BytesByKey = new Map<string, number>();
  private readonly limits: Required<DocumentSelfWriteCoordinatorOptions>;
  private pendingIdentityUtf8Bytes = 0;
  private pendingUtf8Bytes = 0;

  constructor(options: DocumentSelfWriteCoordinatorOptions = {}) {
    this.limits = {
      maxIdentityBytesPerKey: positiveLimit(
        options.maxIdentityBytesPerKey,
        DOCUMENT_SELF_WRITE_MAX_IDENTITY_UTF8_BYTES_PER_KEY,
      ),
      maxIdentityBytesTotal: positiveLimit(
        options.maxIdentityBytesTotal,
        DOCUMENT_SELF_WRITE_MAX_IDENTITY_UTF8_BYTES_TOTAL,
      ),
      maxPendingBytesPerKey: positiveLimit(
        options.maxPendingBytesPerKey,
        DOCUMENT_SELF_WRITE_MAX_PENDING_UTF8_BYTES_PER_KEY,
      ),
      maxPendingBytesTotal: positiveLimit(
        options.maxPendingBytesTotal,
        DOCUMENT_SELF_WRITE_MAX_PENDING_UTF8_BYTES_TOTAL,
      ),
      maxPendingKeys: positiveLimit(options.maxPendingKeys, DOCUMENT_SELF_WRITE_MAX_PENDING_KEYS),
      maxPendingWritesPerKey: positiveLimit(
        options.maxPendingWritesPerKey,
        DOCUMENT_SELF_WRITE_MAX_PENDING_WRITES_PER_KEY,
      ),
      settlementTimeoutMs: positiveLimit(
        options.settlementTimeoutMs,
        DOCUMENT_SELF_WRITE_SETTLEMENT_TIMEOUT_MS,
      ),
    };
  }

  begin(ownership: DocumentSaveOwnership, content: string): DocumentSelfWriteLease | null {
    if (ownershipIdentityUtf8Bytes(ownership, this.limits.maxIdentityBytesPerKey) === null) {
      return null;
    }
    const key = documentSaveOwnershipKey(ownership);
    if (!key) {
      return null;
    }
    const identityReceipt = boundedUtf8Length(key, this.limits.maxIdentityBytesPerKey);
    if (
      identityReceipt.status !== "within-limit" ||
      (!this.writes.has(key) &&
        this.pendingIdentityUtf8Bytes + identityReceipt.bytes > this.limits.maxIdentityBytesTotal)
    ) {
      return null;
    }

    const owner = pendingSelfWriteOwner(ownership, key);
    const queue = this.writes.get(key) ?? [];
    if (
      queue.length >= this.limits.maxPendingWritesPerKey ||
      (!this.writes.has(key) && this.writes.size >= this.limits.maxPendingKeys)
    ) {
      return null;
    }
    const keyBytes = queue.reduce((total, write) => total + write.contentUtf8Bytes, 0);
    const availableBytes = Math.min(
      this.limits.maxPendingBytesPerKey - keyBytes,
      this.limits.maxPendingBytesTotal - this.pendingUtf8Bytes,
    );
    const receipt = boundedUtf8Length(content, Math.max(0, availableBytes));
    if (receipt.status !== "within-limit") {
      return null;
    }

    let settle!: (expectation: DocumentSelfWriteExpectation | null) => void;
    const token = {};
    const write: PendingSelfWrite = {
      content,
      contentUtf8Bytes: receipt.bytes,
      completed: false,
      expiryTimer: null,
      owner,
      settled: new Promise((resolve) => {
        settle = resolve;
      }),
      settle: (expectation) => settle(expectation),
      token,
    };
    queue.push(write);
    this.writes.set(key, queue);
    if (!this.identityUtf8BytesByKey.has(key)) {
      this.identityUtf8BytesByKey.set(key, identityReceipt.bytes);
      this.pendingIdentityUtf8Bytes += identityReceipt.bytes;
    }
    this.pendingUtf8Bytes += receipt.bytes;
    write.expiryTimer = setTimeout(
      () => this.expireWrite(key, write),
      this.limits.settlementTimeoutMs,
    );

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

    const candidates = this.writes.get(key) ?? [];
    if (candidates.length === 0) {
      return null;
    }

    const timeoutMs = normalizeTimeout(options.timeoutMs);
    return waitForSettlements(
      candidates.map((write) => write.settled),
      options.signal,
      timeoutMs,
    ).then(
      (settled) =>
        settled?.filter(
          (expectation): expectation is DocumentSelfWriteExpectation => expectation !== null,
        ) ?? [],
    );
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
    if (snapshot.content !== expectation.content) {
      return false;
    }
    if (!revisionsMatchExactly(expectation.revision, snapshot.revision)) {
      return false;
    }

    const consumed = queue.splice(0, index + 1);
    for (const consumedWrite of consumed) {
      this.releaseWriteResources(consumedWrite);
    }
    this.settleAbandonedWrites(consumed, write);
    if (queue.length === 0) {
      this.deleteQueue(key);
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
    for (const [key, queue] of this.writes) {
      const matchingWrite = queue.find((write) =>
        workspaceRootKeysEqual(write.owner.canonicalRoot, rootPath),
      );
      if (matchingWrite) {
        this.cancelQueue(key);
      }
    }
  }

  dispose(): void {
    for (const key of [...this.writes.keys()]) {
      this.cancelQueue(key);
    }
    this.pendingUtf8Bytes = 0;
    this.pendingIdentityUtf8Bytes = 0;
    this.identityUtf8BytesByKey.clear();
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
    write.completed = true;
    write.settle({ content: write.content, revision, token: write.token });
    this.restartExpiryTimer(key, write);
  }

  private cancelQueue(key: string): void {
    const queue = this.writes.get(key);
    if (!queue) {
      return;
    }

    this.deleteQueue(key);
    for (const write of queue) {
      this.releaseWriteResources(write);
      if (write.completed) {
        continue;
      }
      write.completed = true;
      write.settle(null);
    }
  }

  private removeWrite(key: string, queue: PendingSelfWrite[], write: PendingSelfWrite): void {
    const index = queue.indexOf(write);
    if (index >= 0) {
      queue.splice(index, 1);
      this.releaseWriteResources(write);
    }
    if (queue.length === 0) {
      this.deleteQueue(key);
    }
  }

  private expireWrite(key: string, write: PendingSelfWrite): void {
    const queue = this.writes.get(key);
    if (!queue || !queue.includes(write)) {
      return;
    }
    if (!write.completed) {
      write.completed = true;
      write.settle(null);
    }
    this.removeWrite(key, queue, write);
  }

  private releaseWriteResources(write: PendingSelfWrite): void {
    if (write.expiryTimer === null) {
      return;
    }
    clearTimeout(write.expiryTimer);
    write.expiryTimer = null;
    this.pendingUtf8Bytes = Math.max(0, this.pendingUtf8Bytes - write.contentUtf8Bytes);
  }

  private restartExpiryTimer(key: string, write: PendingSelfWrite): void {
    if (write.expiryTimer !== null) {
      clearTimeout(write.expiryTimer);
    }
    write.expiryTimer = setTimeout(
      () => this.expireWrite(key, write),
      this.limits.settlementTimeoutMs,
    );
  }

  private deleteQueue(key: string): void {
    this.writes.delete(key);
    const identityBytes = this.identityUtf8BytesByKey.get(key);
    if (identityBytes === undefined) {
      return;
    }
    this.identityUtf8BytesByKey.delete(key);
    this.pendingIdentityUtf8Bytes = Math.max(0, this.pendingIdentityUtf8Bytes - identityBytes);
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
    return DOCUMENT_SELF_WRITE_SETTLEMENT_TIMEOUT_MS;
  }
  return Math.max(0, timeoutMs);
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0 ? value : fallback;
}

function ownershipIdentityUtf8Bytes(
  ownership: DocumentSaveOwnership,
  limit: number,
): number | null {
  const components =
    "canonicalRoot" in ownership
      ? [ownership.workspaceId, ownership.canonicalRoot, ownership.workspaceRelativePath]
      : [ownership.rootPath, ownership.path];
  let bytes = Math.max(0, components.length - 1);
  for (const component of components) {
    const receipt = boundedUtf8Length(component, limit - bytes);
    if (receipt.status !== "within-limit") {
      return null;
    }
    bytes += receipt.bytes;
  }
  return bytes;
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

function pendingSelfWriteOwner(
  ownership: DocumentSaveOwnership,
  key: string,
): PendingSelfWriteOwner {
  if ("canonicalRoot" in ownership) {
    return {
      canonicalRoot: ownership.canonicalRoot,
      kind: "registered",
      workspaceId: ownership.workspaceId,
    };
  }

  return {
    canonicalRoot: legacyOwnershipRootFromKey(key),
    kind: "legacy",
  };
}

function legacyOwnershipRootFromKey(key: string): string {
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
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedSeconds === right.modifiedSeconds &&
    left.modifiedNanoseconds === right.modifiedNanoseconds &&
    left.contentHash === right.contentHash
  );
}
