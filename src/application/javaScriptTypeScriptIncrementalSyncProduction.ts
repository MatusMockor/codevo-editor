import {
  createEditorGroupLiveDocumentAuthority,
  editorGroupDocumentSessionWorkspaceMatches,
  type EditorGroupDocumentSessionAuthority,
} from "./editorSessionDocumentAuthority";
import type {
  JavaScriptTypeScriptIncrementalSyncArbitration,
  JavaScriptTypeScriptIncrementalSyncBinding,
  JavaScriptTypeScriptIncrementalSyncFallbackReason,
  JavaScriptTypeScriptIncrementalSyncOpenResult,
  JavaScriptTypeScriptIncrementalSyncReleaseResult,
  JavaScriptTypeScriptIncrementalSyncService,
} from "./javaScriptTypeScriptIncrementalSyncService";
import type {
  IncrementalDocumentContentEvent,
  NegotiatedDocumentSyncCapability,
} from "../domain/incrementalDocumentSync";
import {
  DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS,
  boundedUtf8Length,
} from "../domain/incrementalDocumentSync";
import {
  AUTHORITATIVE_EDITOR_LIVE_EDIT,
  LEGACY_REQUIRED_EDITOR_LIVE_EDIT,
  type EditorLiveEditArbitrationReceipt,
} from "./editorLiveEditArbitration";
import type { JavaScriptTypeScriptDocumentLanguageId } from "../domain/incrementalLanguageServerDocumentSync";
import type { LiveDocumentAuthority } from "../domain/liveDocumentContentAuthority";

export interface JavaScriptTypeScriptIncrementalRuntimeAuthority {
  readonly capability: NegotiatedDocumentSyncCapability;
  readonly rootPath: string;
  readonly sessionId: number;
  readonly syncGeneration: number;
}

export interface JavaScriptTypeScriptIncrementalLegacyPort {
  close(request: JavaScriptTypeScriptIncrementalLegacyRequest): Promise<void>;
  open(request: JavaScriptTypeScriptIncrementalLegacyRequest): Promise<void>;
}

export interface JavaScriptTypeScriptIncrementalLegacyRequest {
  readonly authority: JavaScriptTypeScriptIncrementalRuntimeAuthority;
  isCurrent(): boolean;
  readonly operation: "close" | "open";
  readonly path: string;
}

export interface JavaScriptTypeScriptIncrementalRuntimePort {
  current(): JavaScriptTypeScriptIncrementalRuntimeAuthority | null;
  isCurrent(authority: JavaScriptTypeScriptIncrementalRuntimeAuthority): boolean;
}

export interface EditorJavaScriptTypeScriptIncrementalSyncSource {
  readonly alternativeVersionId: number;
  captureCurrentContent(): string | null;
  currentUtf16Length(): number | null;
  readonly languageId: string;
  readonly model: object;
  readonly modelId: string;
  publishLegacyFallback?(content: string): boolean;
  readonly versionId: number;
  readonly utf16Length: number;
}

export interface EditorJavaScriptTypeScriptIncrementalSyncAttachment {
  readonly kind: "editor-javascript-typescript-incremental-sync-attachment";
  readonly semanticMode: "degraded-large-file" | "incremental";
}

export interface EditorJavaScriptTypeScriptIncrementalSyncPort {
  attach(
    authority: EditorGroupDocumentSessionAuthority,
    source: EditorJavaScriptTypeScriptIncrementalSyncSource,
    isCurrent: () => boolean,
  ): EditorJavaScriptTypeScriptIncrementalSyncAttachment | null;
  observe(
    attachment: EditorJavaScriptTypeScriptIncrementalSyncAttachment,
    event: IncrementalDocumentContentEvent,
  ): EditorLiveEditArbitrationReceipt;
  reconciliationIdentity(): object | null;
  release(attachment: EditorJavaScriptTypeScriptIncrementalSyncAttachment): Promise<void>;
}

export interface JavaScriptTypeScriptIncrementalLegacyClaim {
  readonly revision: number;
  suppressLegacy(): Promise<boolean>;
}

export interface JavaScriptTypeScriptIncrementalSyncLifecycleLease {
  readonly kind: "javascript-typescript-incremental-sync-lifecycle-lease";
}

export interface JavaScriptTypeScriptIncrementalSyncSavePermit {
  readonly kind: "javascript-typescript-incremental-sync-save-permit";
}

export interface JavaScriptTypeScriptIncrementalSyncPreparedSave {
  readonly content: string;
  readonly permit: JavaScriptTypeScriptIncrementalSyncSavePermit;
  readonly revision: number;
}

export interface JavaScriptTypeScriptIncrementalSyncDocumentLifecyclePort {
  closeDocument(lease: JavaScriptTypeScriptIncrementalSyncLifecycleLease): Promise<boolean>;
  closeRoot(rootPath: string): Promise<void>;
  drainBeforeSave(lease: JavaScriptTypeScriptIncrementalSyncLifecycleLease): Promise<boolean>;
  fallbackToLegacy(lease: JavaScriptTypeScriptIncrementalSyncLifecycleLease): Promise<void>;
  isLeaseCurrent(lease: JavaScriptTypeScriptIncrementalSyncLifecycleLease): boolean;
  isSavePermitCurrent(permit: JavaScriptTypeScriptIncrementalSyncSavePermit): boolean;
  ownsLifecycle(path: string): boolean;
  prepareSave(
    lease: JavaScriptTypeScriptIncrementalSyncLifecycleLease,
  ): Promise<JavaScriptTypeScriptIncrementalSyncPreparedSave | null>;
  confirmSave(permit: JavaScriptTypeScriptIncrementalSyncSavePermit): boolean;
  requestLifecycleLease(path: string): JavaScriptTypeScriptIncrementalSyncLifecycleLease | null;
}

interface AttachmentCapabilities {
  binding: JavaScriptTypeScriptIncrementalSyncBinding | null;
  readonly channel: ChannelRecord;
  fallbackPublicationInProgress: boolean;
  readonly isCurrent: () => boolean;
  readonly pendingEvents: PendingOpeningEvent[];
  pendingEventUtf8Bytes: number;
  released: boolean;
  readonly runtimeAuthority: JavaScriptTypeScriptIncrementalRuntimeAuthority;
  readonly source: EditorJavaScriptTypeScriptIncrementalSyncSource;
  state: "blocked" | "closed" | "degraded" | "fallback-pending" | "open" | "opening";
}

interface ChannelRecord {
  allowLegacyRestore: boolean;
  readonly attachments: Set<EditorJavaScriptTypeScriptIncrementalSyncAttachment>;
  lastObservedRevision: number;
  legacyHandoff: Promise<void> | null;
  legacyRestore: Promise<boolean> | null;
  readonly model: object;
  readonly path: string;
  retired: boolean;
  readonly rootPath: string;
}

interface PendingClaim {
  readonly authority: JavaScriptTypeScriptIncrementalRuntimeAuthority;
  readonly blockingRetirement: boolean;
  readonly channel: ChannelRecord;
  consumed: boolean;
  readonly decision: Promise<JavaScriptTypeScriptIncrementalSyncArbitration>;
  readonly revision: number;
  readonly utf8Bytes: number;
}

