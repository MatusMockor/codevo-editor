import {
  DEFAULT_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS,
  liveDocumentSnapshotUtf16Limit,
  validateLiveDocumentSnapshotPurposeLimits,
  type LiveDocumentSnapshotPurpose,
  type LiveDocumentSnapshotPurposeLimits,
} from "../domain/liveDocumentSnapshot";
import {
  sameLiveDocumentAuthority,
  MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS,
  type LiveDocumentAuthority,
  type LiveModelDocumentContentState,
} from "../domain/liveDocumentContentAuthority";
import type {
  LiveContentReservation,
  LiveDocumentContentCoordinator,
} from "./liveDocumentContentCoordinator";
import type {
  LiveDocumentSnapshotReadExpectation,
  LiveDocumentSnapshotSourcePort,
  LiveDocumentSnapshotSourceProbe,
  LiveDocumentSnapshotSourceRead,
} from "./liveDocumentSnapshotSourcePort";

export interface LiveDocumentSnapshotBrokerLimits {
  readonly maxBatchSnapshots: number;
  readonly maxOutstandingSnapshots: number;
  readonly maxOutstandingUtf16Units: number;
  readonly maxRegisteredSources: number;
  readonly purpose: LiveDocumentSnapshotPurposeLimits;
}

export const DEFAULT_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS: LiveDocumentSnapshotBrokerLimits =
  Object.freeze({
    maxBatchSnapshots: 16,
    maxOutstandingSnapshots: 32,
    maxOutstandingUtf16Units: MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS,
    maxRegisteredSources: 32,
    purpose: DEFAULT_LIVE_DOCUMENT_SNAPSHOT_PURPOSE_LIMITS,
  });

export const HARD_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS = Object.freeze({
  maxBatchSnapshots: 16,
  maxOutstandingSnapshots: 64,
  maxOutstandingUtf16Units: 16 * 1024 * 1024,
  maxRegisteredSources: 64,
});

export interface LiveDocumentSnapshotSourceRegistration {
  readonly holderAuthority: object;
  readonly modelAuthority: object;
  readonly registrationAuthority: object;
  readonly reservationAuthority: object;
  readonly sourceAuthority: object;
}

export type RegisterLiveDocumentSnapshotSourceReceipt =
  | {
      readonly registration: LiveDocumentSnapshotSourceRegistration;
      readonly role: "joined" | "registered";
      readonly status: "registered";
    }
  | {
      readonly reason: "source-failed" | "source-limit" | "source-mismatch" | "stale";
      readonly status: "rejected";
    };

export interface LiveDocumentSnapshot {
  readonly alternativeVersionId: number;
  readonly authority: LiveDocumentAuthority;
  readonly content: string;
  readonly contentVersion: number;
  readonly modelAuthority: object;
  readonly modelVersionId: number;
  readonly purpose: LiveDocumentSnapshotPurpose;
  readonly reservationAuthority: object;
  readonly snapshotAuthority: object;
  readonly sourceAuthority: object;
  readonly utf16Length: number;
  readonly utf8BytesUpperBound: number;
}

export type CaptureLiveDocumentSnapshotReceipt =
  | {
      readonly snapshot: LiveDocumentSnapshot;
      readonly status: "captured";
    }
  | {
      readonly reason:
        | "aborted"
        | "aggregate-limit"
        | "capture-in-flight"
        | "document-too-large"
        | "not-live"
        | "outstanding-limit"
        | "source-failed"
        | "source-unavailable"
        | "stale";
      readonly status: "rejected";
    };

interface SourceRegistrationEntry {
  readonly registration: LiveDocumentSnapshotSourceRegistration;
  readonly reservation: LiveContentReservation;
}

interface SourceChannel {
  readonly holderRegistrations: Map<object, SourceRegistrationEntry>;
  readonly modelAuthority: object;
  readonly probe: () => LiveDocumentSnapshotSourceProbe;
  readonly readFullText: (
    expectation: LiveDocumentSnapshotReadExpectation,
  ) => LiveDocumentSnapshotSourceRead;
  readonly reservationAuthority: object;
  readonly source: LiveDocumentSnapshotSourcePort;
  readonly sourceAuthority: object;
}

interface SnapshotEntry {
  readonly payload: SnapshotPayload;
  readonly reservation: LiveContentReservation;
  readonly snapshot: LiveDocumentSnapshot;
  readonly sourceChannel: SourceChannel;
}

interface SnapshotPayload {
  readonly alternativeVersionId: number;
  readonly content: string;
  readonly contentVersion: number;
  readonly modelVersionId: number;
  readonly reservationAuthority: object;
  readonly snapshotAuthorities: Set<object>;
  readonly sourceChannel: SourceChannel;
  readonly utf16Length: number;
}

interface CaptureAdmission {
  active: boolean;
  readonly reservationAuthority: object;
  reservedUtf16Units: number;
  snapshotReserved: boolean;
  utf16Reserved: boolean;
}

