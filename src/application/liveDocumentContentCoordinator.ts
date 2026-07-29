import {
  createRetainedDocumentContentState,
  DEFAULT_LIVE_DOCUMENT_CONTENT_LIMITS,
  degradeObservedLiveDocumentMutation,
  recordLiveDocumentContentChange,
  sameLiveDocumentAuthority,
  validateLiveDocumentAuthority,
  validateLiveDocumentContentLimits,
  type LiveDocumentAuthority,
  type LiveDocumentContentChangeEvent,
  type LiveDocumentContentLimits,
  type LiveDocumentContentState,
  type LiveModelDocumentContentState,
  type RecordLiveDocumentChangeReceipt,
} from "../domain/liveDocumentContentAuthority";

export interface LiveDocumentContentCoordinatorLimits {
  readonly content: LiveDocumentContentLimits;
  readonly maxHoldersPerDocument: number;
  readonly maxLiveDocuments: number;
}

export const DEFAULT_LIVE_DOCUMENT_CONTENT_COORDINATOR_LIMITS: LiveDocumentContentCoordinatorLimits =
  Object.freeze({
    content: DEFAULT_LIVE_DOCUMENT_CONTENT_LIMITS,
    maxHoldersPerDocument: 8,
    maxLiveDocuments: 32,
  });

export interface LiveContentReservation {
  readonly authority: LiveDocumentAuthority;
  readonly holderAuthority: object;
  readonly holderIdentity: object;
  readonly reservationAuthority: object;
}

export type ReserveLiveContentReceipt =
  | {
      readonly lease: LiveContentReservation;
      readonly role: "ingress" | "joined";
      readonly state: LiveDocumentContentState;
      readonly status: "reserved";
    }
  | {
      readonly reason: "holder-limit" | "live-document-limit" | "settlement-required";
      readonly status: "rejected";
    };

export type RecordLiveContentReceipt =
  | {
      readonly mode: RecordLiveDocumentChangeReceipt["mode"];
      readonly observedWork: RecordLiveDocumentChangeReceipt["work"];
      readonly state: LiveModelDocumentContentState;
      readonly status: "committed";
    }
  | { readonly status: "stale" };

export interface LiveContentDiscard {
  readonly kind: "discard";
}

export interface LiveContentSettlementPermit {
  readonly permitAuthority: object;
  readonly reservationAuthority: object;
}

export type PrepareLiveContentSettlementReceipt =
  | {
      readonly permit: LiveContentSettlementPermit;
      readonly status: "prepared";
    }
  | {
      readonly reason: "already-prepared" | "holders-active" | "stale";
      readonly status: "rejected";
    };

export type ReleaseLiveContentHolderReceipt =
  | {
      readonly promotedIngress: LiveContentReservation | null;
      readonly status: "released";
    }
  | { readonly status: "blocked" | "stale" };

interface Channel {
  readonly authority: LiveDocumentAuthority;
  readonly holderLeases: Map<object, LiveContentReservation>;
  ingressHolderIdentity: object;
  readonly key: string;
  readonly reservationAuthority: object;
  settlement: LiveContentSettlementPermit | null;
  state: LiveDocumentContentState;
}

export class LiveDocumentContentCoordinator {
  private readonly channels = new Map<string, Channel>();
  private readonly limits: LiveDocumentContentCoordinatorLimits;

  constructor(
    limits: LiveDocumentContentCoordinatorLimits = DEFAULT_LIVE_DOCUMENT_CONTENT_COORDINATOR_LIMITS,
  ) {
    validateCoordinatorLimitsShape(limits);
    requirePositive(limits.maxHoldersPerDocument, "maxHoldersPerDocument");
    requirePositive(limits.maxLiveDocuments, "maxLiveDocuments");
    validateLiveDocumentContentLimits(limits.content);
    this.limits = Object.freeze({
      content: Object.freeze({ ...limits.content }),
      maxHoldersPerDocument: limits.maxHoldersPerDocument,
      maxLiveDocuments: limits.maxLiveDocuments,
    });
  }

