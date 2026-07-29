import {
  DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS,
  MAX_LANGUAGE_SERVER_DOCUMENT_VERSION,
  appendIncrementalDocumentEvent,
  boundedUtf8Length,
  createIncrementalDocumentBatch,
  fullEnvelope,
  incrementalEnvelope,
  validDocumentSyncPath,
  type IncrementalDocumentBatch,
  type IncrementalDocumentContentEvent,
  type IncrementalDocumentSyncLease,
  type IncrementalDocumentSyncLimits,
  type LanguageServerDocumentChangeEnvelope,
  type NegotiatedDocumentSyncCapability,
} from "../domain/incrementalDocumentSync";

interface PendingDocumentSync {
  readonly capability: NegotiatedDocumentSyncCapability;
  readonly lease: IncrementalDocumentSyncLease;
  head: IncrementalDocumentBatch;
  inFlight: PreparedFlush | null;
  lastCommittedServerVersion: number;
  preparing: object | null;
  retry: PreparedFlushPayload | null;
  revision: number;
  successor: IncrementalDocumentBatch | null;
}

interface PreparedFlushPayload {
  readonly envelope: LanguageServerDocumentChangeEnvelope;
  readonly fullTextReads: 0 | 1;
  readonly successorBase: {
    readonly alternativeVersionId: number;
    readonly utf16Length: number;
    readonly versionId: number;
  };
}

interface PreparedFlush extends PreparedFlushPayload {
  readonly transaction: IncrementalDocumentSyncFlushTransaction;
}

export interface DeferredDocumentSnapshotReader {
  getUtf16Length(): number;
  read(): string;
}

export type IncrementalDocumentSyncAdmission =
  | { readonly status: "admitted" }
  | {
      readonly reason: "invalid-admission" | "pending-document-limit";
      readonly status: "rejected";
    };

export type IncrementalDocumentSyncAppendReceipt =
  | {
      readonly changeCount: number;
      readonly fullTextReads: 0;
      readonly status: "accepted";
    }
  | {
      readonly fullTextReads: 0;
      readonly reason: string;
      readonly status: "snapshot-required";
    }
  | { readonly fullTextReads: 0; readonly status: "stale" };

export interface IncrementalDocumentSyncFlushTransaction {
  readonly id: string;
}

export type IncrementalDocumentSyncPrepareFlushReceipt =
  | {
      readonly envelope: LanguageServerDocumentChangeEnvelope;
      readonly fullTextReads: 0 | 1;
      readonly status: "prepared";
      readonly transaction: IncrementalDocumentSyncFlushTransaction;
    }
  | {
      readonly fullTextReads: 0 | 1;
      readonly reason: "invalid-envelope" | "non-monotonic-version" | "snapshot-limit";
      readonly status: "degraded";
    }
  | {
      readonly fullTextReads: 0 | 1;
      readonly status: "busy" | "empty" | "stale" | "unsupported";
    };

export type IncrementalDocumentSyncSettlementReceipt =
  | { readonly status: "committed" | "rolled-back" }
  | { readonly status: "stale" | "unknown-transaction" };

export class IncrementalDocumentSyncCoordinator {
  private readonly pending = new Map<string, PendingDocumentSync>();
  private readonly limits: IncrementalDocumentSyncLimits;
  private nextTransactionId = 1;

  constructor(limits: IncrementalDocumentSyncLimits = DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS) {
    this.limits = validateLimits(limits);
  }

  admit(
    lease: IncrementalDocumentSyncLease,
    capability: NegotiatedDocumentSyncCapability,
    base: {
      readonly alternativeVersionId: number;
      readonly utf16Length: number;
      readonly versionId: number;
    },
  ): IncrementalDocumentSyncAdmission {
    if (!validLease(lease) || !validBase(base) || !validCapability(capability)) {
      return { reason: "invalid-admission", status: "rejected" };
    }
    const key = channelKey(lease);
    const existing = this.pending.get(key);
    if (existing && leasesEqual(existing.lease, lease)) {
      return { status: "admitted" };
    }
    if (!this.pending.has(key) && this.pending.size >= this.limits.maxPendingDocuments) {
      return { reason: "pending-document-limit", status: "rejected" };
    }
    this.pending.set(key, {
      capability,
      head: createIncrementalDocumentBatch(
        base.versionId,
        base.alternativeVersionId,
        base.utf16Length,
      ),
      inFlight: null,
      lastCommittedServerVersion: 0,
      lease: copyLease(lease),
      preparing: null,
      retry: null,
      revision: 0,
      successor: null,
    });
    return { status: "admitted" };
  }