interface PendingOpeningEvent {
  readonly event: IncrementalDocumentContentEvent;
  readonly resolve: (decision: JavaScriptTypeScriptIncrementalSyncArbitration) => void;
}

interface BlockedPath {
  readonly authority: JavaScriptTypeScriptIncrementalRuntimeAuthority;
}

interface LifecycleLeaseCapabilities {
  readonly attachment: EditorJavaScriptTypeScriptIncrementalSyncAttachment;
  readonly attachmentCapabilities: AttachmentCapabilities;
  readonly binding: JavaScriptTypeScriptIncrementalSyncBinding | null;
  readonly channel: ChannelRecord;
  readonly runtimeAuthority: JavaScriptTypeScriptIncrementalRuntimeAuthority;
}

interface SavePermitCapabilities {
  readonly content: string;
  readonly lease: JavaScriptTypeScriptIncrementalSyncLifecycleLease;
  readonly leaseCapabilities: LifecycleLeaseCapabilities;
  readonly revision: number;
  consumed: boolean;
}

const MAX_PENDING_CLAIMS_PER_PATH = 256;
const MAX_PENDING_CLAIMS_TOTAL = 8_192;
const MAX_PRODUCTION_CHANNELS = 32;
export const JAVASCRIPT_TYPESCRIPT_INCREMENTAL_PRODUCTION_OPERATION_TIMEOUT_MS = 5_000;
export const MAX_PENDING_CLAIM_UTF8_BYTES_PER_PATH = 512 * 1024;
export const MAX_PENDING_CLAIM_UTF8_BYTES_TOTAL = 8 * 1024 * 1024;
export const MAX_PENDING_OPENING_EVENTS = 256;
export const MAX_PENDING_OPENING_UTF8_BYTES = 512 * 1024;
export const MAX_JAVASCRIPT_TYPESCRIPT_INCREMENTAL_LSP_INITIAL_UTF16_UNITS =
  DEFAULT_INCREMENTAL_DOCUMENT_SYNC_LIMITS.maxFullSnapshotUtf16Units;

export interface JavaScriptTypeScriptIncrementalSyncProductionLimits {
  readonly maxPendingClaimUtf8BytesPerPath: number;
  readonly maxPendingClaimUtf8BytesTotal: number;
  readonly maxPendingClaimsPerPath: number;
  readonly maxPendingClaimsTotal: number;
  readonly maxPendingOpeningEvents: number;
  readonly maxPendingOpeningUtf8Bytes: number;
  readonly operationTimeoutMs: number;
}

const DEFAULT_PRODUCTION_LIMITS: JavaScriptTypeScriptIncrementalSyncProductionLimits =
  Object.freeze({
    maxPendingClaimUtf8BytesPerPath: MAX_PENDING_CLAIM_UTF8_BYTES_PER_PATH,
    maxPendingClaimUtf8BytesTotal: MAX_PENDING_CLAIM_UTF8_BYTES_TOTAL,
    maxPendingClaimsPerPath: MAX_PENDING_CLAIMS_PER_PATH,
    maxPendingClaimsTotal: MAX_PENDING_CLAIMS_TOTAL,
    maxPendingOpeningEvents: MAX_PENDING_OPENING_EVENTS,
    maxPendingOpeningUtf8Bytes: MAX_PENDING_OPENING_UTF8_BYTES,
    operationTimeoutMs: JAVASCRIPT_TYPESCRIPT_INCREMENTAL_PRODUCTION_OPERATION_TIMEOUT_MS,
  });

/**
 * Exact application arbitration between the legacy full-text writer and the
 * bounded JS/TS lifecycle. Framework callers retain opaque attachments only.
 */
