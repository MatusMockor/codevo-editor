import {
  LiveDocumentContentCoordinator,
  type LiveDocumentContentCoordinatorLimits,
} from "./liveDocumentContentCoordinator";
import {
  LiveDocumentSnapshotBroker,
  type CaptureLiveDocumentSnapshotReceipt,
  type LiveDocumentSnapshot,
  type LiveDocumentSnapshotBrokerLimits,
} from "./liveDocumentSnapshotBroker";
import {
  LiveModelIngressCoordinator,
  type LiveModelIngressRegistration,
  type LiveModelRevision,
  type LiveModelSourceHandle,
  type RecordLiveModelIngressReceipt,
  type RegisterLiveModelIngressReceipt,
} from "./liveModelIngressCoordinator";
import type { EditorChangeHunksSnapshotPort } from "./editorChangeHunksSnapshotPort";
import type { LiveDocumentContentChangeEvent } from "../domain/liveDocumentContentAuthority";

export interface LiveDocumentRuntimeLimits {
  readonly content?: LiveDocumentContentCoordinatorLimits;
  readonly maxObservers: number;
  readonly maxObserversPerHandle: number;
  readonly snapshots?: LiveDocumentSnapshotBrokerLimits;
}

export const DEFAULT_LIVE_DOCUMENT_RUNTIME_LIMITS: LiveDocumentRuntimeLimits = Object.freeze({
  maxObservers: 64,
  maxObserversPerHandle: 8,
});

export type RegisterLiveDocumentRuntimeReceipt =
  | {
      readonly handle: LiveModelSourceHandle;
      readonly role: "existing" | "joined" | "registered";
      readonly status: "registered";
    }
  | Exclude<RegisterLiveModelIngressReceipt, { readonly status: "registered" }>;

interface RuntimeEntry {
  readonly channel: RuntimeChannel;
  readonly handle: LiveModelSourceHandle;
  readonly ingressHandle: LiveModelSourceHandle;
  readonly observers: Set<(revision: LiveModelRevision) => void>;
}

interface RuntimeChannel {
  readonly channelAuthority: object;
  readonly entries: Set<RuntimeEntry>;
  invalidationRequested: boolean;
  notifying: boolean;
  notificationAdmissionsRemaining: number;
  readonly pendingRevisions: LiveModelRevision[];
}

/**
 * Application facade for one bounded family of exact live Monaco documents.
 *
 * Framework code receives opaque handles only. Content reservations, broker
 * registrations and retained snapshot ownership never cross this boundary.
 */
export class LiveDocumentRuntime implements EditorChangeHunksSnapshotPort {
  private readonly broker: LiveDocumentSnapshotBroker;
  private readonly channels = new Map<object, RuntimeChannel>();
  private readonly entries = new Map<object, RuntimeEntry>();
  private readonly ingress: LiveModelIngressCoordinator;
  private readonly limits: LiveDocumentRuntimeLimits;
  private observerCount = 0;

  constructor(limits: LiveDocumentRuntimeLimits = DEFAULT_LIVE_DOCUMENT_RUNTIME_LIMITS) {
    validateLimits(limits);
    const content = new LiveDocumentContentCoordinator(limits.content);
    this.broker = new LiveDocumentSnapshotBroker(content, limits.snapshots);
    this.ingress = new LiveModelIngressCoordinator(content, this.broker, this.broker);
    this.limits = Object.freeze({
      ...(limits.content ? { content: limits.content } : {}),
      maxObservers: limits.maxObservers,
      maxObserversPerHandle: limits.maxObserversPerHandle,
      ...(limits.snapshots ? { snapshots: limits.snapshots } : {}),
    });
  }

  register(input: LiveModelIngressRegistration): RegisterLiveDocumentRuntimeReceipt {
    const registered = this.ingress.register(input);
    if (registered.status !== "registered") return registered;

    const existing = this.entries.get(registered.handle.handleAuthority);
    if (existing?.ingressHandle === registered.handle) {
      return Object.freeze({
        handle: existing.handle,
        role: registered.role,
        status: "registered",
      });
    }

    const entry = this.createEntry(registered.handle);
    this.entries.set(entry.handle.handleAuthority, entry);
    return Object.freeze({
      handle: entry.handle,
      role: registered.role,
      status: "registered",
    });
  }

  retire(handle: LiveModelSourceHandle): boolean {
    const entry = this.exactEntry(handle);
    if (!entry) return false;
    const retired = this.ingress.discard(entry.ingressHandle);
    if (retired || entry.ingressHandle.currentRevision() === null) {
      this.removeEntry(entry);
    }
    return retired;
  }