  append(
    lease: IncrementalDocumentSyncLease,
    event: IncrementalDocumentContentEvent,
  ): IncrementalDocumentSyncAppendReceipt {
    const pending = this.current(lease);
    if (!pending) return { fullTextReads: 0, status: "stale" };
    if (pending.capability.changeKind === "none") {
      return { fullTextReads: 0, status: "stale" };
    }
    const target = pending.successor ?? pending.head;
    const result = appendIncrementalDocumentEvent(target, event, this.limits);
    if (pending.successor) {
      pending.successor = result.batch;
    } else {
      pending.head = result.batch;
    }
    pending.revision += 1;
    if (result.status === "snapshot-required") {
      return {
        fullTextReads: 0,
        reason: result.reason,
        status: "snapshot-required",
      };
    }
    return {
      changeCount: result.batch.changeCount,
      fullTextReads: 0,
      status: "accepted",
    };
  }

  prepareFlush(
    lease: IncrementalDocumentSyncLease,
    serverVersion: number,
    snapshotReader: DeferredDocumentSnapshotReader,
  ): IncrementalDocumentSyncPrepareFlushReceipt {
    const pending = this.current(lease);
    if (!pending) return { fullTextReads: 0, status: "stale" };
    if (pending.inFlight || pending.preparing) return { fullTextReads: 0, status: "busy" };
    if (pending.capability.changeKind === "none") {
      return { fullTextReads: 0, status: "unsupported" };
    }
    if (
      !Number.isSafeInteger(serverVersion) ||
      serverVersion <= 0 ||
      serverVersion > MAX_LANGUAGE_SERVER_DOCUMENT_VERSION ||
      !validDocumentSyncPath(lease.path)
    ) {
      return { fullTextReads: 0, reason: "invalid-envelope", status: "degraded" };
    }
    if (pending.retry) {
      if (serverVersion !== pending.retry.envelope.version) {
        return {
          fullTextReads: 0,
          reason: "non-monotonic-version",
          status: "degraded",
        };
      }
      const reservation = Object.freeze({});
      pending.preparing = reservation;
      return this.preparePayload(pending, pending.retry, reservation);
    }
    if (pending.head.events.length === 0 && !pending.head.fallbackReason) {
      return { fullTextReads: 0, status: "empty" };
    }
    if (serverVersion <= pending.lastCommittedServerVersion) {
      return {
        fullTextReads: 0,
        reason: "non-monotonic-version",
        status: "degraded",
      };
    }

    const reservation = Object.freeze({});
    pending.preparing = reservation;

    if (pending.capability.changeKind === "incremental" && pending.head.fallbackReason === null) {
      const envelope = incrementalEnvelope(lease.path, serverVersion, pending.head);
      if (envelope) {
        return this.preparePayload(
          pending,
          {
            envelope,
            fullTextReads: 0,
            successorBase: batchBase(pending.head),
          },
          reservation,
        );
      }
    }

    const expectedPending = pending;
    const expectedBatch = pending.head;
    const expectedRevision = pending.revision;
    let snapshotLength: number;
    try {
      snapshotLength = snapshotReader.getUtf16Length();
    } catch (error) {
      this.cancelPreparation(pending, reservation);
      throw error;
    }
    if (
      this.current(lease) !== expectedPending ||
      expectedPending.preparing !== reservation ||
      expectedPending.head !== expectedBatch ||
      expectedPending.revision !== expectedRevision
    ) {
      this.cancelPreparation(pending, reservation);
      return { fullTextReads: 0, status: "stale" };
    }
    if (
      !Number.isSafeInteger(snapshotLength) ||
      snapshotLength < 0 ||
      snapshotLength > this.limits.maxFullSnapshotUtf16Units
    ) {
      this.cancelPreparation(pending, reservation);
      return { fullTextReads: 0, reason: "snapshot-limit", status: "degraded" };
    }
    let snapshot: string;
    try {
      snapshot = snapshotReader.read();
    } catch (error) {
      this.cancelPreparation(pending, reservation);
      throw error;
    }
    if (
      this.current(lease) !== expectedPending ||
      expectedPending.preparing !== reservation ||
      expectedPending.head !== expectedBatch ||
      expectedPending.revision !== expectedRevision
    ) {
      this.cancelPreparation(pending, reservation);
      return { fullTextReads: 1, status: "stale" };
    }
    if (
      snapshot.length !== snapshotLength ||
      snapshot.length > this.limits.maxFullSnapshotUtf16Units
    ) {
      this.cancelPreparation(pending, reservation);
      return { fullTextReads: 1, reason: "snapshot-limit", status: "degraded" };
    }
    const envelope = fullEnvelope(lease.path, serverVersion, snapshot);
    if (!envelope) {
      this.cancelPreparation(pending, reservation);
      return { fullTextReads: 1, reason: "invalid-envelope", status: "degraded" };
    }
    return this.preparePayload(
      pending,
      {
        envelope,
        fullTextReads: 1,
        successorBase: {
          alternativeVersionId: pending.head.finalAlternativeVersionId,
          utf16Length: snapshot.length,
          versionId: pending.head.finalVersionId,
        },
      },
      reservation,
    );
  }