interface SnapshotValidation {
  readonly entry: SnapshotEntry;
  readonly state: LiveModelDocumentContentState;
}

interface SourceDescriptor {
  readonly modelAuthority: object;
  readonly probe: () => LiveDocumentSnapshotSourceProbe;
  readonly readFullText: (
    expectation: LiveDocumentSnapshotReadExpectation,
  ) => LiveDocumentSnapshotSourceRead;
  readonly source: LiveDocumentSnapshotSourcePort;
  readonly sourceAuthority: object;
  readonly status: "available";
}

type SafeProbeResult =
  | LiveDocumentSnapshotSourceProbe
  | {
      readonly status: "failed";
    };

type CoordinatorSnapshotPort = Pick<LiveDocumentContentCoordinator, "inspect">;

export class LiveDocumentSnapshotBroker {
  private batchInProgress = false;
  private captureInProgress = false;
  private sourceSettlementInProgress = false;
  private readonly limits: LiveDocumentSnapshotBrokerLimits;
  private readonly inFlightReservations = new Set<object>();
  private outstandingUtf16Units = 0;
  private readonly payloads = new Map<object, SnapshotPayload>();
  private readonly snapshots = new Map<object, SnapshotEntry>();
  private readonly sources = new Map<object, SourceChannel>();
  private provisionalSnapshotCount = 0;
  private provisionalUtf16Units = 0;

  constructor(
    private readonly coordinator: CoordinatorSnapshotPort,
    limits: LiveDocumentSnapshotBrokerLimits = DEFAULT_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS,
  ) {
    validateBrokerLimits(limits);
    this.limits = Object.freeze({
      maxBatchSnapshots: limits.maxBatchSnapshots,
      maxOutstandingSnapshots: limits.maxOutstandingSnapshots,
      maxOutstandingUtf16Units: limits.maxOutstandingUtf16Units,
      maxRegisteredSources: limits.maxRegisteredSources,
      purpose: Object.freeze({ ...limits.purpose }),
    });
  }

  registerSource(
    reservation: LiveContentReservation,
    source: LiveDocumentSnapshotSourcePort,
  ): RegisterLiveDocumentSnapshotSourceReceipt {
    try {
      if (this.batchInProgress || this.sourceSettlementInProgress) {
        return rejectedRegistration("stale");
      }
      this.pruneStaleSourceChannels();
      const state = this.safeInspect(reservation);
      const channelBeforeDescriptor = this.sources.get(reservation.reservationAuthority) ?? null;
      if (!state) return rejectedRegistration("stale");
      const descriptor = sourceDescriptor(reservation, source);
      if (descriptor.status === "failed") return rejectedRegistration("source-failed");
      if (descriptor.status === "stale") return rejectedRegistration("stale");
      if (
        this.safeInspect(reservation) !== state ||
        (this.sources.get(reservation.reservationAuthority) ?? null) !== channelBeforeDescriptor
      ) {
        return rejectedRegistration("stale");
      }
      const existing = this.sources.get(reservation.reservationAuthority);
      if (existing) {
        if (!sameSourceDescriptor(existing, descriptor)) {
          return rejectedRegistration("source-mismatch");
        }
        const prior = existing.holderRegistrations.get(reservation.holderAuthority);
        if (prior) {
          return Object.freeze({
            registration: prior.registration,
            role: "joined",
            status: "registered",
          });
        }
        const registration = createSourceRegistration(reservation, descriptor);
        if (
          this.safeInspect(reservation) !== state ||
          this.sources.get(reservation.reservationAuthority) !== existing
        ) {
          return rejectedRegistration("stale");
        }
        existing.holderRegistrations.set(reservation.holderAuthority, {
          registration,
          reservation,
        });
        return Object.freeze({ registration, role: "joined", status: "registered" });
      }
      if (this.sources.size >= this.limits.maxRegisteredSources) {
        return rejectedRegistration("source-limit");
      }
      const registration = createSourceRegistration(reservation, descriptor);
      if (
        this.safeInspect(reservation) !== state ||
        this.sources.has(reservation.reservationAuthority)
      ) {
        return rejectedRegistration("stale");
      }
      this.sources.set(reservation.reservationAuthority, {
        holderRegistrations: new Map([
          [
            reservation.holderAuthority,
            {
              registration,
              reservation,
            },
          ],
        ]),
        modelAuthority: descriptor.modelAuthority,
        probe: descriptor.probe,
        readFullText: descriptor.readFullText,
        reservationAuthority: reservation.reservationAuthority,
        source: descriptor.source,
        sourceAuthority: descriptor.sourceAuthority,
      });
      return Object.freeze({ registration, role: "registered", status: "registered" });
    } catch {
      return rejectedRegistration("source-failed");
    }
  }