  capture(handle: LiveModelSourceHandle, signal: AbortSignal): CaptureLiveDocumentSnapshotReceipt {
    const entry = this.exactEntry(handle);
    return entry
      ? this.ingress.capture(entry.ingressHandle, "change-hunks", signal)
      : STALE_CAPTURE;
  }

  /**
   * Captures one bounded, exact live buffer for a dirty-text search.
   *
   * The closed purpose stays inside the application facade so callers cannot
   * bypass the broker's purpose-specific limits or obtain its reservation.
   */
  captureForDirtySearch(
    handle: LiveModelSourceHandle,
    signal?: AbortSignal,
  ): CaptureLiveDocumentSnapshotReceipt {
    return this.captureForPurpose(handle, "dirty-search", signal);
  }

  /**
   * Captures one bounded, exact live buffer for a save preparation.
   *
   * Snapshot settlement remains bound to the same opaque runtime handle via
   * consumeCurrent/release; no broker capability crosses this facade.
   */
  captureForSave(
    handle: LiveModelSourceHandle,
    signal?: AbortSignal,
  ): CaptureLiveDocumentSnapshotReceipt {
    return this.captureForPurpose(handle, "save", signal);
  }

  consumeCurrent(handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot): boolean {
    const entry = this.exactEntry(handle);
    return entry ? this.ingress.consumeCurrent(entry.ingressHandle, snapshot) : false;
  }

  release(handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot): boolean {
    const entry = this.exactEntry(handle);
    return entry ? this.ingress.releaseSnapshot(entry.ingressHandle, snapshot) : false;
  }

