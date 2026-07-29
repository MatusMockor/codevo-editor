import type * as Monaco from "monaco-editor";
import {
  createEditorGroupLiveDocumentAuthority,
  editorGroupDocumentSessionWorkspaceMatches,
  type EditorGroupDocumentSessionAuthority,
} from "../application/editorSessionDocumentAuthority";
import type {
  LiveDocumentRuntime,
  RegisterLiveDocumentRuntimeReceipt,
} from "../application/liveDocumentRuntime";
import type {
  LiveModelIngressRecoveryHandle,
  LiveModelRevision,
  LiveModelSourceHandle,
} from "../application/liveModelIngressCoordinator";
import type {
  EditorChangeHunksSnapshotPort,
  EditorLiveDocumentContentAccessPort,
} from "../application/editorChangeHunksSnapshotPort";
import type {
  CaptureLiveDocumentSnapshotReceipt,
  LiveDocumentSnapshot,
} from "../application/liveDocumentSnapshotBroker";
import {
  DEFAULT_LIVE_DOCUMENT_CONTENT_LIMITS,
  sameLiveDocumentAuthority,
  type LiveDocumentAuthority,
  type LiveDocumentContentChangeEvent,
} from "../domain/liveDocumentContentAuthority";
import { createMonacoLiveDocumentSnapshotSource } from "../infrastructure/monacoLiveDocumentSnapshotSourceAdapter";
import { monacoModelIdentity } from "./monacoModelIdentity";
import { monacoModelRegistry, type MonacoModelLookup } from "./monacoModelRegistry";
import { workspacePathKeyForModel } from "./phpMonacoDocumentContext";

const MAX_BINDINGS = 16;
const MAX_BINDING_ID_LENGTH = 512;

type LiveDocumentBindingRuntime = Pick<
  LiveDocumentRuntime,
  | "capture"
  | "captureForDirtySearch"
  | "captureForSave"
  | "consumeCurrent"
  | "register"
  | "release"
  | "retire"
  | "subscribe"
>;

export interface EditorLiveDocumentBindingRegistration {
  readonly editor: Monaco.editor.IStandaloneCodeEditor;
  readonly id: string;
  readonly isSessionAuthorityCurrent: (authority: EditorGroupDocumentSessionAuthority) => boolean;
  readonly monacoApi: typeof Monaco;
  readonly sessionAuthority: EditorGroupDocumentSessionAuthority;
  readonly workspaceRoot: string | null;
}

export type EditorLiveDocumentBindingRejectionReason =
  | "duplicate-id"
  | "invalid-binding"
  | "registration-failed"
  | "retire-blocked"
  | "too-many-bindings";

export interface EditorLiveDocumentBindingRejection {
  readonly id: string | null;
  readonly reason: EditorLiveDocumentBindingRejectionReason;
}

export interface EditorLiveDocumentBindingReconcileReceipt {
  readonly boundCount: number;
  readonly rejections: readonly EditorLiveDocumentBindingRejection[];
  readonly status: "reconciled";
}

export interface EditorLiveDocumentHandleLookup {
  currentHandle(id: string): LiveModelSourceHandle | null;
}

interface BindingChannel {
  alive: boolean;
  readonly authority: LiveDocumentAuthority;
  readonly members: Set<BindingEntry>;
  readonly model: Monaco.editor.ITextModel;
  readonly modelAuthority: object;
  readonly registry: MonacoModelLookup;
  readonly source: ReturnType<typeof createMonacoLiveDocumentSnapshotSource>;
  readonly workspaceRoot: string | null;
}

interface BindingEntry {
  admitted: boolean;
  alive: boolean;
  readonly channel: BindingChannel;
  handle: LiveModelSourceHandle | null;
  readonly holderIdentity: object;
  readonly id: string;
  registration: EditorLiveDocumentBindingRegistration;
  retiring: boolean;
  runtimeHandle: LiveModelSourceHandle | null;
}

interface PreparedBinding {
  readonly alternativeVersionId: number;
  readonly authority: LiveDocumentAuthority;
  readonly model: Monaco.editor.ITextModel;
  readonly modelAuthority: object;
  readonly modelVersionId: number;
  readonly registry: MonacoModelLookup;
  readonly utf16Length: number;
  readonly utf8Bytes: number;
  readonly workspaceRoot: string | null;
}