  releaseSource(registration: LiveDocumentSnapshotSourceRegistration): boolean {
    try {
      if (this.batchInProgress || this.sourceSettlementInProgress) return false;
      const channel = this.sources.get(registration.reservationAuthority);
      const entry = channel?.holderRegistrations.get(registration.holderAuthority);
      if (
        !channel ||
        !entry ||
        entry.registration !== registration ||
        entry.registration.registrationAuthority !== registration.registrationAuthority
      ) {
        return false;
      }
      channel.holderRegistrations.delete(registration.holderAuthority);
      for (const snapshot of [...this.snapshots.values()]) {
        if (
          snapshot.sourceChannel === channel &&
          snapshot.reservation.holderAuthority === registration.holderAuthority
        ) {
          this.removeSnapshot(snapshot);
        }
      }
      if (channel.holderRegistrations.size === 0) {
        this.removeSourceChannel(channel);
      }
      return true;
    } catch {
      return false;
    }
  }

  settleSourceRelease(
    registration: LiveDocumentSnapshotSourceRegistration,
    settle: () => boolean,
  ): boolean {
    let ownsSettlement = false;
    try {
      if (
        this.batchInProgress ||
        this.captureInProgress ||
        this.sourceSettlementInProgress ||
        typeof settle !== "function"
      ) {
        return false;
      }
      const channel = this.sources.get(registration.reservationAuthority);
      const entry = channel?.holderRegistrations.get(registration.holderAuthority);
      if (
        !channel ||
        !entry ||
        entry.registration !== registration ||
        entry.registration.registrationAuthority !== registration.registrationAuthority
      ) {
        return false;
      }

      this.sourceSettlementInProgress = true;
      ownsSettlement = true;
      let settled = false;
      try {
        settled = settle() === true;
      } catch {
        return false;
      }
      if (!settled) return false;

      channel.holderRegistrations.delete(registration.holderAuthority);
      for (const snapshot of [...this.snapshots.values()]) {
        if (
          snapshot.sourceChannel === channel &&
          snapshot.reservation.holderAuthority === registration.holderAuthority
        ) {
          this.removeSnapshot(snapshot);
        }
      }
      if (channel.holderRegistrations.size === 0) {
        this.removeSourceChannel(channel);
      }
      return true;
    } finally {
      if (ownsSettlement) this.sourceSettlementInProgress = false;
    }
  }

  capture(
    reservation: LiveContentReservation,
    purpose: LiveDocumentSnapshotPurpose,
    signal?: AbortSignal,
  ): CaptureLiveDocumentSnapshotReceipt {
    let admission: CaptureAdmission | null = null;
    try {
      if (this.batchInProgress || this.sourceSettlementInProgress) {
        return rejectedCapture("capture-in-flight");
      }
      if (signal?.aborted) return rejectedCapture("aborted");
      const admitted = this.prepareCaptureAdmission(reservation);
      if ("reason" in admitted) return rejectedCapture(admitted.reason);
      admission = admitted;
      this.pruneStaleSourceChannels();
      this.pruneCoordinatorStaleSnapshots();
      const maxUtf16Units = liveDocumentSnapshotUtf16Limit(purpose, this.limits.purpose);
      this.pruneStaleSnapshots();
      const snapshotReservationFailure = this.reserveCaptureSnapshot(admission);
      if (snapshotReservationFailure) return rejectedCapture(snapshotReservationFailure);
      const sourceChannel = this.exactSourceChannelWithoutSourceGetters(reservation);
      const state = this.liveState(reservation);
      if (!sourceChannel) return rejectedCapture("stale");
      if (!state) return rejectedCapture(this.safeInspect(reservation) ? "not-live" : "stale");

      const beforeProbe = safeProbe(sourceChannel);
      if (signal?.aborted) return rejectedCapture("aborted");
      if (beforeProbe.status === "failed") return rejectedCapture("source-failed");
      if (beforeProbe.status === "unavailable") {
        return rejectedCapture("source-unavailable");
      }
      if (
        !probeMatchesState(beforeProbe, state) ||
        this.liveState(reservation) !== state ||
        this.exactSourceChannelWithoutSourceGetters(reservation) !== sourceChannel
      ) {
        return rejectedCapture("stale");
      }
      if (beforeProbe.utf16Length > maxUtf16Units) {
        return rejectedCapture("document-too-large");
      }
      const reusable = this.payloads.get(reservation.reservationAuthority);
      if (
        reusable &&
        payloadMatchesState(reusable, state, sourceChannel, beforeProbe) &&
        reusable.utf16Length <= maxUtf16Units
      ) {
        const reservationFailure = this.reserveCaptureUtf16(admission, 0);
        if (reservationFailure) return rejectedCapture(reservationFailure);
        const settlement = this.settleCaptureAdmission(admission, 0);
        if (settlement) return rejectedCapture(settlement);
        return this.retainPayloadSnapshot(reusable, reservation, purpose, state);
      }

      const reservationFailure = this.reserveCaptureUtf16(admission, beforeProbe.utf16Length);
      if (reservationFailure) return rejectedCapture(reservationFailure);
      const expectation = createExpectation(sourceChannel, beforeProbe, maxUtf16Units);
      const readResult = safeRead(sourceChannel, expectation);
      if (readResult.status === "failed") return rejectedCapture("source-failed");
      const read = readResult.read;
      if (signal?.aborted) return rejectedCapture("aborted");
      const afterProbe = safeProbe(sourceChannel);
      if (signal?.aborted) return rejectedCapture("aborted");
      if (afterProbe.status === "failed") return rejectedCapture("source-failed");
      const afterState = this.liveState(reservation);
      if (
        read.text.length !== beforeProbe.utf16Length ||
        read.utf16Length !== read.text.length ||
        read.utf16Length > maxUtf16Units ||
        read.modelVersionId !== beforeProbe.modelVersionId ||
        read.alternativeVersionId !== beforeProbe.alternativeVersionId ||
        read.modelAuthority !== sourceChannel.modelAuthority ||
        read.sourceAuthority !== sourceChannel.sourceAuthority ||
        afterProbe.status === "unavailable" ||
        !sameProbe(beforeProbe, afterProbe) ||
        afterState !== state ||
        this.exactSourceChannelWithoutSourceGetters(reservation) !== sourceChannel
      ) {
        return rejectedCapture("stale");
      }
      const settlement = this.settleCaptureAdmission(admission, read.text.length);
      if (settlement) return rejectedCapture(settlement);

      const payload = Object.freeze({
        alternativeVersionId: state.alternativeVersionId,
        content: read.text,
        contentVersion: state.contentVersion,
        modelVersionId: state.modelVersionId,
        reservationAuthority: reservation.reservationAuthority,
        snapshotAuthorities: new Set<object>(),
        sourceChannel,
        utf16Length: read.text.length,
      }) satisfies SnapshotPayload;
      this.payloads.set(reservation.reservationAuthority, payload);
      this.outstandingUtf16Units += payload.utf16Length;
      return this.retainPayloadSnapshot(payload, reservation, purpose, state);
    } catch {
      return rejectedCapture("source-failed");
    } finally {
      if (admission) this.releaseCaptureAdmission(admission);
    }
  }