  commitFlush(
    lease: IncrementalDocumentSyncLease,
    transaction: IncrementalDocumentSyncFlushTransaction,
  ): IncrementalDocumentSyncSettlementReceipt {
    const pending = this.current(lease);
    if (!pending) return { status: "stale" };
    const inFlight = pending.inFlight;
    if (!inFlight || inFlight.transaction !== transaction) {
      return { status: "unknown-transaction" };
    }
    pending.head =
      pending.successor ??
      createIncrementalDocumentBatch(
        pending.head.finalVersionId,
        pending.head.finalAlternativeVersionId,
        pending.head.currentUtf16Length,
      );
    pending.inFlight = null;
    pending.lastCommittedServerVersion = inFlight.envelope.version;
    pending.retry = null;
    pending.successor = null;
    pending.revision += 1;
    return { status: "committed" };
  }

  rollbackFlush(
    lease: IncrementalDocumentSyncLease,
    transaction: IncrementalDocumentSyncFlushTransaction,
  ): IncrementalDocumentSyncSettlementReceipt {
    const pending = this.current(lease);
    if (!pending) return { status: "stale" };
    const inFlight = pending.inFlight;
    if (!inFlight || inFlight.transaction !== transaction) {
      return { status: "unknown-transaction" };
    }
    pending.retry = Object.freeze({
      envelope: inFlight.envelope,
      fullTextReads: inFlight.fullTextReads,
      successorBase: inFlight.successorBase,
    });
    pending.inFlight = null;
    pending.revision += 1;
    return { status: "rolled-back" };
  }

  drop(lease: IncrementalDocumentSyncLease): boolean {
    const pending = this.current(lease);
    return pending ? this.pending.delete(channelKey(lease)) : false;
  }

  get pendingDocumentCount(): number {
    return this.pending.size;
  }

  private current(lease: IncrementalDocumentSyncLease): PendingDocumentSync | null {
    const pending = this.pending.get(channelKey(lease));
    return pending && leasesEqual(pending.lease, lease) ? pending : null;
  }