export class JavaScriptTypeScriptIncrementalSyncProductionCoordinator
  implements
    EditorJavaScriptTypeScriptIncrementalSyncPort,
    JavaScriptTypeScriptIncrementalSyncDocumentLifecyclePort
{
  private readonly attachmentCapabilities = new WeakMap<
    EditorJavaScriptTypeScriptIncrementalSyncAttachment,
    AttachmentCapabilities
  >();
  private readonly blockedPaths = new Map<string, BlockedPath>();
  private readonly channels = new Set<ChannelRecord>();
  private readonly handoffsByPath = new Map<string, number>();
  private readonly lifecycleLeaseCapabilities = new WeakMap<
    JavaScriptTypeScriptIncrementalSyncLifecycleLease,
    LifecycleLeaseCapabilities
  >();
  private readonly pendingClaims = new Map<string, PendingClaim[]>();
  private pendingClaimCount = 0;
  private pendingClaimUtf8Bytes = 0;
  private reconciliationAuthority: JavaScriptTypeScriptIncrementalRuntimeAuthority | null = null;
  private reconciliationRevisionIdentity: object | null = null;
  private readonly savePermitCapabilities = new WeakMap<
    JavaScriptTypeScriptIncrementalSyncSavePermit,
    SavePermitCapabilities
  >();

  constructor(
    private readonly service: JavaScriptTypeScriptIncrementalSyncService,
    private readonly runtime: JavaScriptTypeScriptIncrementalRuntimePort,
    private readonly legacy: JavaScriptTypeScriptIncrementalLegacyPort,
    limits: Partial<JavaScriptTypeScriptIncrementalSyncProductionLimits> = DEFAULT_PRODUCTION_LIMITS,
  ) {
    this.limits = normalizeProductionLimits(limits);
  }

  private readonly limits: JavaScriptTypeScriptIncrementalSyncProductionLimits;

  reconciliationIdentity(): object | null {
    const authority = this.runtime.current();
    if (!authority || !this.runtime.isCurrent(authority)) return null;
    if (
      this.reconciliationAuthority &&
      this.reconciliationRevisionIdentity &&
      sameRuntimeAuthorityRevision(this.reconciliationAuthority, authority)
    ) {
      return this.reconciliationRevisionIdentity;
    }
    this.reconciliationAuthority = authority;
    this.reconciliationRevisionIdentity = Object.freeze({});
    return this.reconciliationRevisionIdentity;
  }

  attach(
    authority: EditorGroupDocumentSessionAuthority,
    source: EditorJavaScriptTypeScriptIncrementalSyncSource,
    isCurrent: () => boolean,
  ): EditorJavaScriptTypeScriptIncrementalSyncAttachment | null {
    const runtimeAuthority = this.runtime.current();
    const languageId = documentLanguageId(source.languageId);
    const liveAuthority = createEditorGroupLiveDocumentAuthority(authority, {
      id: source.modelId,
      incarnation: source.model,
    });
    if (
      !runtimeAuthority ||
      !languageId ||
      !liveAuthority ||
      !validSource(source) ||
      !safeCurrent(isCurrent) ||
      !this.runtime.isCurrent(runtimeAuthority) ||
      !editorGroupDocumentSessionWorkspaceMatches(authority, runtimeAuthority.rootPath)
    ) {
      return null;
    }
    this.pruneStaleChannels();
    const existingChannel = this.findChannel(
      runtimeAuthority.rootPath,
      authority.path,
      source.model,
    );
    if (!existingChannel && this.channels.size >= MAX_PRODUCTION_CHANNELS) {
      return null;
    }
    const oversized =
      source.utf16Length > MAX_JAVASCRIPT_TYPESCRIPT_INCREMENTAL_LSP_INITIAL_UTF16_UNITS;
    const existingCapabilities = existingChannel ? this.firstCapabilities(existingChannel) : null;
    const degraded = oversized || existingCapabilities?.state === "degraded";
    const initialText =
      degraded || existingChannel ? null : safeCapture(source.captureCurrentContent);
    if (
      (!degraded && !existingChannel && initialText === null) ||
      (initialText !== null && initialText.length !== source.utf16Length) ||
      !safeCurrent(isCurrent) ||
      !this.runtime.isCurrent(runtimeAuthority)
    ) {
      return null;
    }

    const channel =
      existingChannel ?? this.channelFor(runtimeAuthority.rootPath, authority.path, source.model);
    const attachment = Object.freeze({
      kind: "editor-javascript-typescript-incremental-sync-attachment" as const,
      semanticMode: degraded ? ("degraded-large-file" as const) : ("incremental" as const),
    });
    const capabilities: AttachmentCapabilities = {
      binding: null,
      channel,
      fallbackPublicationInProgress: false,
      isCurrent,
      pendingEvents: [],
      pendingEventUtf8Bytes: 0,
      released: false,
      runtimeAuthority,
      source,
      state: degraded ? "degraded" : "opening",
    };
    channel.attachments.add(attachment);
    this.attachmentCapabilities.set(attachment, capabilities);
    if (!degraded) {
      this.beginHandoff(authority.path);
      void this.establish(attachment, capabilities, source, languageId, liveAuthority, initialText);
    }
    return attachment;
  }

  observe(
    attachment: EditorJavaScriptTypeScriptIncrementalSyncAttachment,
    event: IncrementalDocumentContentEvent,
  ): EditorLiveEditArbitrationReceipt {
    const capabilities = this.currentAttachment(attachment, true);
    if (!capabilities) {
      return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
    }
    if (capabilities.state === "blocked") {
      return AUTHORITATIVE_EDITOR_LIVE_EDIT;
    }
    if (capabilities.state === "fallback-pending") {
      capabilities.channel.lastObservedRevision = Math.max(
        capabilities.channel.lastObservedRevision,
        event.versionId,
      );
      if (this.publishLegacyFallback(capabilities)) {
        this.closeLocalChannel(capabilities.channel);
        void this.restoreLegacyIfUnowned(capabilities.channel, capabilities.runtimeAuthority);
      }
      // This exact channel retains ownership until its current full projection
      // is admitted. Returning legacy-required here could race a second writer.
      return AUTHORITATIVE_EDITOR_LIVE_EDIT;
    }
    if (capabilities.state === "degraded") {
      capabilities.channel.lastObservedRevision = Math.max(
        capabilities.channel.lastObservedRevision,
        event.versionId,
      );
      return this.currentAttachment(attachment, true) === capabilities
        ? AUTHORITATIVE_EDITOR_LIVE_EDIT
        : LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
    }
    const ownsFallback = typeof capabilities.source.publishLegacyFallback === "function";
    const claims = this.pendingClaims.get(capabilities.channel.path) ?? [];
    const eventUtf8Bytes = incrementalEventUtf8Bytes(
      event,
      Math.min(this.limits.maxPendingClaimUtf8BytesPerPath, this.limits.maxPendingOpeningUtf8Bytes),
    );
    const claimUtf8Bytes = claims.reduce((total, claim) => total + claim.utf8Bytes, 0);
    if (
      !ownsFallback &&
      (eventUtf8Bytes === null ||
        claims.length >= this.limits.maxPendingClaimsPerPath ||
        this.pendingClaimCount >= this.limits.maxPendingClaimsTotal ||
        claimUtf8Bytes + eventUtf8Bytes > this.limits.maxPendingClaimUtf8BytesPerPath ||
        this.pendingClaimUtf8Bytes + eventUtf8Bytes > this.limits.maxPendingClaimUtf8BytesTotal)
    ) {
      this.blockOverflowRevision(capabilities, event.versionId);
      return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
    }
    if (
      capabilities.state !== "open" &&
      (eventUtf8Bytes === null ||
        capabilities.pendingEvents.length >= this.limits.maxPendingOpeningEvents ||
        capabilities.pendingEventUtf8Bytes + eventUtf8Bytes >
          this.limits.maxPendingOpeningUtf8Bytes)
    ) {
      if (!ownsFallback) {
        this.blockOverflowRevision(capabilities, event.versionId);
        return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
      }
      const deferred = deferredArbitration();
      void this.retireOverflowChannel(capabilities, event.versionId).then(deferred.resolve, () =>
        deferred.resolve(blockedArbitrationForRevision(event.versionId)),
      );
      void deferred.promise.then((settlement) =>
        this.settleArbitrationOwnership(capabilities, settlement),
      );
      return AUTHORITATIVE_EDITOR_LIVE_EDIT;
    }

    let decision: Promise<JavaScriptTypeScriptIncrementalSyncArbitration>;
    try {
      if (capabilities.state === "open" && capabilities.binding) {
        decision = this.service.acceptChange(capabilities.binding, event);
      } else {
        const deferred = deferredArbitration();
        capabilities.pendingEvents.push({ event, resolve: deferred.resolve });
        capabilities.pendingEventUtf8Bytes += eventUtf8Bytes ?? 0;
        decision = deferred.promise;
      }
    } catch {
      return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
    }
    capabilities.channel.lastObservedRevision = Math.max(
      capabilities.channel.lastObservedRevision,
      event.versionId,
    );
    if (ownsFallback) {
      void decision.then((settlement) => this.settleArbitrationOwnership(capabilities, settlement));
      return this.currentAttachment(attachment, true) === capabilities
        ? AUTHORITATIVE_EDITOR_LIVE_EDIT
        : LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
    }
    const claim: PendingClaim = {
      authority: capabilities.runtimeAuthority,
      blockingRetirement: false,
      channel: capabilities.channel,
      consumed: false,
      decision,
      revision: event.versionId,
      utf8Bytes: eventUtf8Bytes ?? 0,
    };
    claims.push(claim);
    this.pendingClaimCount += 1;
    this.pendingClaimUtf8Bytes += claim.utf8Bytes;
    this.pendingClaims.set(capabilities.channel.path, claims);
    void decision.then((settlement) => this.settleArbitrationOwnership(capabilities, settlement));
    void decision.finally(() => this.removeSettledClaim(capabilities.channel.path, claim));
    return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
  }

  claimLegacyChange(path: string): JavaScriptTypeScriptIncrementalLegacyClaim | null {
    const claims = this.pendingClaims.get(path) ?? [];
    const currentClaims = claims.filter((candidate) => this.isClaimCurrent(candidate));
    const removedClaims = claims.filter((candidate) => !currentClaims.includes(candidate));
    this.pendingClaimCount -= removedClaims.length;
    this.pendingClaimUtf8Bytes -= removedClaims.reduce(
      (total, claim) => total + claim.utf8Bytes,
      0,
    );
    if (currentClaims.length > 0) this.pendingClaims.set(path, currentClaims);
    else this.pendingClaims.delete(path);
    const claim = [...currentClaims].reverse().find((candidate) => !candidate.consumed);
    if (!claim) return null;
    claim.consumed = true;
    return Object.freeze({
      revision: claim.revision,
      suppressLegacy: async () => {
        const decision = await claim.decision;
        return (
          decision.status !== "legacy-fallback" ||
          !this.runtime.isCurrent(claim.authority) ||
          this.ownsLifecycle(claim.channel.path)
        );
      },
    });
  }

  requestLifecycleLease(path: string): JavaScriptTypeScriptIncrementalSyncLifecycleLease | null {
    const attachmentCapabilities = this.currentCapabilitiesForPath(path);
    if (!attachmentCapabilities) return null;
    const attachment = this.attachmentForCapabilities(attachmentCapabilities);
    if (!attachment) return null;
    const lease = Object.freeze({
      kind: "javascript-typescript-incremental-sync-lifecycle-lease" as const,
    });
    this.lifecycleLeaseCapabilities.set(lease, {
      attachment,
      attachmentCapabilities,
      binding: attachmentCapabilities.binding,
      channel: attachmentCapabilities.channel,
      runtimeAuthority: attachmentCapabilities.runtimeAuthority,
    });
    return lease;
  }

  isLeaseCurrent(lease: JavaScriptTypeScriptIncrementalSyncLifecycleLease): boolean {
    return this.currentLifecycleLease(lease) !== null;
  }

  async drainBeforeSave(
    lease: JavaScriptTypeScriptIncrementalSyncLifecycleLease,
  ): Promise<boolean> {
    const leaseCapabilities = this.currentLifecycleLease(lease);
    const capabilities = leaseCapabilities?.attachmentCapabilities ?? null;
    if (
      !leaseCapabilities ||
      !capabilities ||
      capabilities.state !== "open" ||
      !leaseCapabilities.binding
    ) {
      return false;
    }
    const revision = capabilities.channel.lastObservedRevision;
    if (!revision) return true;
    const result = await this.service.drainBeforeSave(leaseCapabilities.binding, revision);
    return (
      this.currentLifecycleLease(lease) === leaseCapabilities &&
      result.status === "incremental-accepted" &&
      result.revision === revision
    );
  }

  async prepareSave(
    lease: JavaScriptTypeScriptIncrementalSyncLifecycleLease,
  ): Promise<JavaScriptTypeScriptIncrementalSyncPreparedSave | null> {
    const leaseCapabilities = this.currentLifecycleLease(lease);
    if (!leaseCapabilities?.binding) return null;
    const revision = leaseCapabilities.channel.lastObservedRevision;
    if (revision > 0 && !(await this.drainBeforeSave(lease))) {
      return null;
    }
    if (this.currentLifecycleLease(lease) !== leaseCapabilities) return null;
    const content = safeCapture(
      leaseCapabilities.attachmentCapabilities.source.captureCurrentContent,
    );
    if (content === null || this.currentLifecycleLease(lease) !== leaseCapabilities) {
      return null;
    }
    const permit = Object.freeze({
      kind: "javascript-typescript-incremental-sync-save-permit" as const,
    });
    this.savePermitCapabilities.set(permit, {
      content,
      consumed: false,
      lease,
      leaseCapabilities,
      revision,
    });
    return Object.freeze({ content, permit, revision });
  }

  confirmSave(permit: JavaScriptTypeScriptIncrementalSyncSavePermit): boolean {
    const capabilities = this.savePermitCapabilities.get(permit);
    if (!capabilities || capabilities.consumed || !this.savePermitIsCurrent(capabilities)) {
      return false;
    }
    capabilities.consumed = true;
    return true;
  }

  isSavePermitCurrent(permit: JavaScriptTypeScriptIncrementalSyncSavePermit): boolean {
    const capabilities = this.savePermitCapabilities.get(permit);
    return capabilities ? this.savePermitIsCurrent(capabilities) : false;
  }

  ownsLifecycle(path: string): boolean {
    const blocked = this.blockedPaths.get(path);
    if (blocked && this.runtime.isCurrent(blocked.authority)) return true;
    if (blocked) this.blockedPaths.delete(path);
    return (
      (this.handoffsByPath.get(path) ?? 0) > 0 || this.currentCapabilitiesForPath(path) !== null
    );
  }

  async fallbackToLegacy(lease: JavaScriptTypeScriptIncrementalSyncLifecycleLease): Promise<void> {
    const leaseCapabilities = this.currentLifecycleLease(lease);
    const capabilities = leaseCapabilities?.attachmentCapabilities ?? null;
    if (!leaseCapabilities?.binding || !capabilities) return;
    capabilities.channel.retired = true;
    this.removeClaimsForChannel(capabilities.channel);
    const result = await this.service.closeDocument(leaseCapabilities.binding);
    if (!this.lifecycleLeaseSettlementStillExact(lease, leaseCapabilities)) return;
    this.settleCloseResult(capabilities.channel, capabilities.runtimeAuthority, result, true);
  }

  async closeDocument(lease: JavaScriptTypeScriptIncrementalSyncLifecycleLease): Promise<boolean> {
    const leaseCapabilities = this.currentLifecycleLease(lease);
    const capabilities = leaseCapabilities?.attachmentCapabilities ?? null;
    if (!leaseCapabilities || !capabilities) return false;
    capabilities.channel.allowLegacyRestore = false;
    capabilities.channel.retired = true;
    this.removeClaimsForChannel(capabilities.channel);
    if (!leaseCapabilities.binding) {
      this.closeLocalChannel(capabilities.channel);
      return true;
    }
    const result = await this.service.closeDocument(leaseCapabilities.binding);
    if (!this.lifecycleLeaseSettlementStillExact(lease, leaseCapabilities)) return false;
    this.settleCloseResult(capabilities.channel, capabilities.runtimeAuthority, result, false);
    return true;
  }

  async closeRoot(rootPath: string): Promise<void> {
    const channels = [...this.channels].filter((channel) => channel.rootPath === rootPath);
    for (const channel of channels) {
      channel.allowLegacyRestore = false;
      channel.retired = true;
      this.removeClaimsForChannel(channel);
      const capabilities = this.firstCapabilities(channel);
      if (capabilities?.binding) {
        const result = await this.service.closeDocument(capabilities.binding);
        this.settleCloseResult(channel, capabilities.runtimeAuthority, result, false);
      } else {
        this.closeLocalChannel(channel);
      }
    }
  }

  async release(attachment: EditorJavaScriptTypeScriptIncrementalSyncAttachment): Promise<void> {
    const capabilities = this.attachmentCapabilities.get(attachment);
    if (!capabilities || capabilities.released) return;
    capabilities.released = true;
    capabilities.channel.attachments.delete(attachment);
    if (!capabilities.binding) {
      if (capabilities.channel.attachments.size === 0 && capabilities.state !== "opening") {
        this.closeLocalChannel(capabilities.channel);
      }
      return;
    }
    const result = await this.service.release(capabilities.binding);
    if (result.status === "released" && result.channel === "retained") return;
    this.settleCloseResult(
      capabilities.channel,
      capabilities.runtimeAuthority,
      result,
      !capabilities.channel.retired,
    );
  }

  private async establish(
    attachment: EditorJavaScriptTypeScriptIncrementalSyncAttachment,
    capabilities: AttachmentCapabilities,
    source: EditorJavaScriptTypeScriptIncrementalSyncSource,
    languageId: JavaScriptTypeScriptDocumentLanguageId,
    liveAuthority: LiveDocumentAuthority,
    initialText: string | null,
  ): Promise<void> {
    const { channel, runtimeAuthority } = capabilities;
    try {
      await withDeadline(
        this.ensureLegacyHandoff(channel, runtimeAuthority),
        this.limits.operationTimeoutMs,
      );
    } catch {
      this.endHandoff(channel.path);
      capabilities.state = "blocked";
      this.blockedPaths.set(channel.path, { authority: runtimeAuthority });
      this.failOpening(capabilities, "blocked", "close-uncertain");
      return;
    }
    if (!this.isOpeningCurrent(attachment, capabilities)) {
      this.endHandoff(channel.path);
      this.failOpening(capabilities, "legacy-fallback", "authority-stale");
      this.closeLocalChannel(channel);
      await this.restoreLegacyIfUnowned(channel, runtimeAuthority);
      return;
    }

    let result: JavaScriptTypeScriptIncrementalSyncOpenResult;
    try {
      result = await this.service.open({
        alternativeVersionId: source.alternativeVersionId,
        authority: {
          documentIncarnation: incarnationToken(liveAuthority.documentIncarnation),
          expectedSessionId: runtimeAuthority.sessionId,
          ownerGeneration: liveAuthority.ownerGeneration,
          ownerIncarnation: incarnationToken(liveAuthority.ownerIncarnation),
          ownerKey: liveAuthority.ownerKey,
          path: channel.path,
          rootPath: channel.rootPath,
          syncGeneration: runtimeAuthority.syncGeneration,
        },
        capability: runtimeAuthority.capability,
        initialText,
        isCurrent: () => this.isAttachmentCurrent(attachment, capabilities),
        languageId,
        model: source.model,
        snapshotReader: {
          getUtf16Length: () => safeLength(source.currentUtf16Length),
          read: () => {
            const snapshot = safeCapture(source.captureCurrentContent);
            if (snapshot === null) {
              throw new Error("Exact editor snapshot is no longer available.");
            }
            return snapshot;
          },
        },
        utf16Length: source.utf16Length,
        versionId: source.versionId,
      });
    } catch {
      result = { reason: "close-uncertain", status: "blocked" };
    }
    this.endHandoff(channel.path);

    if (result.status === "incremental" && this.isOpeningCurrent(attachment, capabilities)) {
      capabilities.binding = result.binding;
      capabilities.state = "open";
      this.drainOpeningEvents(capabilities);
      return;
    }
    if (result.status === "incremental") {
      const release = await this.service.release(result.binding);
      if (release.status === "blocked") {
        this.failOpening(capabilities, "blocked", "close-uncertain");
      } else if (release.status === "released" && release.channel === "retained") {
        capabilities.state = "blocked";
        for (const pending of capabilities.pendingEvents.splice(0)) {
          pending.resolve({
            reason: "shared-lifecycle",
            revision: pending.event.versionId,
            status: "suppressed",
          });
        }
      } else {
        this.failOpening(
          capabilities,
          "legacy-fallback",
          release.status === "legacy-fallback" ? release.reason : "authority-stale",
        );
      }
      this.settleCloseResult(channel, runtimeAuthority, release, true);
      return;
    }
    if (result.status === "blocked") {
      capabilities.state = "blocked";
      this.blockedPaths.set(channel.path, { authority: runtimeAuthority });
      this.failOpening(capabilities, "blocked", "close-uncertain");
      return;
    }
    if (result.status === "suppressed") {
      capabilities.state = "blocked";
      this.blockedPaths.set(channel.path, { authority: runtimeAuthority });
      for (const pending of capabilities.pendingEvents.splice(0)) {
        pending.resolve({
          reason: "shared-lifecycle",
          revision: pending.event.versionId,
          status: "suppressed",
        });
      }
      return;
    }
    this.failOpening(capabilities, "legacy-fallback", result.reason);
    this.closeLocalChannel(channel);
    await this.restoreLegacyIfUnowned(channel, runtimeAuthority);
  }

  private drainOpeningEvents(capabilities: AttachmentCapabilities): void {
    const binding = capabilities.binding;
    if (!binding) return;
    capabilities.pendingEventUtf8Bytes = 0;
    for (const pending of capabilities.pendingEvents.splice(0)) {
      void this.service.acceptChange(binding, pending.event).then(pending.resolve);
    }
  }

  private failOpening(
    capabilities: AttachmentCapabilities,
    status: "blocked" | "legacy-fallback",
    reason: "close-uncertain" | JavaScriptTypeScriptIncrementalSyncFallbackReason,
  ): void {
    capabilities.state = status === "blocked" ? "blocked" : "closed";
    capabilities.pendingEventUtf8Bytes = 0;
    for (const pending of capabilities.pendingEvents.splice(0)) {
      if (status === "blocked") {
        pending.resolve({
          reason: "close-uncertain",
          revision: pending.event.versionId,
          status,
        });
      } else {
        pending.resolve({
          reason: reason === "close-uncertain" ? "gateway-rejected" : reason,
          revision: pending.event.versionId,
          status,
        });
      }
    }
  }

  private settleCloseResult(
    channel: ChannelRecord,
    runtimeAuthority: JavaScriptTypeScriptIncrementalRuntimeAuthority,
    result: JavaScriptTypeScriptIncrementalSyncReleaseResult,
    restoreLegacy: boolean,
  ): void {
    if (result.status === "blocked") {
      this.blockedPaths.set(channel.path, { authority: runtimeAuthority });
      this.closeLocalChannel(channel);
      return;
    }
    this.closeLocalChannel(channel);
    if (
      restoreLegacy &&
      (result.status === "legacy-fallback" ||
        (result.status === "released" && result.channel === "closed"))
    ) {
      void this.restoreLegacyIfUnowned(channel, runtimeAuthority);
    }
  }

  private settleArbitrationOwnership(
    capabilities: AttachmentCapabilities,
    settlement: JavaScriptTypeScriptIncrementalSyncArbitration,
  ): void {
    if (capabilities.channel.retired) return;
    if (settlement.status === "blocked") {
      this.publishLegacyFallback(capabilities);
      this.blockedPaths.set(capabilities.channel.path, {
        authority: capabilities.runtimeAuthority,
      });
      this.closeLocalChannel(capabilities.channel);
      return;
    }
    if (settlement.status !== "legacy-fallback") return;
    if (capabilities.source.publishLegacyFallback) {
      capabilities.state = "fallback-pending";
      if (!this.publishLegacyFallback(capabilities)) {
        return;
      }
    }
    this.closeLocalChannel(capabilities.channel);
    void this.restoreLegacyIfUnowned(capabilities.channel, capabilities.runtimeAuthority);
  }

  private publishLegacyFallback(capabilities: AttachmentCapabilities): boolean {
    const publish = capabilities.source.publishLegacyFallback;
    if (
      !publish ||
      capabilities.fallbackPublicationInProgress ||
      !this.currentAttachmentForSource(capabilities)
    ) {
      return false;
    }
    const beforeLength = safeLength(capabilities.source.currentUtf16Length);
    if (beforeLength === null) return false;
    const content = safeCapture(capabilities.source.captureCurrentContent);
    if (
      content === null ||
      content.length !== beforeLength ||
      !this.currentAttachmentForSource(capabilities)
    ) {
      return false;
    }
    capabilities.fallbackPublicationInProgress = true;
    try {
      return (
        publish(content) === true &&
        this.currentAttachmentForSource(capabilities) &&
        safeLength(capabilities.source.currentUtf16Length) === beforeLength
      );
    } catch {
      return false;
    } finally {
      capabilities.fallbackPublicationInProgress = false;
    }
  }

  private currentAttachmentForSource(capabilities: AttachmentCapabilities): boolean {
    if (capabilities.channel.retired) return false;
    for (const attachment of capabilities.channel.attachments) {
      if (this.currentAttachment(attachment, true) === capabilities) return true;
    }
    return false;
  }

  private blockOverflowRevision(capabilities: AttachmentCapabilities, revision: number): void {
    const displaced = this.pendingClaims.get(capabilities.channel.path) ?? [];
    this.pendingClaimCount -= displaced.length;
    this.pendingClaimUtf8Bytes -= displaced.reduce(
      (total, pending) => total + pending.utf8Bytes,
      0,
    );
    this.pendingClaims.delete(capabilities.channel.path);
    const deferred = deferredArbitration();
    const claim: PendingClaim = {
      authority: capabilities.runtimeAuthority,
      blockingRetirement: true,
      channel: capabilities.channel,
      consumed: false,
      decision: deferred.promise,
      revision,
      utf8Bytes: 0,
    };
    this.pendingClaims.set(capabilities.channel.path, [claim]);
    this.pendingClaimCount += 1;
    capabilities.channel.lastObservedRevision = Math.max(
      capabilities.channel.lastObservedRevision,
      revision,
    );
    void this.retireOverflowChannel(capabilities, revision).then(deferred.resolve, () =>
      deferred.resolve(blockedArbitrationForRevision(revision)),
    );
    void deferred.promise.finally(() => this.removeSettledClaim(capabilities.channel.path, claim));
  }

  private async retireOverflowChannel(
    capabilities: AttachmentCapabilities,
    revision: number,
  ): Promise<JavaScriptTypeScriptIncrementalSyncArbitration> {
    const { channel, runtimeAuthority } = capabilities;
    channel.retired = true;
    if (!capabilities.binding) {
      try {
        if (channel.legacyHandoff) {
          await withDeadline(channel.legacyHandoff, this.limits.operationTimeoutMs);
        }
      } catch {
        this.endHandoff(channel.path);
        this.blockedPaths.set(channel.path, { authority: runtimeAuthority });
        this.failOpening(capabilities, "blocked", "close-uncertain");
        this.closeLocalChannel(channel, true);
        return blockedArbitrationForRevision(revision);
      }
      this.endHandoff(channel.path);
      this.failOpening(capabilities, "legacy-fallback", "pending-limit");
      this.closeLocalChannel(channel, true);
      const restored = await this.restoreLegacyIfUnowned(channel, runtimeAuthority);
      return restored
        ? legacyArbitrationForRevision(revision)
        : blockedArbitrationForRevision(revision);
    }
    let result: JavaScriptTypeScriptIncrementalSyncReleaseResult;
    try {
      result = await withDeadline(
        this.service.closeDocument(capabilities.binding),
        this.limits.operationTimeoutMs,
      );
    } catch {
      channel.allowLegacyRestore = false;
      this.blockedPaths.set(channel.path, { authority: runtimeAuthority });
      this.closeLocalChannel(channel, true);
      return blockedArbitrationForRevision(revision);
    }
    const exact = this.runtime.isCurrent(runtimeAuthority);
    if (!exact || !closeResultAdmitsLegacy(result)) {
      this.settleCloseResult(channel, runtimeAuthority, result, false);
      return blockedArbitrationForRevision(revision);
    }
    this.closeLocalChannel(channel, true);
    const restored = await this.restoreLegacyIfUnowned(channel, runtimeAuthority);
    return restored
      ? legacyArbitrationForRevision(revision)
      : blockedArbitrationForRevision(revision);
  }

  private channelFor(rootPath: string, path: string, model: object): ChannelRecord {
    const existing = this.findChannel(rootPath, path, model);
    if (existing) return existing;
    const channel: ChannelRecord = {
      allowLegacyRestore: true,
      attachments: new Set(),
      lastObservedRevision: 0,
      legacyHandoff: null,
      legacyRestore: null,
      model,
      path,
      retired: false,
      rootPath,
    };
    this.channels.add(channel);
    return channel;
  }

  private currentAttachment(
    attachment: EditorJavaScriptTypeScriptIncrementalSyncAttachment,
    allowOpening = false,
  ): AttachmentCapabilities | null {
    const capabilities = this.attachmentCapabilities.get(attachment);
    return capabilities &&
      !capabilities.released &&
      !capabilities.channel.retired &&
      (capabilities.state === "open" ||
        (allowOpening &&
          (capabilities.state === "opening" ||
            capabilities.state === "blocked" ||
            capabilities.state === "degraded" ||
            capabilities.state === "fallback-pending"))) &&
      this.runtime.isCurrent(capabilities.runtimeAuthority) &&
      safeCurrent(capabilities.isCurrent)
      ? capabilities
      : null;
  }

  private currentCapabilitiesForPath(path: string): AttachmentCapabilities | null {
    for (const channel of [...this.channels].reverse()) {
      if (channel.path !== path || channel.retired) continue;
      for (const attachment of channel.attachments) {
        const capabilities = this.currentAttachment(attachment, true);
        if (capabilities && capabilities.state !== "degraded") return capabilities;
      }
    }
    return null;
  }

  private currentLifecycleLease(
    lease: JavaScriptTypeScriptIncrementalSyncLifecycleLease,
  ): LifecycleLeaseCapabilities | null {
    const capabilities = this.lifecycleLeaseCapabilities.get(lease);
    return capabilities && this.lifecycleLeaseStillExact(capabilities) ? capabilities : null;
  }

  private lifecycleLeaseStillExact(capabilities: LifecycleLeaseCapabilities): boolean {
    return (
      this.channels.has(capabilities.channel) &&
      !capabilities.channel.retired &&
      this.runtime.isCurrent(capabilities.runtimeAuthority) &&
      this.attachmentCapabilities.get(capabilities.attachment) ===
        capabilities.attachmentCapabilities &&
      !capabilities.attachmentCapabilities.released &&
      (capabilities.attachmentCapabilities.state === "open" ||
        capabilities.attachmentCapabilities.state === "opening") &&
      safeCurrent(capabilities.attachmentCapabilities.isCurrent) &&
      capabilities.attachmentCapabilities.runtimeAuthority === capabilities.runtimeAuthority &&
      capabilities.attachmentCapabilities.channel === capabilities.channel &&
      capabilities.attachmentCapabilities.binding === capabilities.binding
    );
  }

  private lifecycleLeaseSettlementStillExact(
    lease: JavaScriptTypeScriptIncrementalSyncLifecycleLease,
    capabilities: LifecycleLeaseCapabilities,
  ): boolean {
    const replacement = this.currentCapabilitiesForPath(capabilities.channel.path);
    return (
      this.lifecycleLeaseCapabilities.get(lease) === capabilities &&
      this.runtime.isCurrent(capabilities.runtimeAuthority) &&
      this.attachmentCapabilities.get(capabilities.attachment) ===
        capabilities.attachmentCapabilities &&
      !capabilities.attachmentCapabilities.released &&
      safeCurrent(capabilities.attachmentCapabilities.isCurrent) &&
      capabilities.attachmentCapabilities.runtimeAuthority === capabilities.runtimeAuthority &&
      capabilities.attachmentCapabilities.channel === capabilities.channel &&
      capabilities.attachmentCapabilities.binding === capabilities.binding &&
      (!replacement || replacement === capabilities.attachmentCapabilities)
    );
  }

  private savePermitIsCurrent(capabilities: SavePermitCapabilities): boolean {
    return (
      this.currentLifecycleLease(capabilities.lease) === capabilities.leaseCapabilities &&
      capabilities.leaseCapabilities.channel.lastObservedRevision === capabilities.revision
    );
  }

  private firstCapabilities(channel: ChannelRecord): AttachmentCapabilities | null {
    for (const attachment of channel.attachments) {
      const capabilities = this.attachmentCapabilities.get(attachment);
      if (capabilities) return capabilities;
    }
    return null;
  }

  private attachmentForCapabilities(
    capabilities: AttachmentCapabilities,
  ): EditorJavaScriptTypeScriptIncrementalSyncAttachment | null {
    for (const attachment of capabilities.channel.attachments) {
      if (this.attachmentCapabilities.get(attachment) === capabilities) return attachment;
    }
    return null;
  }

  private isOpeningCurrent(
    attachment: EditorJavaScriptTypeScriptIncrementalSyncAttachment,
    capabilities: AttachmentCapabilities,
  ): boolean {
    return this.isAttachmentCurrent(attachment, capabilities) && capabilities.state === "opening";
  }

  private isAttachmentCurrent(
    attachment: EditorJavaScriptTypeScriptIncrementalSyncAttachment,
    capabilities: AttachmentCapabilities,
  ): boolean {
    return (
      this.attachmentCapabilities.get(attachment) === capabilities &&
      (capabilities.state === "opening" || capabilities.state === "open") &&
      !capabilities.released &&
      !capabilities.channel.retired &&
      this.runtime.isCurrent(capabilities.runtimeAuthority) &&
      safeCurrent(capabilities.isCurrent)
    );
  }

  private closeLocalChannel(channel: ChannelRecord, preserveClaims = false): void {
    for (const attachment of channel.attachments) {
      const capabilities = this.attachmentCapabilities.get(attachment);
      if (capabilities) {
        capabilities.released = true;
        capabilities.state = "closed";
      }
    }
    channel.attachments.clear();
    this.channels.delete(channel);
    channel.legacyHandoff = null;
    if (!preserveClaims) this.removeClaimsForChannel(channel);
  }

  private async restoreLegacyIfUnowned(
    channel: ChannelRecord,
    authority: JavaScriptTypeScriptIncrementalRuntimeAuthority,
  ): Promise<boolean> {
    if (
      !channel.allowLegacyRestore ||
      !this.runtime.isCurrent(authority) ||
      this.ownsLifecycle(channel.path)
    ) {
      return false;
    }
    if (channel.legacyRestore) return channel.legacyRestore;
    channel.legacyRestore = (async () => {
      try {
        await withDeadline(
          this.legacy.open(this.legacyRequest(channel, authority, "open")),
          this.limits.operationTimeoutMs,
        );
        return true;
      } catch {
        // A timed-out open may still settle later at the adapter boundary.
        // Revoke its exact request guard so that late work cannot resurrect
        // legacy ownership after this bounded attempt failed closed.
        channel.allowLegacyRestore = false;
        // Existing legacy orchestration owns user-facing error reporting.
        return false;
      }
    })();
    return channel.legacyRestore;
  }

  private ensureLegacyHandoff(
    channel: ChannelRecord,
    authority: JavaScriptTypeScriptIncrementalRuntimeAuthority,
  ): Promise<void> {
    if (channel.legacyHandoff) return channel.legacyHandoff;
    const promise = this.legacy.close(this.legacyRequest(channel, authority, "close"));
    channel.legacyHandoff = promise;
    return promise;
  }

  private legacyRequest(
    channel: ChannelRecord,
    authority: JavaScriptTypeScriptIncrementalRuntimeAuthority,
    operation: "close" | "open",
  ): JavaScriptTypeScriptIncrementalLegacyRequest {
    return Object.freeze({
      authority,
      isCurrent: () =>
        this.runtime.isCurrent(authority) &&
        channel.rootPath === authority.rootPath &&
        (operation !== "open" || channel.allowLegacyRestore) &&
        (this.currentCapabilitiesForPath(channel.path) === null ||
          this.currentCapabilitiesForPath(channel.path)?.channel === channel),
      operation,
      path: channel.path,
    });
  }

  private beginHandoff(path: string): void {
    this.handoffsByPath.set(path, (this.handoffsByPath.get(path) ?? 0) + 1);
  }

  private endHandoff(path: string): void {
    const remaining = (this.handoffsByPath.get(path) ?? 0) - 1;
    if (remaining > 0) this.handoffsByPath.set(path, remaining);
    else this.handoffsByPath.delete(path);
  }

  private removeSettledClaim(path: string, claim: PendingClaim): void {
    if (!claim.consumed) return;
    const claims = this.pendingClaims.get(path);
    if (!claims) return;
    const index = claims.indexOf(claim);
    if (index >= 0) {
      claims.splice(index, 1);
      this.pendingClaimCount -= 1;
      this.pendingClaimUtf8Bytes -= claim.utf8Bytes;
    }
    if (claims.length === 0) this.pendingClaims.delete(path);
  }

  private removeClaimsForChannel(channel: ChannelRecord): void {
    const claims = this.pendingClaims.get(channel.path);
    if (!claims) return;
    const remaining = claims.filter((claim) => claim.channel !== channel);
    const removed = claims.filter((claim) => claim.channel === channel);
    this.pendingClaimCount -= removed.length;
    this.pendingClaimUtf8Bytes -= removed.reduce((total, claim) => total + claim.utf8Bytes, 0);
    if (remaining.length > 0) this.pendingClaims.set(channel.path, remaining);
    else this.pendingClaims.delete(channel.path);
  }

  private isClaimCurrent(claim: PendingClaim): boolean {
    if (!this.runtime.isCurrent(claim.authority)) return false;
    if (claim.blockingRetirement) return true;
    if (claim.channel.retired) return false;
    for (const attachment of claim.channel.attachments) {
      if (this.currentAttachment(attachment, true)) return true;
    }
    return false;
  }

  private findChannel(rootPath: string, path: string, model: object): ChannelRecord | null {
    return (
      [...this.channels].find(
        (channel) =>
          !channel.retired &&
          channel.rootPath === rootPath &&
          channel.path === path &&
          channel.model === model,
      ) ?? null
    );
  }

  private pruneStaleChannels(): void {
    for (const channel of [...this.channels]) {
      const capabilities = this.firstCapabilities(channel);
      if (capabilities && this.runtime.isCurrent(capabilities.runtimeAuthority)) continue;
      this.closeLocalChannel(channel);
    }
    for (const [path, blocked] of this.blockedPaths) {
      if (!this.runtime.isCurrent(blocked.authority)) this.blockedPaths.delete(path);
    }
  }
}