  reserveLiveContent(
    authority: LiveDocumentAuthority,
    retained: {
      readonly alternativeVersionId: number;
      readonly contentVersion: number;
      readonly modelVersionId: number;
      readonly utf16Length: number;
      readonly utf8Bytes: number;
    },
    holderIdentity: object,
  ): ReserveLiveContentReceipt {
    validateLiveDocumentAuthority(authority);
    requireObjectIdentity(holderIdentity, "holderIdentity");
    const state = createRetainedDocumentContentState(retained);
    const key = channelKey(authority);
    const existing = this.channels.get(key);
    if (existing) {
      if (!sameLiveDocumentAuthority(existing.authority, authority)) {
        return REQUIRES_SETTLEMENT;
      }
      if (existing.settlement) return REQUIRES_SETTLEMENT;
      if (existing.state.kind === "retained" && !sameRetainedBase(existing.state, state)) {
        return REQUIRES_SETTLEMENT;
      }
      const priorLease = existing.holderLeases.get(holderIdentity);
      if (priorLease) {
        return Object.freeze({
          lease: priorLease,
          role: existing.ingressHolderIdentity === holderIdentity ? "ingress" : "joined",
          state: existing.state,
          status: "reserved",
        });
      }
      if (existing.holderLeases.size >= this.limits.maxHoldersPerDocument) {
        return Object.freeze({ reason: "holder-limit", status: "rejected" });
      }
      const lease = createLease(existing.authority, existing.reservationAuthority, holderIdentity);
      existing.holderLeases.set(holderIdentity, lease);
      return Object.freeze({
        lease,
        role: "joined",
        state: existing.state,
        status: "reserved",
      });
    }
    if (this.channels.size >= this.limits.maxLiveDocuments) {
      return Object.freeze({
        reason: "live-document-limit",
        status: "rejected",
      });
    }

    const exactAuthority = copyAuthority(authority);
    const reservationAuthority = Object.freeze({});
    const lease = createLease(exactAuthority, reservationAuthority, holderIdentity);
    this.channels.set(key, {
      authority: exactAuthority,
      holderLeases: new Map([[holderIdentity, lease]]),
      ingressHolderIdentity: holderIdentity,
      key,
      reservationAuthority,
      settlement: null,
      state,
    });
    return Object.freeze({ lease, role: "ingress", state, status: "reserved" });
  }

  recordLiveChange(
    lease: LiveContentReservation,
    event: LiveDocumentContentChangeEvent,
  ): RecordLiveContentReceipt {
    const channel = this.exactChannel(lease);
    if (!channel || channel.ingressHolderIdentity !== lease.holderIdentity) {
      return STALE_RECORD;
    }
    channel.settlement = null;
    let receipt: RecordLiveDocumentChangeReceipt;
    try {
      receipt = recordLiveDocumentContentChange(
        channel.state,
        channel.authority,
        event,
        this.limits.content,
      );
    } catch {
      receipt = degradeObservedLiveDocumentMutation(
        channel.state,
        channel.authority,
        "invalid-change",
      );
    }
    channel.state = receipt.state;
    return Object.freeze({
      mode: receipt.mode,
      observedWork: receipt.work,
      state: receipt.state,
      status: "committed",
    });
  }

  cancelLiveContent(lease: LiveContentReservation): boolean {
    const channel = this.exactChannel(lease);
    return (
      channel?.state.kind === "retained" &&
      this.releaseLiveContentHolder(lease).status === "released"
    );
  }

  releaseLiveContentHolder(lease: LiveContentReservation): ReleaseLiveContentHolderReceipt {
    const channel = this.exactChannel(lease);
    if (!channel) return Object.freeze({ status: "stale" });
    if (channel.settlement) return Object.freeze({ status: "blocked" });
    if (channel.holderLeases.size === 1) {
      if (channel.state.kind === "live-model") {
        return Object.freeze({ status: "blocked" });
      }
      this.channels.delete(channel.key);
      return Object.freeze({ promotedIngress: null, status: "released" });
    }
    channel.holderLeases.delete(lease.holderIdentity);
    let promotedIngress: LiveContentReservation | null = null;
    if (channel.ingressHolderIdentity === lease.holderIdentity) {
      channel.ingressHolderIdentity = channel.holderLeases.keys().next().value as object;
      promotedIngress = channel.holderLeases.get(channel.ingressHolderIdentity) ?? null;
    }
    return Object.freeze({ promotedIngress, status: "released" });
  }

  requestDispose(lease: LiveContentReservation):
    | { readonly status: "allowed" }
    | {
        readonly reason: "holders-active" | "settlement-required";
        readonly status: "blocked";
      }
    | { readonly reason: "stale"; readonly status: "blocked" } {
    const channel = this.exactChannel(lease);
    if (!channel) {
      return Object.freeze({ reason: "stale", status: "blocked" });
    }
    if (channel.holderLeases.size !== 1) {
      return Object.freeze({ reason: "holders-active", status: "blocked" });
    }
    if (channel.settlement) {
      return Object.freeze({
        reason: "settlement-required",
        status: "blocked",
      });
    }
    return channel.state.kind === "retained"
      ? Object.freeze({ status: "allowed" })
      : Object.freeze({
          reason: "settlement-required",
          status: "blocked",
        });
  }