  consumeCurrent(snapshot: LiveDocumentSnapshot): boolean {
    return this.consumeCurrentForReservation(null, snapshot);
  }

  consumeCurrentFor(reservation: LiveContentReservation, snapshot: LiveDocumentSnapshot): boolean {
    return this.consumeCurrentForReservation(reservation, snapshot);
  }

  private consumeCurrentForReservation(
    reservation: LiveContentReservation | null,
    snapshot: LiveDocumentSnapshot,
  ): boolean {
    try {
      if (this.batchInProgress || this.sourceSettlementInProgress) return false;
      const entry = this.exactSnapshot(snapshot);
      if (!entry || (reservation !== null && entry.reservation !== reservation)) return false;
      this.removeSnapshot(entry);
      return this.validateSnapshot(entry) !== null;
    } catch {
      return false;
    }
  }

  consumeCurrentBatch(snapshots: readonly LiveDocumentSnapshot[]): boolean {
    try {
      if (this.batchInProgress || this.sourceSettlementInProgress) return false;
      if (
        !Array.isArray(snapshots) ||
        snapshots.length === 0 ||
        snapshots.length > this.limits.maxBatchSnapshots
      ) {
        return false;
      }
      const entries = snapshots.map((snapshot) => this.exactSnapshot(snapshot));
      if (
        entries.some((entry) => !entry) ||
        new Set(entries.map((entry) => entry?.snapshot.snapshotAuthority)).size !== entries.length
      ) {
        return false;
      }
      const exactEntries = entries as SnapshotEntry[];
      const first = exactEntries[0]!;
      this.batchInProgress = true;
      try {
        if (
          exactEntries.some(
            (entry) =>
              entry.snapshot.authority.ownerKey !== first.snapshot.authority.ownerKey ||
              entry.snapshot.authority.ownerGeneration !==
                first.snapshot.authority.ownerGeneration ||
              entry.snapshot.authority.ownerIncarnation !==
                first.snapshot.authority.ownerIncarnation ||
              entry.snapshot.authority.canonicalRoot !== first.snapshot.authority.canonicalRoot,
          )
        ) {
          return false;
        }
        const validations = exactEntries.map((entry) => this.validateSnapshot(entry));
        if (validations.some((validation) => !validation)) return false;
        const exactValidations = validations as SnapshotValidation[];
        if (
          exactValidations.some(
            (validation) => !this.validationStillCurrentWithoutSourceCallbacks(validation),
          )
        ) {
          return false;
        }
        exactEntries.forEach((entry) => this.removeSnapshot(entry));
        return true;
      } finally {
        this.batchInProgress = false;
      }
    } catch {
      this.batchInProgress = false;
      return false;
    }
  }

  release(snapshot: LiveDocumentSnapshot): boolean {
    return this.releaseForReservation(null, snapshot);
  }

