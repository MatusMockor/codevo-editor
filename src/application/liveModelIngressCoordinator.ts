import {
  sameLiveDocumentAuthority,
  type LiveDocumentAuthority,
  type LiveDocumentContentChangeEvent,
  type LiveDocumentContentState,
} from "../domain/liveDocumentContentAuthority";
import type {
  LiveContentReservation,
  LiveContentSettlementPermit,
  LiveDocumentContentCoordinator,
  ReserveLiveContentReceipt,
} from "./liveDocumentContentCoordinator";
import type {
  CaptureLiveDocumentSnapshotReceipt,
  LiveDocumentSnapshot,
  LiveDocumentSnapshotSourceRegistration,
  LiveDocumentSnapshotBroker,
  RegisterLiveDocumentSnapshotSourceReceipt,
} from "./liveDocumentSnapshotBroker";
import type { LiveDocumentSnapshotPurpose } from "../domain/liveDocumentSnapshot";
import type { LiveDocumentSnapshotSourcePort } from "./liveDocumentSnapshotSourcePort";

export interface LiveModelIngressBase {
  readonly alternativeVersionId: number;
  readonly contentVersion: number;
  readonly modelVersionId: number;
  readonly utf16Length: number;
  readonly utf8Bytes: number;
}

export interface LiveModelIngressRegistration {
  readonly authority: LiveDocumentAuthority;
  readonly base: LiveModelIngressBase;
  readonly holderIdentity: object;
  readonly source: LiveDocumentSnapshotSourcePort;
}

export interface LiveModelRevision {
  readonly alternativeVersionId: number;
  readonly contentVersion: number;
  readonly mode: "incremental" | "retained" | "snapshot-required";
  readonly modelVersionId: number;
  readonly utf16Length: number | null;
}

export interface LiveModelSourceHandle {
  readonly channelAuthority: object;
  readonly handleAuthority: object;
  readonly modelAuthority: object;
  currentRevision(): LiveModelRevision | null;
  recordChange(event: LiveDocumentContentChangeEvent): RecordLiveModelIngressReceipt;
  release(): ReleaseLiveModelIngressReceipt;
}

export interface LiveModelIngressRecoveryHandle {
  readonly recoveryAuthority: object;
  currentRevision(): LiveModelRevision | null;
  discard(): boolean;
}

type LiveModelIngressSourceFailureReason = Extract<
  RegisterLiveDocumentSnapshotSourceReceipt,
  { readonly status: "rejected" }
>["reason"];

export type RegisterLiveModelIngressReceipt =
  | {
      readonly handle: LiveModelSourceHandle;
      readonly role: "existing" | "joined" | "registered";
      readonly status: "registered";
    }
  | {
      readonly reason:
        | Extract<ReserveLiveContentReceipt, { readonly status: "rejected" }>["reason"]
        | Extract<
            RegisterLiveDocumentSnapshotSourceReceipt,
            { readonly status: "rejected" }
          >["reason"];
      readonly status: "rejected";
    }
  | {
      readonly reason: LiveModelIngressSourceFailureReason;
      readonly recovery: LiveModelIngressRecoveryHandle;
      readonly status: "recovery-required";
    };

export type RecordLiveModelIngressReceipt =
  | {
      readonly revision: LiveModelRevision;
      readonly status: "committed";
    }
  | {
      readonly reason: "notification-backpressure";
      readonly status: "rejected";
    }
  | { readonly status: "stale" };

export type ReleaseLiveModelIngressReceipt =
  | {
      readonly status: "released";
    }
  | {
      readonly reason: "settlement-required";
      readonly status: "blocked";
    }
  | { readonly status: "stale" };

export interface LiveModelIngressRegistrationPort {
  register(input: LiveModelIngressRegistration): RegisterLiveModelIngressReceipt;
}

type ContentIngressPort = Pick<
  LiveDocumentContentCoordinator,
  | "commitSettlement"
  | "cancelLiveContent"
  | "inspect"
  | "prepareSettlement"
  | "recordLiveChange"
  | "releaseLiveContentHolder"
  | "requestDispose"
  | "reserveLiveContent"
> &
  Partial<Pick<LiveDocumentContentCoordinator, "cancelSettlement">>;

type SnapshotRegistrationPort = Pick<
  LiveDocumentSnapshotBroker,
  "registerSource" | "releaseSource"