interface PendingSnapshotRelease {
  readonly handle: LiveModelSourceHandle;
  readonly snapshot: LiveDocumentSnapshot;
}

/**
 * Framework-side owner that joins an exact editor-group session selection to
 * an exact registry-owned Monaco model and the application live runtime.
 *
 * Binding never reads full text. The retained base charges a conservative
 * three-byte UTF-8 upper bound per UTF-16 code unit; exact bytes are obtained
 * only by a later bounded snapshot capture.
 */
export class EditorLiveDocumentBindingCoordinator
  implements
    EditorLiveDocumentHandleLookup,
    EditorChangeHunksSnapshotPort,
    EditorLiveDocumentContentAccessPort
{
  private readonly entries = new Map<string, BindingEntry>();
  private readonly entriesByHandleAuthority = new Map<object, BindingEntry>();
  private readonly pendingSnapshotReleases = new Map<object, PendingSnapshotRelease>();
  private readonly recoveries = new Set<LiveModelIngressRecoveryHandle>();

  constructor(private readonly runtime: LiveDocumentBindingRuntime) {}

  reconcile(
    registrations: readonly EditorLiveDocumentBindingRegistration[],
  ): EditorLiveDocumentBindingReconcileReceipt {
    this.retryRecoveries();
    this.retrySnapshotReleases();
    if (!Array.isArray(registrations) || registrations.length > MAX_BINDINGS) {
      return this.receipt([
        Object.freeze({
          id: null,
          reason: "too-many-bindings",
        }),
      ]);
    }

    const rejections: EditorLiveDocumentBindingRejection[] = [];
    const desired = new Map<string, EditorLiveDocumentBindingRegistration>();
    const duplicateIds = new Set<string>();
    for (const registration of registrations) {
      const id = safeRegistrationId(registration);
      if (!id) {
        rejections.push(Object.freeze({ id: null, reason: "invalid-binding" }));
        continue;
      }
      if (desired.has(id) || duplicateIds.has(id)) {
        desired.delete(id);
        duplicateIds.add(id);
        rejections.push(Object.freeze({ id, reason: "duplicate-id" }));
        continue;
      }
      desired.set(id, registration);
    }

    for (const [id, entry] of [...this.entries]) {
      const registration = desired.get(id);
      if (registration && this.canRetainEntry(entry, registration)) {
        entry.registration = registration;
        desired.delete(id);
        continue;
      }
      if (!this.retireEntry(id, entry)) {
        rejections.push(Object.freeze({ id, reason: "retire-blocked" }));
        desired.delete(id);
      }
    }

    for (const [id, registration] of desired) {
      if (
        this.entries.size + this.recoveries.size + this.pendingSnapshotReleases.size >=
        MAX_BINDINGS
      ) {
        rejections.push(Object.freeze({ id, reason: "too-many-bindings" }));
        continue;
      }
      const prepared = this.prepare(registration);
      if (!prepared) {
        rejections.push(Object.freeze({ id, reason: "invalid-binding" }));
        continue;
      }
      if (!this.bind(id, registration, prepared)) {
        rejections.push(Object.freeze({ id, reason: "registration-failed" }));
      }
    }

    return this.receipt(rejections);
  }

  currentHandle = (id: string): LiveModelSourceHandle | null => {
    const entry = this.entries.get(id);
    return entry?.handle && this.isEntryCurrent(entry) ? entry.handle : null;
  };

  capture(handle: LiveModelSourceHandle, signal: AbortSignal): CaptureLiveDocumentSnapshotReceipt {
    const entry = this.exactEntryForHandle(handle);
    if (!entry?.runtimeHandle || !this.isEntryCurrent(entry)) return STALE_CAPTURE;
    const runtimeHandle = entry.runtimeHandle;
    const captured = this.runtime.capture(runtimeHandle, signal);
    if (captured.status === "captured" && !this.isEntryCurrent(entry)) {
      this.settleSnapshotRelease(runtimeHandle, captured.snapshot);
      return STALE_CAPTURE;
    }
    return captured;
  }

  captureForDirtySearch(
    handle: LiveModelSourceHandle,
    signal?: AbortSignal,
  ): CaptureLiveDocumentSnapshotReceipt {
    return this.captureForClosedPurpose(handle, "dirty-search", signal);
  }

  captureForSave(
    handle: LiveModelSourceHandle,
    signal?: AbortSignal,
  ): CaptureLiveDocumentSnapshotReceipt {
    return this.captureForClosedPurpose(handle, "save", signal);
  }

  consumeCurrent(handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot): boolean {
    const entry = this.exactEntryForHandle(handle);
    const runtimeHandle = entry?.runtimeHandle ?? null;
    if (!entry || !runtimeHandle || !this.isEntryCurrent(entry)) return false;
    const consumed = this.runtime.consumeCurrent(runtimeHandle, snapshot);
    return (
      consumed &&
      this.exactEntryForHandle(handle) === entry &&
      entry.runtimeHandle === runtimeHandle &&
      this.isEntryCurrent(entry)
    );
  }

  release(handle: LiveModelSourceHandle, snapshot: LiveDocumentSnapshot): boolean {
    const entry = this.exactEntryForHandle(handle);
    const runtimeHandle = entry?.runtimeHandle ?? null;
    if (!entry || !runtimeHandle) return false;
    const released = this.settleSnapshotRelease(runtimeHandle, snapshot);
    return (
      released &&
      this.exactEntryForHandle(handle) === entry &&
      entry.runtimeHandle === runtimeHandle
    );
  }

  subscribe(
    handle: LiveModelSourceHandle,
    listener: (revision: LiveModelRevision) => void,
  ): () => void {
    const entry = this.exactEntryForHandle(handle);
    if (!entry?.runtimeHandle || !this.isEntryCurrent(entry)) {
      throw new Error("Cannot subscribe to a stale editor live-document binding");
    }
    return this.runtime.subscribe(entry.runtimeHandle, (revision) => {
      if (this.isEntryCurrent(entry)) listener(revision);
    });
  }

  dispose(): boolean {
    for (const [id, entry] of [...this.entries]) {
      this.retireEntry(id, entry);
    }
    this.retryRecoveries();
    this.retrySnapshotReleases();
    return (
      this.entries.size === 0 &&
      this.recoveries.size === 0 &&
      this.pendingSnapshotReleases.size === 0
    );
  }

  private captureForClosedPurpose(
    handle: LiveModelSourceHandle,
    purpose: "dirty-search" | "save",
    signal?: AbortSignal,
  ): CaptureLiveDocumentSnapshotReceipt {
    const entry = this.exactEntryForHandle(handle);
    const runtimeHandle = entry?.runtimeHandle ?? null;
    if (!entry || !runtimeHandle || !this.isEntryCurrent(entry)) return STALE_CAPTURE;
    let captured: CaptureLiveDocumentSnapshotReceipt;
    try {
      captured =
        purpose === "save"
          ? this.runtime.captureForSave(runtimeHandle, signal)
          : this.runtime.captureForDirtySearch(runtimeHandle, signal);
    } catch {
      return SOURCE_FAILED_CAPTURE;
    }
    if (
      this.exactEntryForHandle(handle) !== entry ||
      entry.runtimeHandle !== runtimeHandle ||
      !this.isEntryCurrent(entry)
    ) {
      if (captured.status === "captured") {
        this.settleSnapshotRelease(runtimeHandle, captured.snapshot);
      }
      return STALE_CAPTURE;
    }
    return captured;
  }

  private bind(
    id: string,
    registration: EditorLiveDocumentBindingRegistration,
    prepared: PreparedBinding,
  ): boolean {
    const channel = this.existingChannel(prepared) ?? this.createChannel(prepared);
    const entry: BindingEntry = {
      admitted: true,
      alive: true,
      channel,
      handle: null,
      holderIdentity: Object.freeze({}),
      id,
      registration,
      retiring: false,
      runtimeHandle: null,
    };
    channel.members.add(entry);
    this.entries.set(id, entry);

    let receipt: RegisterLiveDocumentRuntimeReceipt;
    try {
      receipt = this.runtime.register({
        authority: prepared.authority,
        base: {
          alternativeVersionId: prepared.alternativeVersionId,
          contentVersion: prepared.modelVersionId,
          modelVersionId: prepared.modelVersionId,
          utf16Length: prepared.utf16Length,
          utf8Bytes: prepared.utf8Bytes,
        },
        holderIdentity: entry.holderIdentity,
        source: channel.source,
      });
    } catch {
      this.removeUnregisteredEntry(id, entry);
      return false;
    }
    if (receipt.status !== "registered") {
      if (receipt.status === "recovery-required" && !this.discardRecovery(receipt.recovery)) {
        if (this.recoveries.size < MAX_BINDINGS) this.recoveries.add(receipt.recovery);
      }
      this.removeUnregisteredEntry(id, entry);
      return false;
    }
    entry.runtimeHandle = receipt.handle;
    entry.handle = this.createScopedHandle(entry, receipt.handle);
    this.entriesByHandleAuthority.set(entry.handle.handleAuthority, entry);
    if (
      this.entries.get(id) !== entry ||
      !entry.alive ||
      !entry.channel.members.has(entry) ||
      !this.isEntryCurrent(entry)
    ) {
      this.retireEntry(id, entry);
      return false;
    }
    return true;
  }

  private prepare(registration: EditorLiveDocumentBindingRegistration): PreparedBinding | null {
    try {
      const { editor, monacoApi, sessionAuthority, workspaceRoot } = registration;
      if (
        !validRegistration(registration) ||
        !registration.isSessionAuthorityCurrent(sessionAuthority) ||
        (workspaceRoot !== null &&
          !editorGroupDocumentSessionWorkspaceMatches(sessionAuthority, workspaceRoot))
      ) {
        return null;
      }
      const registry = monacoModelRegistry(monacoApi);
      const model = registry.modelForPath(workspaceRoot, sessionAuthority.path);
      if (
        !model ||
        model.isDisposed?.() ||
        editor.getModel() !== model ||
        (workspaceRoot === null && workspacePathKeyForModel(model) !== null)
      ) {
        return null;
      }
      const modelAuthority = registry.modelAuthority(model);
      if (!modelAuthority) return null;
      const modelVersionId = model.getVersionId();
      const alternativeVersionId = model.getAlternativeVersionId();
      const utf16Length = model.getValueLength();
      const utf8Bytes = utf8BytesUpperBoundForUtf16Length(utf16Length);
      if (
        !positive(modelVersionId) ||
        !positive(alternativeVersionId) ||
        utf8Bytes === null ||
        model.isDisposed?.() ||
        editor.getModel() !== model ||
        registry.modelForPath(workspaceRoot, sessionAuthority.path) !== model ||
        registry.modelAuthority(model) !== modelAuthority ||
        !registration.isSessionAuthorityCurrent(sessionAuthority)
      ) {
        return null;
      }
      const authority = createEditorGroupLiveDocumentAuthority(sessionAuthority, {
        id: monacoModelIdentity(model),
        incarnation: modelAuthority,
      });
      if (!authority) return null;
      if (
        model.getVersionId() !== modelVersionId ||
        model.getAlternativeVersionId() !== alternativeVersionId ||
        model.getValueLength() !== utf16Length ||
        model.isDisposed?.() ||
        editor.getModel() !== model ||
        registry.modelForPath(workspaceRoot, sessionAuthority.path) !== model ||
        registry.modelAuthority(model) !== modelAuthority ||
        !registration.isSessionAuthorityCurrent(sessionAuthority)
      ) {
        return null;
      }
      return Object.freeze({
        alternativeVersionId,
        authority,
        model,
        modelAuthority,
        modelVersionId,
        registry,
        utf16Length,
        utf8Bytes,
        workspaceRoot,
      });
    } catch {
      return null;
    }
  }

  private createChannel(prepared: PreparedBinding): BindingChannel {
    const source = createMonacoLiveDocumentSnapshotSource({
      isCurrentModel: (model) => this.isChannelCurrent(channel, model),
      model: prepared.model,
      modelAuthority: prepared.modelAuthority,
    });
    const channel: BindingChannel = {
      alive: true,
      authority: prepared.authority,
      members: new Set<BindingEntry>(),
      model: prepared.model,
      modelAuthority: prepared.modelAuthority,
      registry: prepared.registry,
      source,
      workspaceRoot: prepared.workspaceRoot,
    };
    return channel;
  }

  private existingChannel(prepared: PreparedBinding): BindingChannel | null {
    for (const entry of this.entries.values()) {
      const channel = entry.channel;
      if (
        channel.alive &&
        channel.model === prepared.model &&
        channel.modelAuthority === prepared.modelAuthority &&
        channel.registry === prepared.registry &&
        channel.workspaceRoot === prepared.workspaceRoot &&
        sameLiveDocumentAuthority(channel.authority, prepared.authority)
      ) {
        return channel;
      }
    }
    return null;
  }

  private canRetainEntry(
    entry: BindingEntry,
    registration: EditorLiveDocumentBindingRegistration,
  ): boolean {
    if (
      !entry.alive ||
      !entry.admitted ||
      !entry.handle ||
      entry.registration.editor !== registration.editor ||
      entry.registration.monacoApi !== registration.monacoApi ||
      entry.registration.workspaceRoot !== registration.workspaceRoot ||
      entry.registration.sessionAuthority.identity !== registration.sessionAuthority.identity
    ) {
      return false;
    }
    const previous = entry.registration;
    entry.registration = registration;
    const current = this.isEntryCurrent(entry);
    if (!current) entry.registration = previous;
    return current;
  }

  private isEntryCurrent(entry: BindingEntry): boolean {
    return entry.admitted && this.isEntryCleanupCurrent(entry) && entry.admitted;
  }

  private isEntryCleanupCurrent(entry: BindingEntry): boolean {
    try {
      const { channel, registration } = entry;
      const current =
        entry.alive &&
        channel.alive &&
        entry.handle !== null &&
        entry.runtimeHandle !== null &&
        this.entries.get(entry.id) === entry &&
        registration.sessionAuthority.groupId.length > 0 &&
        registration.isSessionAuthorityCurrent(registration.sessionAuthority) &&
        registration.editor.getModel() === channel.model &&
        !channel.model.isDisposed?.() &&
        channel.registry.modelForPath(
          registration.workspaceRoot,
          registration.sessionAuthority.path,
        ) === channel.model &&
        channel.registry.modelAuthority(channel.model) === channel.modelAuthority &&
        (registration.workspaceRoot !== null || workspacePathKeyForModel(channel.model) === null) &&
        entry.runtimeHandle.currentRevision() !== null &&
        registration.isSessionAuthorityCurrent(registration.sessionAuthority);
      return (
        current &&
        entry.alive &&
        channel.alive &&
        entry.handle !== null &&
        entry.runtimeHandle !== null &&
        this.entries.get(entry.id) === entry &&
        entry.registration === registration &&
        channel.members.has(entry)
      );
    } catch {
      return false;
    }
  }

  private isChannelCurrent(channel: BindingChannel, model: Monaco.editor.ITextModel): boolean {
    return (
      channel.alive &&
      channel.model === model &&
      channel.registry.modelAuthority(model) === channel.modelAuthority &&
      [...channel.members].some((entry) => this.isEntryCleanupCurrent(entry))
    );
  }

  private retireEntry(id: string, entry: BindingEntry): boolean {
    entry.admitted = false;
    if (entry.retiring) return false;
    entry.retiring = true;
    const runtimeHandle = entry.runtimeHandle;
    let retired = runtimeHandle === null;
    try {
      if (runtimeHandle) {
        retired = this.runtime.retire(runtimeHandle) || runtimeHandle.currentRevision() === null;
      }
    } catch {
      retired = false;
    } finally {
      entry.retiring = false;
    }
    if (!retired) return false;
    entry.alive = false;
    if (this.entries.get(id) === entry) this.entries.delete(id);
    if (entry.handle) this.entriesByHandleAuthority.delete(entry.handle.handleAuthority);
    entry.channel.members.delete(entry);
    if (entry.channel.members.size === 0) entry.channel.alive = false;
    return true;
  }

  private removeUnregisteredEntry(id: string, entry: BindingEntry): void {
    if (this.entries.get(id) === entry) this.entries.delete(id);
    entry.alive = false;
    entry.channel.members.delete(entry);
    if (entry.channel.members.size === 0) entry.channel.alive = false;
  }

  private createScopedHandle(
    entry: BindingEntry,
    runtimeHandle: LiveModelSourceHandle,
  ): LiveModelSourceHandle {
    const handleAuthority = Object.freeze({});
    return Object.freeze({
      channelAuthority: runtimeHandle.channelAuthority,
      currentRevision: () => (this.isEntryCurrent(entry) ? runtimeHandle.currentRevision() : null),
      handleAuthority,
      modelAuthority: runtimeHandle.modelAuthority,
      recordChange: (event: LiveDocumentContentChangeEvent) =>
        this.isEntryCurrent(entry) ? runtimeHandle.recordChange(event) : STALE_RECORD,
      release: () => {
        const current = this.entriesByHandleAuthority.get(handleAuthority);
        if (current !== entry) return STALE_RELEASE;
        return this.retireEntry(entry.id, entry) ? RELEASED : BLOCKED_RELEASE;
      },
    });
  }

  private exactEntryForHandle(handle: LiveModelSourceHandle): BindingEntry | null {
    try {
      const entry = this.entriesByHandleAuthority.get(handle.handleAuthority);
      return entry?.handle === handle ? entry : null;
    } catch {
      return null;
    }
  }

  private retryRecoveries(): void {
    for (const recovery of [...this.recoveries]) {
      if (this.discardRecovery(recovery)) this.recoveries.delete(recovery);
    }
  }

  private retrySnapshotReleases(): void {
    for (const [authority, pending] of [...this.pendingSnapshotReleases]) {
      if (this.snapshotReleaseSettled(pending.handle, pending.snapshot)) {
        this.pendingSnapshotReleases.delete(authority);
      }
    }
  }

  private settleSnapshotRelease(
    handle: LiveModelSourceHandle,
    snapshot: LiveDocumentSnapshot,
  ): boolean {
    if (this.snapshotReleaseSettled(handle, snapshot)) return true;
    if (this.pendingSnapshotReleases.size < MAX_BINDINGS) {
      this.pendingSnapshotReleases.set(snapshot.snapshotAuthority, { handle, snapshot });
    }
    return false;
  }

  private snapshotReleaseSettled(
    handle: LiveModelSourceHandle,
    snapshot: LiveDocumentSnapshot,
  ): boolean {
    try {
      return this.runtime.release(handle, snapshot) || handle.currentRevision() === null;
    } catch {
      try {
        return handle.currentRevision() === null;
      } catch {
        return false;
      }
    }
  }

  private discardRecovery(recovery: LiveModelIngressRecoveryHandle): boolean {
    try {
      if (recovery.discard()) return true;
    } catch {
      // An uncertain discard is settled below only when the exact recovery
      // authority reports that its channel is already gone.
    }
    try {
      return recovery.currentRevision() === null;
    } catch {
      return false;
    }
  }

  private receipt(
    rejections: readonly EditorLiveDocumentBindingRejection[],
  ): EditorLiveDocumentBindingReconcileReceipt {
    return Object.freeze({
      boundCount: [...this.entries.values()].filter((entry) => this.isEntryCurrent(entry)).length,
      rejections: Object.freeze([...rejections]),
      status: "reconciled",
    });
  }
}