  releaseFor(reservation: LiveContentReservation, snapshot: LiveDocumentSnapshot): boolean {
    return this.releaseForReservation(reservation, snapshot);
  }

  private releaseForReservation(
    reservation: LiveContentReservation | null,
    snapshot: LiveDocumentSnapshot,
  ): boolean {
    try {
      if (this.batchInProgress || this.sourceSettlementInProgress) return false;
      const entry = this.exactSnapshot(snapshot);
      if (!entry || (reservation !== null && entry.reservation !== reservation)) return false;
      this.removeSnapshot(entry);
      return true;
    } catch {
      return false;
    }
  }

  registeredSourceCount(): number {
    return this.sources.size;
  }

  outstandingSnapshotCount(): number {
    return this.snapshots.size;
  }

  outstandingSnapshotUtf16Units(): number {
    return this.outstandingUtf16Units;
  }

  private exactSourceChannel(reservation: LiveContentReservation): SourceChannel | null {
    return this.exactSourceChannelWithoutSourceGetters(reservation);
  }

  private exactSourceChannelWithoutSourceGetters(
    reservation: LiveContentReservation,
  ): SourceChannel | null {
    const channel = this.sources.get(reservation.reservationAuthority);
    const holder = channel?.holderRegistrations.get(reservation.holderAuthority);
    return channel &&
      holder?.reservation === reservation &&
      holder.reservation.holderAuthority === reservation.holderAuthority &&
      sameLiveDocumentAuthority(holder.reservation.authority, reservation.authority)
      ? channel
      : null;
  }

  private liveState(reservation: LiveContentReservation): LiveModelDocumentContentState | null {
    const state = this.safeInspect(reservation);
    return state?.kind === "live-model" &&
      sameLiveDocumentAuthority(state.authority, reservation.authority)
      ? state
      : null;
  }

  private exactSnapshot(snapshot: LiveDocumentSnapshot): SnapshotEntry | null {
    const entry = this.snapshots.get(snapshot.snapshotAuthority);
    return entry?.snapshot === snapshot ? entry : null;
  }

  private exactSnapshotWithoutGetters(snapshotAuthority: object, expected: SnapshotEntry): boolean {
    return this.snapshots.get(snapshotAuthority) === expected;
  }

  private validateSnapshot(entry: SnapshotEntry): SnapshotValidation | null {
    const beforeState = this.liveState(entry.reservation);
    const beforeChannel = this.exactSourceChannel(entry.reservation);
    const probe = safeProbe(entry.sourceChannel);
    const afterState = this.liveState(entry.reservation);
    const afterChannel = this.exactSourceChannel(entry.reservation);
    return beforeChannel === entry.sourceChannel &&
      afterChannel === entry.sourceChannel &&
      beforeState !== null &&
      afterState === beforeState &&
      probe.status === "available" &&
      probe.alternativeVersionId === entry.snapshot.alternativeVersionId &&
      probe.modelVersionId === entry.snapshot.modelVersionId &&
      probe.utf16Length === entry.snapshot.utf16Length &&
      beforeState.alternativeVersionId === entry.snapshot.alternativeVersionId &&
      beforeState.contentVersion === entry.snapshot.contentVersion &&
      beforeState.modelVersionId === entry.snapshot.modelVersionId &&
      (beforeState.utf16Length === null || beforeState.utf16Length === entry.snapshot.utf16Length)
      ? { entry, state: beforeState }
      : null;
  }

  private validationStillCurrentWithoutSourceCallbacks(validation: SnapshotValidation): boolean {
    const { entry, state } = validation;
    return (
      this.exactSnapshotWithoutGetters(entry.snapshot.snapshotAuthority, entry) &&
      this.exactSourceChannelWithoutSourceGetters(entry.reservation) === entry.sourceChannel &&
      this.safeInspect(entry.reservation) === state
    );
  }

  private removeSnapshot(entry: SnapshotEntry): void {
    if (this.snapshots.get(entry.snapshot.snapshotAuthority) !== entry) return;
    this.snapshots.delete(entry.snapshot.snapshotAuthority);
    entry.payload.snapshotAuthorities.delete(entry.snapshot.snapshotAuthority);
    if (entry.payload.snapshotAuthorities.size === 0) {
      if (this.payloads.get(entry.payload.reservationAuthority) === entry.payload) {
        this.payloads.delete(entry.payload.reservationAuthority);
      }
      this.outstandingUtf16Units -= entry.payload.utf16Length;
    }
  }

  private removeSourceChannel(channel: SourceChannel): void {
    if (this.sources.get(channel.reservationAuthority) !== channel) return;
    this.sources.delete(channel.reservationAuthority);
    for (const entry of [...this.snapshots.values()]) {
      if (entry.sourceChannel === channel) this.removeSnapshot(entry);
    }
  }