> &
  Partial<Pick<LiveDocumentSnapshotBroker, "settleSourceRelease">>;

type SnapshotAccessPort = Pick<
  LiveDocumentSnapshotBroker,
  "capture" | "consumeCurrentFor" | "releaseFor"
>;

interface IngressEntry {
  readonly handle: LiveModelSourceHandle;
  readonly handleAuthority: object;
  readonly registration: LiveDocumentSnapshotSourceRegistration;
  readonly reservation: LiveContentReservation;
  readonly source: LiveDocumentSnapshotSourcePort;
}

interface RecoveryEntry {
  readonly permit: LiveContentSettlementPermit | null;
  readonly recovery: LiveModelIngressRecoveryHandle;
  readonly reservation: LiveContentReservation;
}

type RollbackReservationReceipt =
  | { readonly status: "cleaned" }
  | {
      readonly permit: LiveContentSettlementPermit | null;
      readonly status: "recovery-required";
    };

/**
 * Application-owned facade for the one canonical live-model change ingress.
 *
 * Framework code receives only an opaque handle. Coordinator leases and broker
 * registrations stay private, and a failed source registration is compensated
 * before admission is reported to the caller.
 */
export class LiveModelIngressCoordinator implements LiveModelIngressRegistrationPort {
  private readonly entries = new Map<object, IngressEntry>();
  private readonly recoveries = new Map<object, RecoveryEntry>();
  private readonly snapshotAccess: SnapshotAccessPort | null;

  constructor(
    private readonly content: ContentIngressPort,
    private readonly snapshots: SnapshotRegistrationPort,
    snapshotAccess: SnapshotAccessPort | null = null,
  ) {
    this.snapshotAccess = snapshotAccess;
  }

  register(input: LiveModelIngressRegistration): RegisterLiveModelIngressReceipt {
    this.pruneStaleEntries();
    this.pruneStaleRecoveries();
    const existing = this.exactExistingEntry(input);
    if (existing) {
      return existing.source === input.source
        ? Object.freeze({
            handle: existing.handle,
            role: "existing",
            status: "registered",
          })
        : REJECTED_SOURCE_MISMATCH;
    }

    const reserved = this.content.reserveLiveContent(
      input.authority,
      input.base,
      input.holderIdentity,
    );
    if (reserved.status === "rejected") {
      return Object.freeze({ reason: reserved.reason, status: "rejected" });
    }

    let registered: RegisterLiveDocumentSnapshotSourceReceipt;
    try {
      registered = this.snapshots.registerSource(reserved.lease, input.source);
    } catch {
      return this.sourceFailure(reserved.lease, "source-failed");
    }
    if (registered.status === "rejected") {
      return this.sourceFailure(reserved.lease, registered.reason);
    }

    const handleAuthority = Object.freeze({});
    const handle = this.createHandle(
      handleAuthority,
      reserved.lease,
      registered.registration.modelAuthority,
    );
    const entry = Object.freeze({
      handle,
      handleAuthority,
      registration: registered.registration,
      reservation: reserved.lease,
      source: input.source,
    }) satisfies IngressEntry;
    this.entries.set(handleAuthority, entry);
    return Object.freeze({
      handle,
      role: registered.role === "registered" ? "registered" : "joined",
      status: "registered",
    });
  }

  capture(
    handle: LiveModelSourceHandle,
    purpose: LiveDocumentSnapshotPurpose,
    signal?: AbortSignal,
  ): CaptureLiveDocumentSnapshotReceipt {
    const entry = this.entryForHandle(handle);
    return entry && this.snapshotAccess
      ? this.snapshotAccess.capture(entry.reservation, purpose, signal)
      : STALE_CAPTURE;
  }

  consumeCurrent(handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot): boolean {
    const entry = this.entryForHandle(handle);
    return (
      entry !== null && this.snapshotAccess?.consumeCurrentFor(entry.reservation, snapshot) === true
    );
  }

  releaseSnapshot(handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot): boolean {
    const entry = this.entryForHandle(handle);
    return entry !== null && this.snapshotAccess?.releaseFor(entry.reservation, snapshot) === true;
  }