  private preparePayload(
    pending: PendingDocumentSync,
    payload: PreparedFlushPayload,
    reservation: object,
  ): IncrementalDocumentSyncPrepareFlushReceipt {
    if (pending.preparing !== reservation) {
      return { fullTextReads: payload.fullTextReads, status: "stale" };
    }
    const transaction = Object.freeze({
      id: `incremental-sync-${this.nextTransactionId}`,
    });
    this.nextTransactionId =
      this.nextTransactionId >= Number.MAX_SAFE_INTEGER ? 1 : this.nextTransactionId + 1;
    pending.inFlight = Object.freeze({ ...payload, transaction });
    pending.preparing = null;
    if (!pending.successor) {
      pending.successor = createIncrementalDocumentBatch(
        payload.successorBase.versionId,
        payload.successorBase.alternativeVersionId,
        payload.successorBase.utf16Length,
      );
    }
    return {
      envelope: payload.envelope,
      fullTextReads: payload.fullTextReads,
      status: "prepared",
      transaction,
    };
  }

  private cancelPreparation(pending: PendingDocumentSync, reservation: object): void {
    if (pending.preparing === reservation) pending.preparing = null;
  }
}

function channelKey(lease: IncrementalDocumentSyncLease): string {
  return `${lease.ownerKey}\0${lease.path}`;
}

function copyLease(lease: IncrementalDocumentSyncLease): IncrementalDocumentSyncLease {
  return Object.freeze({ ...lease });
}

function leasesEqual(
  left: IncrementalDocumentSyncLease,
  right: IncrementalDocumentSyncLease,
): boolean {
  return (
    left.documentIncarnation === right.documentIncarnation &&
    left.modelIncarnation === right.modelIncarnation &&
    left.ownerGeneration === right.ownerGeneration &&
    left.ownerIncarnation === right.ownerIncarnation &&
    left.ownerKey === right.ownerKey &&
    left.path === right.path
  );
}

function validLease(lease: IncrementalDocumentSyncLease): boolean {
  return (
    isRecord(lease) &&
    validToken(lease.documentIncarnation) &&
    validToken(lease.modelIncarnation) &&
    Number.isSafeInteger(lease.ownerGeneration) &&
    lease.ownerGeneration > 0 &&
    validToken(lease.ownerIncarnation) &&
    validToken(lease.ownerKey) &&
    validDocumentSyncPath(lease.path)
  );
}

function validBase(base: {
  readonly alternativeVersionId: number;
  readonly utf16Length: number;
  readonly versionId: number;
}): boolean {
  return (
    isRecord(base) &&
    Number.isSafeInteger(base.alternativeVersionId) &&
    base.alternativeVersionId > 0 &&
    Number.isSafeInteger(base.versionId) &&
    base.versionId > 0 &&
    base.versionId <= MAX_LANGUAGE_SERVER_DOCUMENT_VERSION &&
    Number.isSafeInteger(base.utf16Length) &&
    base.utf16Length >= 0
  );
}

function validToken(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4_096 &&
    boundedUtf8Length(value, 4_096).status === "within-limit" &&
    !value.includes("\0")
  );
}

function batchBase(batch: IncrementalDocumentBatch): {
  readonly alternativeVersionId: number;
  readonly utf16Length: number;
  readonly versionId: number;
} {
  return Object.freeze({
    alternativeVersionId: batch.finalAlternativeVersionId,
    utf16Length: batch.currentUtf16Length,
    versionId: batch.finalVersionId,
  });
}

function validateLimits(limits: IncrementalDocumentSyncLimits): IncrementalDocumentSyncLimits {
  const expectedKeys = Object.keys(DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS);
  if (
    Object.keys(limits).length !== expectedKeys.length ||
    expectedKeys.some((key) => {
      const value = limits[key as keyof IncrementalDocumentSyncLimits];
      return (
        !Object.prototype.hasOwnProperty.call(limits, key) ||
        !Number.isSafeInteger(value) ||
        value <= 0
      );
    })
  ) {
    throw new TypeError("Invalid incremental document sync limits.");
  }
  return Object.freeze({ ...limits });
}

function validCapability(capability: NegotiatedDocumentSyncCapability): boolean {
  if (
    !isRecord(capability) ||
    !["none", "full", "incremental"].includes(capability.changeKind) ||
    typeof capability.openClose !== "boolean" ||
    !isRecord(capability.save)
  ) {
    return false;
  }
  return capability.save.kind === "unsupported"
    ? Object.keys(capability.save).length === 1
    : capability.save.kind === "supported" && typeof capability.save.includeText === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