const incarnationTokens = new WeakMap<object, string>();
let nextIncarnationToken = 1;

function incarnationToken(value: object): string {
  const existing = incarnationTokens.get(value);
  if (existing) return existing;
  const token = `editor-session-${nextIncarnationToken++}`;
  incarnationTokens.set(value, token);
  return token;
}

function deferredArbitration(): {
  readonly promise: Promise<JavaScriptTypeScriptIncrementalSyncArbitration>;
  readonly resolve: (decision: JavaScriptTypeScriptIncrementalSyncArbitration) => void;
} {
  let resolve!: (decision: JavaScriptTypeScriptIncrementalSyncArbitration) => void;
  const promise = new Promise<JavaScriptTypeScriptIncrementalSyncArbitration>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function legacyArbitrationForRevision(
  revision: number,
): JavaScriptTypeScriptIncrementalSyncArbitration {
  return Object.freeze({
    reason: "pending-limit",
    revision,
    status: "legacy-fallback",
  });
}

function blockedArbitrationForRevision(
  revision: number,
): JavaScriptTypeScriptIncrementalSyncArbitration {
  return Object.freeze({
    reason: "close-uncertain",
    revision,
    status: "blocked",
  });
}

function closeResultAdmitsLegacy(
  result: JavaScriptTypeScriptIncrementalSyncReleaseResult,
): boolean {
  return (
    result.status === "legacy-fallback" ||
    (result.status === "released" && result.channel === "closed")
  );
}

function sameRuntimeAuthorityRevision(
  left: JavaScriptTypeScriptIncrementalRuntimeAuthority,
  right: JavaScriptTypeScriptIncrementalRuntimeAuthority,
): boolean {
  return (
    left.rootPath === right.rootPath &&
    left.sessionId === right.sessionId &&
    left.syncGeneration === right.syncGeneration &&
    left.capability.changeKind === right.capability.changeKind &&
    left.capability.openClose === right.capability.openClose &&
    left.capability.save.kind === right.capability.save.kind &&
    (left.capability.save.kind !== "supported" ||
      (right.capability.save.kind === "supported" &&
        left.capability.save.includeText === right.capability.save.includeText))
  );
}

function documentLanguageId(value: string): JavaScriptTypeScriptDocumentLanguageId | null {
  switch (value) {
    case "javascript":
    case "javascriptreact":
    case "typescript":
    case "typescriptreact":
      return value;
    default:
      return null;
  }
}

function validSource(source: EditorJavaScriptTypeScriptIncrementalSyncSource): boolean {
  return (
    isObject(source.model) &&
    typeof source.modelId === "string" &&
    source.modelId.length > 0 &&
    source.modelId.length <= 512 &&
    Number.isSafeInteger(source.versionId) &&
    source.versionId > 0 &&
    Number.isSafeInteger(source.alternativeVersionId) &&
    source.alternativeVersionId > 0 &&
    Number.isSafeInteger(source.utf16Length) &&
    source.utf16Length >= 0
  );
}

function safeCapture(capture: () => string | null): string | null {
  try {
    const content = capture();
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}

function safeLength(read: () => number | null): number {
  try {
    const value = read();
    return Number.isSafeInteger(value) && value !== null && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function safeCurrent(isCurrent: () => boolean): boolean {
  try {
    return isCurrent() && isCurrent();
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function normalizeProductionLimits(
  limits: Partial<JavaScriptTypeScriptIncrementalSyncProductionLimits>,
): JavaScriptTypeScriptIncrementalSyncProductionLimits {
  return Object.freeze({
    maxPendingClaimUtf8BytesPerPath: positiveLimit(
      limits.maxPendingClaimUtf8BytesPerPath,
      DEFAULT_PRODUCTION_LIMITS.maxPendingClaimUtf8BytesPerPath,
    ),
    maxPendingClaimUtf8BytesTotal: positiveLimit(
      limits.maxPendingClaimUtf8BytesTotal,
      DEFAULT_PRODUCTION_LIMITS.maxPendingClaimUtf8BytesTotal,
    ),
    maxPendingClaimsPerPath: positiveLimit(
      limits.maxPendingClaimsPerPath,
      DEFAULT_PRODUCTION_LIMITS.maxPendingClaimsPerPath,
    ),
    maxPendingClaimsTotal: positiveLimit(
      limits.maxPendingClaimsTotal,
      DEFAULT_PRODUCTION_LIMITS.maxPendingClaimsTotal,
    ),
    maxPendingOpeningEvents: positiveLimit(
      limits.maxPendingOpeningEvents,
      DEFAULT_PRODUCTION_LIMITS.maxPendingOpeningEvents,
    ),
    maxPendingOpeningUtf8Bytes: positiveLimit(
      limits.maxPendingOpeningUtf8Bytes,
      DEFAULT_PRODUCTION_LIMITS.maxPendingOpeningUtf8Bytes,
    ),
    operationTimeoutMs: positiveLimit(
      limits.operationTimeoutMs,
      DEFAULT_PRODUCTION_LIMITS.operationTimeoutMs,
    ),
  });
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0 ? value : fallback;
}

/** Counts retained inserted text; fixed event overhead is bounded by the count budgets. */
function incrementalEventUtf8Bytes(
  event: IncrementalDocumentContentEvent,
  limit: number,
): number | null {
  if (!Array.isArray(event?.changes)) {
    return null;
  }
  let total = 0;
  for (const change of event.changes) {
    if (typeof change?.text !== "string") {
      return null;
    }
    const receipt = boundedUtf8Length(change.text, limit - total);
    if (receipt.status !== "within-limit") {
      return null;
    }
    total += receipt.bytes;
  }
  return total;
}

async function withDeadline<T>(settlement: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Incremental sync production operation exceeded its deadline.")),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([settlement, timeout]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}