  private retainPayloadSnapshot(
    payload: SnapshotPayload,
    reservation: LiveContentReservation,
    purpose: LiveDocumentSnapshotPurpose,
    state: LiveModelDocumentContentState,
  ): CaptureLiveDocumentSnapshotReceipt {
    const snapshot = Object.freeze({
      alternativeVersionId: payload.alternativeVersionId,
      authority: state.authority,
      content: payload.content,
      contentVersion: payload.contentVersion,
      modelAuthority: payload.sourceChannel.modelAuthority,
      modelVersionId: payload.modelVersionId,
      purpose,
      reservationAuthority: reservation.reservationAuthority,
      snapshotAuthority: Object.freeze({}),
      sourceAuthority: payload.sourceChannel.sourceAuthority,
      utf16Length: payload.utf16Length,
      utf8BytesUpperBound: payload.utf16Length * 3,
    }) satisfies LiveDocumentSnapshot;
    payload.snapshotAuthorities.add(snapshot.snapshotAuthority);
    this.snapshots.set(snapshot.snapshotAuthority, {
      payload,
      reservation,
      snapshot,
      sourceChannel: payload.sourceChannel,
    });
    return Object.freeze({ snapshot, status: "captured" });
  }

  private pruneStaleSnapshots(): void {
    const entries = [...this.snapshots.values()];
    for (const entry of entries) {
      if (!this.validateSnapshot(entry)) this.removeSnapshot(entry);
    }
  }

  private pruneCoordinatorStaleSnapshots(): void {
    for (const entry of [...this.snapshots.values()]) {
      const state = this.liveState(entry.reservation);
      if (
        !state ||
        state.alternativeVersionId !== entry.snapshot.alternativeVersionId ||
        state.contentVersion !== entry.snapshot.contentVersion ||
        state.modelVersionId !== entry.snapshot.modelVersionId ||
        (state.utf16Length !== null && state.utf16Length !== entry.snapshot.utf16Length)
      ) {
        this.removeSnapshot(entry);
      }
    }
  }

  private pruneStaleSourceChannels(): void {
    for (const channel of [...this.sources.values()]) {
      const hasCurrentHolder = [...channel.holderRegistrations.values()].some(
        ({ reservation }) => this.safeInspect(reservation) !== null,
      );
      if (!hasCurrentHolder) this.removeSourceChannel(channel);
    }
  }

  private prepareCaptureAdmission(
    reservation: LiveContentReservation,
  ): CaptureAdmission | { readonly reason: "capture-in-flight" } {
    const reservationAuthority = reservation.reservationAuthority;
    if (this.captureInProgress || this.inFlightReservations.has(reservationAuthority)) {
      return Object.freeze({ reason: "capture-in-flight" });
    }
    const admission: CaptureAdmission = {
      active: true,
      reservationAuthority,
      reservedUtf16Units: 0,
      snapshotReserved: false,
      utf16Reserved: false,
    };
    this.captureInProgress = true;
    this.inFlightReservations.add(reservationAuthority);
    return admission;
  }

  private reserveCaptureSnapshot(admission: CaptureAdmission): "outstanding-limit" | null {
    if (!admission.active || admission.snapshotReserved) return "outstanding-limit";
    if (
      this.snapshots.size + this.provisionalSnapshotCount >=
      this.limits.maxOutstandingSnapshots
    ) {
      return "outstanding-limit";
    }
    admission.snapshotReserved = true;
    this.provisionalSnapshotCount += 1;
    return null;
  }

  private reserveCaptureUtf16(
    admission: CaptureAdmission,
    exactAdditionalUtf16Units: number,
  ): "aggregate-limit" | "outstanding-limit" | null {
    if (!admission.active || admission.utf16Reserved) return "outstanding-limit";
    if (
      this.outstandingUtf16Units + this.provisionalUtf16Units + exactAdditionalUtf16Units >
      this.limits.maxOutstandingUtf16Units
    ) {
      return "aggregate-limit";
    }
    admission.reservedUtf16Units = exactAdditionalUtf16Units;
    admission.utf16Reserved = true;
    this.provisionalUtf16Units += exactAdditionalUtf16Units;
    return null;
  }

  private settleCaptureAdmission(
    admission: CaptureAdmission,
    actualUtf16Units: number,
  ): "aggregate-limit" | "outstanding-limit" | null {
    if (!admission.active || !admission.snapshotReserved || !admission.utf16Reserved) {
      return "outstanding-limit";
    }
    const otherProvisionalSnapshots = this.provisionalSnapshotCount - 1;
    const otherProvisionalUtf16Units = this.provisionalUtf16Units - admission.reservedUtf16Units;
    if (this.snapshots.size + otherProvisionalSnapshots >= this.limits.maxOutstandingSnapshots) {
      return "outstanding-limit";
    }
    if (
      this.outstandingUtf16Units + otherProvisionalUtf16Units + actualUtf16Units >
      this.limits.maxOutstandingUtf16Units
    ) {
      return "aggregate-limit";
    }
    this.releaseCaptureAdmission(admission);
    return null;
  }