export function utf8BytesUpperBoundForUtf16Length(utf16Length: number): number | null {
  if (
    !Number.isSafeInteger(utf16Length) ||
    utf16Length < 0 ||
    utf16Length > DEFAULT_LIVE_DOCUMENT_CONTENT_LIMITS.maxDocumentUtf16Units
  ) {
    return null;
  }
  return Math.min(Number.MAX_SAFE_INTEGER, utf16Length * 3);
}

function safeRegistrationId(registration: EditorLiveDocumentBindingRegistration): string | null {
  try {
    return typeof registration.id === "string" &&
      registration.id.length > 0 &&
      registration.id.length <= MAX_BINDING_ID_LENGTH
      ? registration.id
      : null;
  } catch {
    return null;
  }
}

function validRegistration(registration: EditorLiveDocumentBindingRegistration): boolean {
  return (
    typeof registration.id === "string" &&
    typeof registration.isSessionAuthorityCurrent === "function" &&
    typeof registration.sessionAuthority.groupId === "string" &&
    registration.sessionAuthority.groupId.length > 0 &&
    typeof registration.sessionAuthority.path === "string" &&
    registration.sessionAuthority.path.length > 0 &&
    typeof registration.sessionAuthority.identity === "object" &&
    registration.sessionAuthority.identity !== null
  );
}

function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

const STALE_CAPTURE = Object.freeze({
  reason: "stale",
  status: "rejected",
}) satisfies CaptureLiveDocumentSnapshotReceipt;
const SOURCE_FAILED_CAPTURE = Object.freeze({
  reason: "source-failed",
  status: "rejected",
}) satisfies CaptureLiveDocumentSnapshotReceipt;
const STALE_RECORD = Object.freeze({ status: "stale" as const });
const STALE_RELEASE = Object.freeze({ status: "stale" as const });
const RELEASED = Object.freeze({ status: "released" as const });
const BLOCKED_RELEASE = Object.freeze({
  reason: "settlement-required" as const,
  status: "blocked" as const,
});