  discard(handle: LiveModelSourceHandle): boolean {
    const entry = this.entryForHandle(handle);
    if (!entry) return false;

    const disposal = this.content.requestDispose(entry.reservation);
    if (disposal.status === "allowed" || disposal.reason === "holders-active") {
      return this.settleEntryRelease(entry);
    }
    if (disposal.reason === "stale") {
      this.entries.delete(entry.handleAuthority);
      this.safeReleaseSource(entry.registration);
      return false;
    }

    const prepared = this.content.prepareSettlement(entry.reservation, { kind: "discard" });
    if (prepared.status !== "prepared") return false;
    const settled = this.safeSettleSourceRelease(entry.registration, () =>
      this.content.commitSettlement(prepared.permit),
    );
    if (!settled) {
      this.content.cancelSettlement?.(prepared.permit);
      return false;
    }
    this.entries.delete(entry.handleAuthority);
    return true;
  }

  private createHandle(
    handleAuthority: object,
    reservation: LiveContentReservation,
    modelAuthority: object,
  ): LiveModelSourceHandle {
    return Object.freeze({
      channelAuthority: reservation.reservationAuthority,
      handleAuthority,
      modelAuthority,
      currentRevision: () => {
        const entry = this.exactEntry(handleAuthority, reservation);
        if (!entry) return null;
        return revisionFromState(this.content.inspect(reservation));
      },
      recordChange: (event: LiveDocumentContentChangeEvent) => {
        const entry = this.exactEntry(handleAuthority, reservation);
        if (!entry) return STALE_RECORD;
        const receipt = this.content.recordLiveChange(reservation, event);
        if (receipt.status === "stale") {
          if (this.content.inspect(reservation) === null) {
            this.entries.delete(handleAuthority);
          }
          return STALE_RECORD;
        }
        return Object.freeze({
          revision: revisionFromState(receipt.state)!,
          status: "committed",
        });
      },
      release: () => this.release(handleAuthority, reservation),
    });
  }

  private release(
    handleAuthority: object,
    reservation: LiveContentReservation,
  ): ReleaseLiveModelIngressReceipt {
    const entry = this.exactEntry(handleAuthority, reservation);
    if (!entry) return STALE_RELEASE;
    const disposal = this.content.requestDispose(reservation);
    if (disposal.status === "blocked" && disposal.reason === "settlement-required") {
      return BLOCKED_RELEASE;
    }
    if (disposal.status === "blocked" && disposal.reason === "stale") {
      this.entries.delete(handleAuthority);
      return STALE_RELEASE;
    }

    if (!this.settleEntryRelease(entry)) {
      return STALE_RELEASE;
    }
    return RELEASED;
  }

  private settleEntryRelease(entry: IngressEntry): boolean {
    const settled = this.safeSettleSourceRelease(
      entry.registration,
      () => this.content.releaseLiveContentHolder(entry.reservation).status === "released",
    );
    if (settled) this.entries.delete(entry.handleAuthority);
    return settled;
  }

  private exactEntry(
    handleAuthority: object,
    reservation: LiveContentReservation,
  ): IngressEntry | null {
    const entry = this.entries.get(handleAuthority);
    return entry?.reservation === reservation && this.content.inspect(reservation) !== null
      ? entry
      : null;
  }

  private entryForHandle(handle: LiveModelSourceHandle): IngressEntry | null {
    try {
      const entry = this.entries.get(handle.handleAuthority);
      return entry?.handle === handle && this.content.inspect(entry.reservation) !== null
        ? entry
        : null;
    } catch {
      return null;
    }
  }

  private exactExistingEntry(input: LiveModelIngressRegistration): IngressEntry | null {
    for (const entry of this.entries.values()) {
      if (
        entry.reservation.holderIdentity === input.holderIdentity &&
        sameLiveDocumentAuthority(entry.reservation.authority, input.authority)
      ) {
        return entry;
      }
    }
    return null;
  }

  private pruneStaleEntries(): void {
    for (const [authority, entry] of this.entries) {
      if (this.content.inspect(entry.reservation) !== null) continue;
      this.safeReleaseSource(entry.registration);
      this.entries.delete(authority);
    }
  }

  private pruneStaleRecoveries(): void {
    for (const [authority, entry] of this.recoveries) {
      if (this.content.inspect(entry.reservation) !== null) continue;
      this.recoveries.delete(authority);
    }
  }