  private releaseCaptureAdmission(admission: CaptureAdmission): void {
    if (!admission.active) return;
    admission.active = false;
    if (admission.snapshotReserved) this.provisionalSnapshotCount -= 1;
    if (admission.utf16Reserved) {
      this.provisionalUtf16Units -= admission.reservedUtf16Units;
    }
    this.inFlightReservations.delete(admission.reservationAuthority);
    this.captureInProgress = false;
  }

  private safeInspect(reservation: LiveContentReservation) {
    try {
      return this.coordinator.inspect(reservation);
    } catch {
      return null;
    }
  }
}

function createSourceRegistration(
  reservation: LiveContentReservation,
  source: SourceDescriptor,
): LiveDocumentSnapshotSourceRegistration {
  return Object.freeze({
    holderAuthority: reservation.holderAuthority,
    modelAuthority: source.modelAuthority,
    registrationAuthority: Object.freeze({}),
    reservationAuthority: reservation.reservationAuthority,
    sourceAuthority: source.sourceAuthority,
  });
}

function createExpectation(
  channel: SourceChannel,
  probe: Extract<LiveDocumentSnapshotSourceProbe, { readonly status: "available" }>,
  maxUtf16Units: number,
): LiveDocumentSnapshotReadExpectation {
  return Object.freeze({
    alternativeVersionId: probe.alternativeVersionId,
    maxUtf16Units,
    modelAuthority: channel.modelAuthority,
    modelVersionId: probe.modelVersionId,
    sourceAuthority: channel.sourceAuthority,
    utf16Length: probe.utf16Length,
  });
}

function sourceDescriptor(
  reservation: LiveContentReservation,
  source: LiveDocumentSnapshotSourcePort,
):
  | SourceDescriptor
  | { readonly status: "failed" }
  | {
      readonly status: "stale";
    } {
  try {
    if (!isObjectIdentity(source)) return Object.freeze({ status: "stale" });
    const sourceAuthority = source.sourceAuthority;
    const modelAuthority = source.modelAuthority;
    const probe = source.probe;
    const readFullText = source.readFullText;
    if (
      !isObjectIdentity(sourceAuthority) ||
      !isObjectIdentity(modelAuthority) ||
      modelAuthority !== reservation.authority.modelIncarnation ||
      typeof probe !== "function" ||
      typeof readFullText !== "function"
    ) {
      return Object.freeze({ status: "stale" });
    }
    return Object.freeze({
      modelAuthority,
      probe: probe.bind(source),
      readFullText: readFullText.bind(source),
      source,
      sourceAuthority,
      status: "available",
    });
  } catch {
    return Object.freeze({ status: "failed" });
  }
}

function sameSourceDescriptor(channel: SourceChannel, descriptor: SourceDescriptor): boolean {
  return (
    channel.source === descriptor.source &&
    channel.sourceAuthority === descriptor.sourceAuthority &&
    channel.modelAuthority === descriptor.modelAuthority
  );
}

function safeProbe(channel: SourceChannel): SafeProbeResult {
  try {
    return copyProbe(channel.probe());
  } catch {
    return FAILED_PROBE;
  }
}

function copyProbe(probe: unknown): SafeProbeResult {
  try {
    if (!probe || typeof probe !== "object" || Array.isArray(probe)) return FAILED_PROBE;
    const status = (probe as { readonly status?: unknown }).status;
    if (status === "unavailable") {
      return exactKeys(probe, ["status"]) ? UNAVAILABLE_PROBE : FAILED_PROBE;
    }
    if (
      status !== "available" ||
      !exactKeys(probe, ["alternativeVersionId", "modelVersionId", "status", "utf16Length"])
    ) {
      return FAILED_PROBE;
    }
    const candidate = probe as Extract<
      LiveDocumentSnapshotSourceProbe,
      { readonly status: "available" }
    >;
    const alternativeVersionId = candidate.alternativeVersionId;
    const modelVersionId = candidate.modelVersionId;
    const utf16Length = candidate.utf16Length;
    return positive(alternativeVersionId) && positive(modelVersionId) && nonNegative(utf16Length)
      ? Object.freeze({
          alternativeVersionId,
          modelVersionId,
          status: "available",
          utf16Length,
        })
      : FAILED_PROBE;
  } catch {
    return FAILED_PROBE;
  }
}