  prepareSettlement(
    lease: LiveContentReservation,
    input: LiveContentDiscard,
  ): PrepareLiveContentSettlementReceipt {
    const channel = this.exactChannel(lease);
    if (!channel || input.kind !== "discard") {
      return Object.freeze({ reason: "stale", status: "rejected" });
    }
    if (channel.holderLeases.size !== 1) {
      return Object.freeze({
        reason: "holders-active",
        status: "rejected",
      });
    }
    if (channel.settlement) {
      return Object.freeze({
        reason: "already-prepared",
        status: "rejected",
      });
    }
    const permit = Object.freeze({
      permitAuthority: Object.freeze({}),
      reservationAuthority: lease.reservationAuthority,
    });
    channel.settlement = permit;
    return Object.freeze({ permit, status: "prepared" });
  }

  commitSettlement(permit: LiveContentSettlementPermit): boolean {
    const channel = this.channelForPermit(permit);
    if (!channel || channel.settlement !== permit || channel.holderLeases.size !== 1) {
      return false;
    }
    channel.settlement = null;
    this.channels.delete(channel.key);
    return true;
  }

  cancelSettlement(permit: LiveContentSettlementPermit): boolean {
    const channel = this.channelForPermit(permit);
    if (!channel || channel.settlement !== permit) return false;
    channel.settlement = null;
    return true;
  }

  inspect(lease: LiveContentReservation): LiveDocumentContentState | null {
    return this.exactChannel(lease)?.state ?? null;
  }

  activeReservationCount(): number {
    return this.channels.size;
  }

  private exactChannel(lease: LiveContentReservation): Channel | null {
    const channel = this.channels.get(channelKey(lease.authority));
    return channel &&
      channel.reservationAuthority === lease.reservationAuthority &&
      channel.holderLeases.get(lease.holderIdentity)?.holderAuthority === lease.holderAuthority &&
      sameLiveDocumentAuthority(channel.authority, lease.authority)
      ? channel
      : null;
  }

  private channelForPermit(permit: LiveContentSettlementPermit): Channel | null {
    for (const channel of this.channels.values()) {
      if (
        channel.reservationAuthority === permit.reservationAuthority &&
        channel.settlement?.permitAuthority === permit.permitAuthority
      ) {
        return channel;
      }
    }
    return null;
  }
}

function createLease(
  authority: LiveDocumentAuthority,
  reservationAuthority: object,
  holderIdentity: object,
): LiveContentReservation {
  return Object.freeze({
    authority,
    holderAuthority: Object.freeze({}),
    holderIdentity,
    reservationAuthority,
  });
}

function copyAuthority(authority: LiveDocumentAuthority): LiveDocumentAuthority {
  return Object.freeze({
    canonicalRoot: authority.canonicalRoot,
    documentIdentityKey: authority.documentIdentityKey,
    documentIncarnation: authority.documentIncarnation,
    modelId: authority.modelId,
    modelIncarnation: authority.modelIncarnation,
    ownerGeneration: authority.ownerGeneration,
    ownerIncarnation: authority.ownerIncarnation,
    ownerKey: authority.ownerKey,
    path: authority.path,
  });
}

function channelKey(authority: LiveDocumentAuthority): string {
  return JSON.stringify([
    authority.ownerKey,
    authority.canonicalRoot,
    authority.documentIdentityKey,
  ]);
}

function sameRetainedBase(
  left: LiveDocumentContentState,
  right: LiveDocumentContentState,
): boolean {
  return (
    left.kind === "retained" &&
    right.kind === "retained" &&
    left.alternativeVersionId === right.alternativeVersionId &&
    left.contentVersion === right.contentVersion &&
    left.modelVersionId === right.modelVersionId &&
    left.utf16Length === right.utf16Length &&
    left.utf8Bytes === right.utf8Bytes
  );
}

function validateCoordinatorLimitsShape(limits: LiveDocumentContentCoordinatorLimits): void {
  const keys = Object.keys(limits).sort();
  const expected = ["content", "maxHoldersPerDocument", "maxLiveDocuments"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError("Live document coordinator limits have an invalid shape");
  }
}

function requirePositive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

function requireObjectIdentity(value: object, name: string): void {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new TypeError(`${name} must be an object identity`);
  }
}

const STALE_RECORD = Object.freeze({
  status: "stale",
}) satisfies RecordLiveContentReceipt;
const REQUIRES_SETTLEMENT = Object.freeze({
  reason: "settlement-required",
  status: "rejected",
}) satisfies ReserveLiveContentReceipt;