  subscribe(
    handle: LiveModelSourceHandle,
    listener: (revision: LiveModelRevision) => void,
  ): () => void {
    const entry = this.exactEntry(handle);
    if (!entry) {
      throw new Error("Cannot subscribe to a stale live document handle");
    }
    if (typeof listener !== "function") {
      throw new TypeError("Live document observer must be a function");
    }
    if (entry.observers.has(listener)) {
      throw new Error("Live document observer is already subscribed");
    }
    if (
      entry.observers.size >= this.limits.maxObserversPerHandle ||
      this.observerCount >= this.limits.maxObservers
    ) {
      throw new Error("Live document observer limit reached");
    }

    entry.observers.add(listener);
    this.observerCount += 1;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (entry.observers.delete(listener)) {
        this.observerCount -= 1;
      }
    };
  }

  private captureForPurpose(
    handle: LiveModelSourceHandle,
    purpose: "dirty-search" | "save",
    signal?: AbortSignal,
  ): CaptureLiveDocumentSnapshotReceipt {
    const entry = this.exactEntry(handle);
    return entry ? this.ingress.capture(entry.ingressHandle, purpose, signal) : STALE_CAPTURE;
  }

  private createEntry(ingressHandle: LiveModelSourceHandle): RuntimeEntry {
    const handle: LiveModelSourceHandle = Object.freeze({
      channelAuthority: ingressHandle.channelAuthority,
      handleAuthority: ingressHandle.handleAuthority,
      modelAuthority: ingressHandle.modelAuthority,
      currentRevision: () => {
        const current = this.entries.get(ingressHandle.handleAuthority);
        return current?.handle === handle ? ingressHandle.currentRevision() : null;
      },
      recordChange: (event: LiveDocumentContentChangeEvent) => {
        const current = this.entries.get(ingressHandle.handleAuthority);
        if (current?.handle !== handle) {
          return STALE_RECORD;
        }
        const reservedNotification = current.channel.notifying;
        if (
          reservedNotification &&
          (current.channel.invalidationRequested ||
            current.channel.notificationAdmissionsRemaining <= 0)
        ) {
          current.channel.invalidationRequested = true;
          return REJECTED_NOTIFICATION_BACKPRESSURE;
        }
        if (reservedNotification) {
          current.channel.notificationAdmissionsRemaining -= 1;
        }
        let receipt: RecordLiveModelIngressReceipt;
        try {
          receipt = ingressHandle.recordChange(event);
        } catch (error) {
          if (reservedNotification) {
            current.channel.notificationAdmissionsRemaining += 1;
          }
          throw error;
        }
        if (receipt.status === "committed") {
          this.notifyChannel(current.channel, receipt.revision);
        } else {
          if (reservedNotification) {
            current.channel.notificationAdmissionsRemaining += 1;
          }
          if (ingressHandle.currentRevision() === null) {
            this.removeEntry(current);
          }
        }
        return receipt;
      },
      release: () => {
        const current = this.entries.get(ingressHandle.handleAuthority);
        if (current?.handle !== handle) {
          return STALE_RELEASE;
        }
        const receipt = ingressHandle.release();
        if (receipt.status === "released" || receipt.status === "stale") {
          this.removeEntry(current);
        }
        return receipt;
      },
    });
    const channel =
      this.channels.get(ingressHandle.channelAuthority) ??
      ({
        channelAuthority: ingressHandle.channelAuthority,
        entries: new Set<RuntimeEntry>(),
        invalidationRequested: false,
        notifying: false,
        notificationAdmissionsRemaining: 0,
        pendingRevisions: [],
      } satisfies RuntimeChannel);
    this.channels.set(channel.channelAuthority, channel);
    const entry: RuntimeEntry = {
      channel,
      handle,
      ingressHandle,
      observers: new Set<(revision: LiveModelRevision) => void>(),
    };
    channel.entries.add(entry);
    return entry;
  }

  private notifyChannel(channel: RuntimeChannel, revision: LiveModelRevision): void {
    if (channel.notifying) {
      channel.pendingRevisions.push(revision);
      return;
    }

    channel.notifying = true;
    channel.notificationAdmissionsRemaining = MAX_REENTRANT_NOTIFICATION_ROUNDS - 1;
    let next: LiveModelRevision | null = revision;
    let rounds = 0;
    let invalidate = false;
    try {
      while (next && rounds < MAX_REENTRANT_NOTIFICATION_ROUNDS && channel.entries.size > 0) {
        const published = next;
        next = null;
        for (const entry of [...channel.entries]) {
          if (!channel.entries.has(entry)) continue;
          for (const listener of [...entry.observers]) {
            if (!channel.entries.has(entry)) break;
            if (!entry.observers.has(listener)) continue;
            try {
              listener(published);
            } catch {
              // One observer must never suppress live ingress or another observer.
            }
          }
        }
        if (channel.invalidationRequested) {
          invalidate = true;
        }
        next = channel.pendingRevisions.shift() ?? null;
        rounds += 1;
      }
    } finally {
      channel.pendingRevisions.length = 0;
      channel.notificationAdmissionsRemaining = 0;
      channel.notifying = false;
      channel.invalidationRequested = false;
      if (invalidate) {
        this.invalidateChannel(channel);
      }
    }
  }

  private invalidateChannel(channel: RuntimeChannel): void {
    for (const entry of [...channel.entries]) {
      try {
        this.ingress.discard(entry.ingressHandle);
      } catch {
        // Runtime invalidation must stay fail-closed even if cleanup is unexpectedly rejected.
      } finally {
        this.removeEntry(entry);
      }
    }
  }

  private exactEntry(handle: LiveModelSourceHandle): RuntimeEntry | null {
    try {
      const entry = this.entries.get(handle.handleAuthority);
      return entry?.handle === handle && entry.ingressHandle.currentRevision() !== null
        ? entry
        : null;
    } catch {
      return null;
    }
  }

  private removeEntry(entry: RuntimeEntry): void {
    if (this.entries.get(entry.handle.handleAuthority) !== entry) return;
    this.entries.delete(entry.handle.handleAuthority);
    entry.channel.entries.delete(entry);
    if (entry.channel.entries.size === 0) {
      this.channels.delete(entry.channel.channelAuthority);
    }
    this.observerCount -= entry.observers.size;
    entry.observers.clear();
  }
}

function validateLimits(limits: LiveDocumentRuntimeLimits): void {
  const keys = Object.keys(limits).sort();
  if (
    keys.some(
      (key) =>
        key !== "content" &&
        key !== "maxObservers" &&
        key !== "maxObserversPerHandle" &&
        key !== "snapshots",
    ) ||
    !positive(limits.maxObservers) ||
    !positive(limits.maxObserversPerHandle) ||
    limits.maxObserversPerHandle > limits.maxObservers
  ) {
    throw new TypeError("Invalid live document runtime limits");
  }
}

function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

const MAX_REENTRANT_NOTIFICATION_ROUNDS = 16;
const STALE_CAPTURE = Object.freeze({
  reason: "stale",
  status: "rejected",
}) satisfies CaptureLiveDocumentSnapshotReceipt;
const STALE_RECORD = Object.freeze({ status: "stale" });
const REJECTED_NOTIFICATION_BACKPRESSURE = Object.freeze({
  reason: "notification-backpressure",
  status: "rejected",
}) satisfies RecordLiveModelIngressReceipt;
const STALE_RELEASE = Object.freeze({ status: "stale" });