function safeRead(
  channel: SourceChannel,
  expectation: LiveDocumentSnapshotReadExpectation,
):
  | { readonly read: LiveDocumentSnapshotSourceRead; readonly status: "available" }
  | {
      readonly status: "failed";
    } {
  try {
    const read = channel.readFullText(expectation);
    if (
      !read ||
      typeof read !== "object" ||
      Array.isArray(read) ||
      !exactKeys(read, [
        "alternativeVersionId",
        "modelAuthority",
        "modelVersionId",
        "sourceAuthority",
        "text",
        "utf16Length",
      ])
    ) {
      return FAILED_READ;
    }
    const alternativeVersionId = read.alternativeVersionId;
    const modelAuthority = read.modelAuthority;
    const modelVersionId = read.modelVersionId;
    const sourceAuthority = read.sourceAuthority;
    const text = read.text;
    const utf16Length = read.utf16Length;
    if (
      !positive(alternativeVersionId) ||
      !isObjectIdentity(modelAuthority) ||
      !positive(modelVersionId) ||
      !isObjectIdentity(sourceAuthority) ||
      typeof text !== "string" ||
      !nonNegative(utf16Length)
    ) {
      return FAILED_READ;
    }
    return Object.freeze({
      read: Object.freeze({
        alternativeVersionId,
        modelAuthority,
        modelVersionId,
        sourceAuthority,
        text,
        utf16Length,
      }),
      status: "available",
    });
  } catch {
    return FAILED_READ;
  }
}

function payloadMatchesState(
  payload: SnapshotPayload,
  state: LiveModelDocumentContentState,
  channel: SourceChannel,
  probe: Extract<LiveDocumentSnapshotSourceProbe, { readonly status: "available" }>,
): boolean {
  return (
    payload.sourceChannel === channel &&
    payload.alternativeVersionId === state.alternativeVersionId &&
    payload.contentVersion === state.contentVersion &&
    payload.modelVersionId === state.modelVersionId &&
    payload.utf16Length === probe.utf16Length &&
    probeMatchesState(probe, state)
  );
}

function probeMatchesState(
  probe: Extract<LiveDocumentSnapshotSourceProbe, { readonly status: "available" }>,
  state: LiveModelDocumentContentState,
): boolean {
  return (
    probe.alternativeVersionId === state.alternativeVersionId &&
    probe.modelVersionId === state.modelVersionId &&
    (state.utf16Length === null || probe.utf16Length === state.utf16Length)
  );
}

function sameProbe(
  left: Extract<LiveDocumentSnapshotSourceProbe, { readonly status: "available" }>,
  right: Extract<LiveDocumentSnapshotSourceProbe, { readonly status: "available" }>,
): boolean {
  return (
    left.alternativeVersionId === right.alternativeVersionId &&
    left.modelVersionId === right.modelVersionId &&
    left.utf16Length === right.utf16Length
  );
}

function validateBrokerLimits(limits: LiveDocumentSnapshotBrokerLimits): void {
  const keys = Object.keys(limits).sort();
  const expected = [
    "maxBatchSnapshots",
    "maxOutstandingSnapshots",
    "maxOutstandingUtf16Units",
    "maxRegisteredSources",
    "purpose",
  ];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError("Live document snapshot broker limits have an invalid shape");
  }
  requirePositive(limits.maxBatchSnapshots, "maxBatchSnapshots");
  requirePositive(limits.maxOutstandingSnapshots, "maxOutstandingSnapshots");
  requirePositive(limits.maxOutstandingUtf16Units, "maxOutstandingUtf16Units");
  requirePositive(limits.maxRegisteredSources, "maxRegisteredSources");
  if (
    limits.maxBatchSnapshots > HARD_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS.maxBatchSnapshots ||
    limits.maxBatchSnapshots > limits.maxOutstandingSnapshots
  ) {
    throw new TypeError("Live document snapshot batch limit exceeds its hard bound");
  }
  if (
    limits.maxOutstandingSnapshots >
      HARD_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS.maxOutstandingSnapshots ||
    limits.maxOutstandingUtf16Units >
      HARD_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS.maxOutstandingUtf16Units ||
    limits.maxRegisteredSources > HARD_LIVE_DOCUMENT_SNAPSHOT_BROKER_LIMITS.maxRegisteredSources
  ) {
    throw new TypeError("Live document snapshot broker limit exceeds its hard bound");
  }
  validateLiveDocumentSnapshotPurposeLimits(limits.purpose);
}

function rejectedRegistration(
  reason: Extract<
    RegisterLiveDocumentSnapshotSourceReceipt,
    { readonly status: "rejected" }
  >["reason"],
): RegisterLiveDocumentSnapshotSourceReceipt {
  return Object.freeze({ reason, status: "rejected" });
}

function rejectedCapture(
  reason: Extract<CaptureLiveDocumentSnapshotReceipt, { readonly status: "rejected" }>["reason"],
): CaptureLiveDocumentSnapshotReceipt {
  return Object.freeze({ reason, status: "rejected" });
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === "string" && expected.includes(key))
  );
}

function isObjectIdentity(value: unknown): value is object {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegative(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function requirePositive(value: number, name: string): void {
  if (!positive(value)) throw new TypeError(`${name} must be a positive integer`);
}

const UNAVAILABLE_PROBE = Object.freeze({
  status: "unavailable",
}) satisfies LiveDocumentSnapshotSourceProbe;
const FAILED_PROBE: { readonly status: "failed" } = Object.freeze({
  status: "failed",
});
const FAILED_READ: { readonly status: "failed" } = Object.freeze({
  status: "failed",
});