  private sourceFailure(
    reservation: LiveContentReservation,
    reason: LiveModelIngressSourceFailureReason,
  ): RegisterLiveModelIngressReceipt {
    const rollback = this.rollbackReservation(reservation);
    if (rollback.status === "cleaned") {
      return Object.freeze({ reason, status: "rejected" });
    }
    const recoveryAuthority = Object.freeze({});
    const recovery = Object.freeze({
      currentRevision: () => {
        const entry = this.recoveries.get(recoveryAuthority);
        return entry?.reservation === reservation
          ? revisionFromState(this.content.inspect(reservation))
          : null;
      },
      discard: () => this.discardRecovery(recoveryAuthority, reservation),
      recoveryAuthority,
    }) satisfies LiveModelIngressRecoveryHandle;
    this.recoveries.set(
      recoveryAuthority,
      Object.freeze({
        permit: rollback.permit,
        recovery,
        reservation,
      }),
    );
    return Object.freeze({
      reason,
      recovery,
      status: "recovery-required",
    });
  }

  private rollbackReservation(reservation: LiveContentReservation): RollbackReservationReceipt {
    if (this.content.cancelLiveContent(reservation)) {
      return CLEANED_ROLLBACK;
    }
    if (this.content.releaseLiveContentHolder(reservation).status === "released") {
      return CLEANED_ROLLBACK;
    }
    const prepared = this.content.prepareSettlement(reservation, {
      kind: "discard",
    });
    if (prepared.status !== "prepared") {
      return RECOVERY_WITHOUT_PERMIT;
    }
    return this.content.commitSettlement(prepared.permit)
      ? CLEANED_ROLLBACK
      : Object.freeze({
          permit: prepared.permit,
          status: "recovery-required",
        });
  }

  private discardRecovery(recoveryAuthority: object, reservation: LiveContentReservation): boolean {
    const entry = this.recoveries.get(recoveryAuthority);
    if (!entry || entry.reservation !== reservation) {
      return false;
    }
    let permit = entry.permit;
    if (!permit) {
      const prepared = this.content.prepareSettlement(reservation, {
        kind: "discard",
      });
      if (prepared.status !== "prepared") {
        return false;
      }
      permit = prepared.permit;
    }
    if (!this.content.commitSettlement(permit)) {
      return false;
    }
    this.recoveries.delete(recoveryAuthority);
    return true;
  }

  private safeReleaseSource(registration: LiveDocumentSnapshotSourceRegistration): boolean {
    try {
      return this.snapshots.releaseSource(registration);
    } catch {
      return false;
    }
  }

  private safeSettleSourceRelease(
    registration: LiveDocumentSnapshotSourceRegistration,
    settle: () => boolean,
  ): boolean {
    try {
      return this.snapshots.settleSourceRelease?.(registration, settle) === true;
    } catch {
      return false;
    }
  }
}

function revisionFromState(state: LiveDocumentContentState | null): LiveModelRevision | null {
  if (!state) return null;
  return Object.freeze({
    alternativeVersionId: state.alternativeVersionId,
    contentVersion: state.contentVersion,
    mode:
      state.kind === "retained"
        ? "retained"
        : state.journal.kind === "incremental"
          ? "incremental"
          : "snapshot-required",
    modelVersionId: state.modelVersionId,
    utf16Length: state.utf16Length,
  });
}

const REJECTED_SOURCE_MISMATCH = Object.freeze({
  reason: "source-mismatch",
  status: "rejected",
}) satisfies RegisterLiveModelIngressReceipt;
const CLEANED_ROLLBACK = Object.freeze({
  status: "cleaned",
}) satisfies RollbackReservationReceipt;
const RECOVERY_WITHOUT_PERMIT = Object.freeze({
  permit: null,
  status: "recovery-required",
}) satisfies RollbackReservationReceipt;
const STALE_RECORD = Object.freeze({
  status: "stale",
}) satisfies RecordLiveModelIngressReceipt;
const RELEASED = Object.freeze({
  status: "released",
}) satisfies ReleaseLiveModelIngressReceipt;
const BLOCKED_RELEASE = Object.freeze({
  reason: "settlement-required",
  status: "blocked",
}) satisfies ReleaseLiveModelIngressReceipt;
const STALE_RELEASE = Object.freeze({
  status: "stale",
}) satisfies ReleaseLiveModelIngressReceipt;
const STALE_CAPTURE = Object.freeze({
  reason: "stale",
  status: "rejected",
}) satisfies CaptureLiveDocumentSnapshotReceipt;
