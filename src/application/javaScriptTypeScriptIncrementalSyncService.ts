import {
  IncrementalDocumentSyncCoordinator,
  type DeferredDocumentSnapshotReader,
} from "./incrementalDocumentSyncCoordinator";
import {
  validDocumentSyncPath,
  type IncrementalDocumentContentEvent,
  type IncrementalDocumentSyncLease,
  type NegotiatedDocumentSyncCapability,
} from "../domain/incrementalDocumentSync";
import {
  boundedDocumentSyncAuthority,
  boundedDocumentSyncIdentityAuthority,
  type BoundedLanguageServerDidOpenReceipt,
  type IncrementalLanguageServerDocumentSyncGateway,
  type JavaScriptTypeScriptDocumentLanguageId,
} from "../domain/incrementalLanguageServerDocumentSync";

const DEFAULT_DEBOUNCE_MS = 25;
const DEFAULT_MAX_CHANNELS = 32;
const DEFAULT_MAX_HOLDERS_PER_MODEL = 16;
const DEFAULT_MAX_PENDING_REVISIONS = 256;
const DEFAULT_MAX_BUSY_RETRIES = 3;
const DEFAULT_GATEWAY_TIMEOUT_MS = 5_000;
const HARD_MAX_DEBOUNCE_MS = 1_000;
const HARD_MAX_BUSY_RETRIES = 10;
const HARD_MAX_CHANNELS = 128;
const HARD_MAX_HOLDERS_PER_MODEL = 16;
const HARD_MAX_PENDING_REVISIONS = 256;
const HARD_MAX_GATEWAY_TIMEOUT_MS = 30_000;

export interface JavaScriptTypeScriptIncrementalSyncAuthority {
  readonly documentIncarnation: string;
  readonly expectedSessionId: number;
  readonly ownerGeneration: number;
  readonly ownerIncarnation: string;
  readonly ownerKey: string;
  readonly path: string;
  readonly rootPath: string;
  readonly syncGeneration: number;
}

export interface JavaScriptTypeScriptIncrementalSyncBinding {
  readonly kind: "javascript-typescript-incremental-sync-binding";
}

export interface JavaScriptTypeScriptIncrementalSyncOpenRequest {
  readonly alternativeVersionId: number;
  readonly authority: JavaScriptTypeScriptIncrementalSyncAuthority;
  readonly capability: NegotiatedDocumentSyncCapability;
  readonly initialText: string | null;
  readonly isCurrent: () => boolean;
  readonly languageId: JavaScriptTypeScriptDocumentLanguageId;
  readonly model: object;
  readonly snapshotReader: DeferredDocumentSnapshotReader;
  readonly utf16Length: number;
  readonly versionId: number;
}

export type JavaScriptTypeScriptIncrementalSyncFallbackReason =
  | "authority-stale"
  | "busy"
  | "closed"
  | "gateway-rejected"
  | "invalid-request"
  | "model-token-exhausted"
  | "pending-limit"
  | "service-limit"
  | "unsupported";

export type JavaScriptTypeScriptIncrementalSyncOpenResult =
  | {
      readonly binding: JavaScriptTypeScriptIncrementalSyncBinding;
      readonly ownership: "incremental-lifecycle";
      readonly status: "incremental";
    }
  | {
      readonly reason: JavaScriptTypeScriptIncrementalSyncFallbackReason;
      readonly status: "legacy-fallback";
    }
  | {
      readonly reason: "close-uncertain";
      readonly status: "blocked";
    }
  | {
      readonly reason: "shared-lifecycle";
      readonly status: "suppressed";
    };

export type JavaScriptTypeScriptIncrementalSyncArbitration =
  | {
      readonly revision: number;
      readonly serverVersion: number;
      readonly status: "incremental-accepted";
    }
  | {
      readonly reason: JavaScriptTypeScriptIncrementalSyncFallbackReason;
      readonly revision: number;
      readonly status: "legacy-fallback";
    }
  | {
      readonly reason: "close-uncertain";
      readonly revision: number;
      readonly status: "blocked";
    }
  | {
      readonly reason: "invalid-event" | "shared-lifecycle";
      readonly revision: number;
      readonly status: "suppressed";
    };

export type JavaScriptTypeScriptIncrementalSyncReleaseResult =
  | { readonly channel: "closed" | "retained"; readonly status: "released" }
  | {
      readonly reason: JavaScriptTypeScriptIncrementalSyncFallbackReason;
      readonly status: "legacy-fallback";
    }
  | {
      readonly reason: "close-uncertain";
      readonly status: "blocked";
    };

export interface JavaScriptTypeScriptIncrementalSyncScheduler {
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface JavaScriptTypeScriptIncrementalSyncServiceOptions {
  readonly debounceMs?: number;
  readonly gatewayTimeoutMs?: number;
  readonly maxBusyRetries?: number;
  readonly maxChannels?: number;
  readonly maxHoldersPerModel?: number;
  readonly maxPendingRevisions?: number;
  readonly scheduler?: JavaScriptTypeScriptIncrementalSyncScheduler;
}

interface BindingRecord {
  readonly channel: SyncChannel;
  readonly isCurrent: () => boolean;
  released: boolean;
}

interface PendingArbitration {
  readonly promise: Promise<JavaScriptTypeScriptIncrementalSyncArbitration>;
  readonly resolve: (result: JavaScriptTypeScriptIncrementalSyncArbitration) => void;
  readonly revision: number;
}

interface SyncChannel {
  readonly authority: JavaScriptTypeScriptIncrementalSyncAuthority;
  readonly bindings: Set<JavaScriptTypeScriptIncrementalSyncBinding>;
  readonly lease: IncrementalDocumentSyncLease;
  readonly model: object;
  readonly modelIncarnation: string;
  readonly revisionArbitrations: Map<number, PendingArbitration>;
  readonly snapshotReader: DeferredDocumentSnapshotReader;
  cancelTimer: (() => void) | null;
  closePromise: Promise<JavaScriptTypeScriptIncrementalSyncReleaseResult> | null;
  failureReason: JavaScriptTypeScriptIncrementalSyncFallbackReason | null;
  lateOpenPending: boolean;
  lateClosePending: boolean;
  lastAcceptedRevision: number;
  lifecycleToken: string | null;
  openPromise: Promise<boolean>;
  pending: PendingArbitration[];
  pumpPromise: Promise<void> | null;
  retirePromise: Promise<boolean> | null;
  settlementPromise: Promise<boolean> | null;
  serverVersion: number;
  state: "opening" | "open" | "closing" | "retiring" | "blocked" | "closed" | "fallback";
}

const DEFAULT_SCHEDULER: JavaScriptTypeScriptIncrementalSyncScheduler = Object.freeze({
  schedule(callback: () => void, delayMs: number) {
    const timer = globalThis.setTimeout(callback, delayMs);
    return () => globalThis.clearTimeout(timer);
  },
});

export class JavaScriptTypeScriptIncrementalSyncService {
  private readonly bindings = new WeakMap<
    JavaScriptTypeScriptIncrementalSyncBinding,
    BindingRecord
  >();
  private readonly channels = new Map<string, SyncChannel>();
  private readonly debounceMs: number;
  private readonly maxBusyRetries: number;
  private readonly maxChannels: number;
  private readonly maxHoldersPerModel: number;
  private readonly maxPendingRevisions: number;
  private readonly gatewayTimeoutMs: number;
  private readonly modelTokens = new WeakMap<object, string>();
  private nextModelToken = 1;
  private readonly predecessorTokens = new Map<string, string>();
  private readonly scheduler: JavaScriptTypeScriptIncrementalSyncScheduler;

  constructor(
    private readonly coordinator: IncrementalDocumentSyncCoordinator,
    private readonly gateway: IncrementalLanguageServerDocumentSyncGateway,
    options: JavaScriptTypeScriptIncrementalSyncServiceOptions = {},
  ) {
    this.debounceMs = validatedOption(
      options.debounceMs,
      DEFAULT_DEBOUNCE_MS,
      0,
      HARD_MAX_DEBOUNCE_MS,
    );
    this.maxBusyRetries = validatedOption(
      options.maxBusyRetries,
      DEFAULT_MAX_BUSY_RETRIES,
      0,
      HARD_MAX_BUSY_RETRIES,
    );
    this.gatewayTimeoutMs = validatedOption(
      options.gatewayTimeoutMs,
      DEFAULT_GATEWAY_TIMEOUT_MS,
      1,
      HARD_MAX_GATEWAY_TIMEOUT_MS,
    );
    this.maxChannels = validatedOption(
      options.maxChannels,
      DEFAULT_MAX_CHANNELS,
      1,
      HARD_MAX_CHANNELS,
    );
    this.maxHoldersPerModel = validatedOption(
      options.maxHoldersPerModel,
      DEFAULT_MAX_HOLDERS_PER_MODEL,
      1,
      HARD_MAX_HOLDERS_PER_MODEL,
    );
    this.maxPendingRevisions = validatedOption(
      options.maxPendingRevisions,
      DEFAULT_MAX_PENDING_REVISIONS,
      1,
      HARD_MAX_PENDING_REVISIONS,
    );
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
  }

  async open(
    request: JavaScriptTypeScriptIncrementalSyncOpenRequest,
  ): Promise<JavaScriptTypeScriptIncrementalSyncOpenResult> {
    if (!validOpenRequest(request)) {
      return legacyOpen("invalid-request");
    }
    if (request.capability.changeKind !== "incremental" || !request.capability.openClose) {
      return legacyOpen("unsupported");
    }
    if (!safeCurrent(request.isCurrent)) {
      return legacyOpen("authority-stale");
    }

    const modelIncarnation = this.modelIncarnation(request.model);
    if (!modelIncarnation) {
      return legacyOpen("model-token-exhausted");
    }
    const key = channelKey(request.authority);
    const existing = this.channels.get(key);
    if (existing) {
      if (existing.state === "blocked") {
        if (existing.authority.expectedSessionId !== request.authority.expectedSessionId) {
          this.finishClosed(existing);
        } else if (!(await this.settleBlocked(existing))) {
          return blockedOpen();
        }
      }
      const currentExisting = this.channels.get(key);
      if (currentExisting) {
        if (
          currentExisting.model === request.model &&
          authoritiesEqual(currentExisting.authority, request.authority) &&
          currentExisting.state !== "closing" &&
          currentExisting.state !== "retiring" &&
          currentExisting.state !== "blocked" &&
          currentExisting.state !== "closed" &&
          currentExisting.state !== "fallback"
        ) {
          return this.join(currentExisting, request.isCurrent);
        }
        if (!(await this.retire(currentExisting, "authority-stale"))) {
          return blockedOpen();
        }
      }
    }
    if (this.channels.size >= this.maxChannels) {
      return legacyOpen("service-limit");
    }
    if (request.initialText === null) {
      return legacyOpen("invalid-request");
    }

    const lease = createLease(request.authority, modelIncarnation);
    const admission = this.coordinator.admit(lease, request.capability, {
      alternativeVersionId: request.alternativeVersionId,
      utf16Length: request.utf16Length,
      versionId: request.versionId,
    });
    if (admission.status !== "admitted") {
      return legacyOpen("service-limit");
    }

    const channel: SyncChannel = {
      authority: Object.freeze({ ...request.authority }),
      bindings: new Set(),
      cancelTimer: null,
      closePromise: null,
      failureReason: null,
      lateOpenPending: false,
      lateClosePending: false,
      lastAcceptedRevision: request.versionId,
      lease,
      lifecycleToken: null,
      model: request.model,
      modelIncarnation,
      openPromise: Promise.resolve(false),
      pending: [],
      pumpPromise: null,
      retirePromise: null,
      settlementPromise: null,
      revisionArbitrations: new Map(),
      serverVersion: 1,
      snapshotReader: request.snapshotReader,
      state: "opening",
    };
    this.channels.set(key, channel);
    const binding = this.createBinding(channel, request.isCurrent);
    channel.openPromise = this.admitOpen(
      channel,
      { ...request, initialText: request.initialText },
      this.predecessorTokens.get(key) ?? null,
    );
    if (!(await channel.openPromise)) {
      if (channel.state === "blocked") return blockedOpen();
      const settled = await this.retire(channel, channel.failureReason ?? "gateway-rejected");
      if (!settled) return blockedOpen();
      return legacyOpen(channel.failureReason ?? "gateway-rejected");
    }
    if (!safeCurrent(request.isCurrent)) {
      const record = this.bindings.get(binding);
      const retained = record ? this.detachBinding(binding, record) : false;
      if (retained) return suppressedOpen();
      return (await this.retire(channel, "authority-stale"))
        ? legacyOpen("authority-stale")
        : blockedOpen();
    }
    return Object.freeze({
      binding,
      ownership: "incremental-lifecycle",
      status: "incremental",
    });
  }

  acceptChange(
    binding: JavaScriptTypeScriptIncrementalSyncBinding,
    event: IncrementalDocumentContentEvent,
  ): Promise<JavaScriptTypeScriptIncrementalSyncArbitration> {
    const record = this.currentBinding(binding);
    const revision = validRevision(event?.versionId) ? event.versionId : 0;
    if (!record || record.channel.state !== "open") {
      const known = this.bindings.get(binding);
      if (known) {
        if (known.channel.state === "open") {
          return Promise.resolve(suppressedArbitration(revision, "shared-lifecycle"));
        }
        if (
          known.channel.state === "opening" ||
          known.channel.state === "closing" ||
          known.channel.state === "retiring" ||
          known.channel.state === "blocked"
        ) {
          return Promise.resolve(blockedArbitration(revision));
        }
      }
      return Promise.resolve(legacyArbitration(revision, "closed"));
    }
    if (!safeCurrent(record.isCurrent)) {
      const retained = this.detachBinding(binding, record);
      return retained
        ? Promise.resolve(suppressedArbitration(revision, "shared-lifecycle"))
        : this.retire(record.channel, "authority-stale").then((settled) =>
            settled ? legacyArbitration(revision, "authority-stale") : blockedArbitration(revision),
          );
    }
    if (!this.channelIsCurrent(record.channel)) {
      return this.retire(record.channel, "authority-stale").then((settled) =>
        settled ? legacyArbitration(revision, "authority-stale") : blockedArbitration(revision),
      );
    }
    const duplicate = record.channel.revisionArbitrations.get(revision);
    if (duplicate) {
      return duplicate.promise;
    }
    if (!validRevision(revision)) {
      return Promise.resolve(suppressedArbitration(revision, "invalid-event"));
    }
    if (revision <= record.channel.lastAcceptedRevision) {
      return Promise.resolve(
        Object.freeze({
          revision,
          serverVersion: record.channel.serverVersion,
          status: "incremental-accepted" as const,
        }),
      );
    }
    if (record.channel.revisionArbitrations.size >= this.maxPendingRevisions) {
      return this.retire(record.channel, "pending-limit").then((settled) =>
        settled ? legacyArbitration(revision, "pending-limit") : blockedArbitration(revision),
      );
    }

    const append = this.coordinator.append(record.channel.lease, event);
    if (append.status === "stale") {
      return this.retire(record.channel, "authority-stale").then((settled) =>
        settled ? legacyArbitration(revision, "authority-stale") : blockedArbitration(revision),
      );
    }
    const arbitration = deferredArbitration(revision);
    record.channel.revisionArbitrations.set(revision, arbitration);
    record.channel.pending.push(arbitration);
    this.scheduleFlush(record.channel);
    return arbitration.promise;
  }

  currentServerVersion(binding: JavaScriptTypeScriptIncrementalSyncBinding): number | null {
    const record = this.currentBinding(binding);
    if (
      !record ||
      record.channel.state !== "open" ||
      record.channel.pending.length > 0 ||
      record.channel.pumpPromise !== null ||
      record.channel.revisionArbitrations.size > 0 ||
      !this.channelIsCurrent(record.channel)
    ) {
      return null;
    }
    return record.channel.serverVersion;
  }

  async drainBeforeSave(
    binding: JavaScriptTypeScriptIncrementalSyncBinding,
    exactRevision: number,
  ): Promise<JavaScriptTypeScriptIncrementalSyncArbitration> {
    const record = this.currentBinding(binding);
    if (!record) {
      const known = this.bindings.get(binding);
      if (known) {
        if (known.channel.state === "open") {
          return suppressedArbitration(exactRevision, "shared-lifecycle");
        }
        if (
          known.channel.state === "opening" ||
          known.channel.state === "closing" ||
          known.channel.state === "retiring" ||
          known.channel.state === "blocked"
        ) {
          return blockedArbitration(exactRevision);
        }
      }
      return legacyArbitration(exactRevision, "closed");
    }
    if (!validRevision(exactRevision)) {
      return suppressedArbitration(exactRevision, "invalid-event");
    }
    if (!safeCurrent(record.isCurrent)) {
      const retained = this.detachBinding(binding, record);
      if (retained) return suppressedArbitration(exactRevision, "shared-lifecycle");
      return (await this.retire(record.channel, "authority-stale"))
        ? legacyArbitration(exactRevision, "authority-stale")
        : blockedArbitration(exactRevision);
    }
    this.cancelScheduledFlush(record.channel);
    await this.flush(record.channel);
    if (record.channel.state === "blocked") {
      return blockedArbitration(exactRevision);
    }
    if (
      record.channel.state === "open" &&
      this.channelIsCurrent(record.channel) &&
      record.channel.lastAcceptedRevision >= exactRevision
    ) {
      return Object.freeze({
        revision: exactRevision,
        serverVersion: record.channel.serverVersion,
        status: "incremental-accepted",
      });
    }
    return legacyArbitration(exactRevision, record.channel.failureReason ?? "authority-stale");
  }

  async closeDocument(
    binding: JavaScriptTypeScriptIncrementalSyncBinding,
  ): Promise<JavaScriptTypeScriptIncrementalSyncReleaseResult> {
    const record = this.currentBinding(binding);
    if (!record) {
      const known = this.bindings.get(binding);
      if (known?.channel.state === "blocked") return blockedRelease();
      return Object.freeze({
        channel: known && known.channel.state !== "closed" ? "retained" : "closed",
        status: "released",
      });
    }
    if (!safeCurrent(record.isCurrent)) {
      const retained = this.detachBinding(binding, record);
      if (retained) return Object.freeze({ channel: "retained", status: "released" });
      return (await this.retire(record.channel, "authority-stale"))
        ? Object.freeze({ channel: "closed", status: "released" })
        : blockedRelease();
    }
    return this.closeChannel(record.channel);
  }

  async release(
    binding: JavaScriptTypeScriptIncrementalSyncBinding,
  ): Promise<JavaScriptTypeScriptIncrementalSyncReleaseResult> {
    const record = this.bindings.get(binding);
    if (!record) {
      return Object.freeze({ channel: "closed", status: "released" });
    }
    if (record.released) {
      if (record.channel.state === "blocked") return blockedRelease();
      return Object.freeze({
        channel: record.channel.state === "closed" ? "closed" : "retained",
        status: "released",
      });
    }
    if (record.channel.bindings.size === 1) {
      return this.closeChannel(record.channel);
    }
    record.released = true;
    record.channel.bindings.delete(binding);
    return Object.freeze({ channel: "retained", status: "released" });
  }

  private async admitOpen(
    channel: SyncChannel,
    request: JavaScriptTypeScriptIncrementalSyncOpenRequest & { readonly initialText: string },
    predecessorLifecycleToken: string | null,
  ): Promise<boolean> {
    for (let attempt = 0; attempt <= this.maxBusyRetries; attempt += 1) {
      if (!this.channelIsCurrent(channel) || channel.state !== "opening") {
        channel.failureReason = "authority-stale";
        return false;
      }
      try {
        const pendingOpen = this.gateway.didOpen({
          authority: boundedDocumentSyncIdentityAuthority(
            channel.lease,
            channel.authority.syncGeneration,
          ),
          expectedSessionId: channel.authority.expectedSessionId,
          languageId: request.languageId,
          path: channel.authority.path,
          predecessorLifecycleToken,
          rootPath: channel.authority.rootPath,
          text: request.initialText,
          version: channel.serverVersion,
        });
        const outcome = await withDeadline(pendingOpen, this.gatewayTimeoutMs);
        if (outcome.status === "timed-out") {
          channel.failureReason = "gateway-rejected";
          channel.lateOpenPending = true;
          channel.state = "blocked";
          void pendingOpen.then(
            (receipt) => this.settleLateOpen(channel, receipt),
            () => this.settleLateOpen(channel, null),
          );
          return false;
        }
        const receipt = outcome.value;
        if (receipt.kind === "admitted") {
          channel.lifecycleToken = receipt.lifecycleToken;
          if (!this.channelIsCurrent(channel) || channel.state !== "opening") {
            channel.failureReason = "authority-stale";
            return false;
          }
          channel.state = "open";
          this.predecessorTokens.delete(channelKey(channel.authority));
          return true;
        }
        if (receipt.kind !== "busy") break;
      } catch {
        if (attempt >= this.maxBusyRetries) break;
      }
    }
    channel.failureReason = "gateway-rejected";
    return false;
  }

  private async join(
    channel: SyncChannel,
    isCurrent: () => boolean,
  ): Promise<JavaScriptTypeScriptIncrementalSyncOpenResult> {
    if (channel.bindings.size >= this.maxHoldersPerModel || !safeCurrent(isCurrent)) {
      return suppressedOpen();
    }
    const binding = this.createBinding(channel, isCurrent);
    if (!(await channel.openPromise) || channel.state !== "open" || !safeCurrent(isCurrent)) {
      const record = this.bindings.get(binding);
      if (record) record.released = true;
      channel.bindings.delete(binding);
      return channel.state === "blocked"
        ? blockedOpen()
        : channel.state === "open"
          ? suppressedOpen()
          : legacyOpen("gateway-rejected");
    }
    return Object.freeze({
      binding,
      ownership: "incremental-lifecycle",
      status: "incremental",
    });
  }

  private createBinding(
    channel: SyncChannel,
    isCurrent: () => boolean,
  ): JavaScriptTypeScriptIncrementalSyncBinding {
    const binding = Object.freeze({
      kind: "javascript-typescript-incremental-sync-binding" as const,
    });
    channel.bindings.add(binding);
    this.bindings.set(binding, { channel, isCurrent, released: false });
    return binding;
  }

  private scheduleFlush(channel: SyncChannel): void {
    if (channel.cancelTimer || channel.state !== "open") return;
    channel.cancelTimer = this.scheduler.schedule(() => {
      channel.cancelTimer = null;
      void this.flush(channel).catch(() => {
        void this.retire(channel, "gateway-rejected");
      });
    }, this.debounceMs);
  }

  private cancelScheduledFlush(channel: SyncChannel): void {
    channel.cancelTimer?.();
    channel.cancelTimer = null;
  }

  private async flush(channel: SyncChannel): Promise<void> {
    if (channel.pumpPromise) {
      await channel.pumpPromise;
      if (channel.pending.length > 0 && channel.state === "open") {
        return this.flush(channel);
      }
      return;
    }
    const pump = this.pump(channel);
    channel.pumpPromise = pump;
    try {
      await pump;
    } finally {
      if (channel.pumpPromise === pump) channel.pumpPromise = null;
    }
  }

  private async pump(channel: SyncChannel): Promise<void> {
    while (channel.pending.length > 0 && channel.state === "open") {
      if (!this.channelIsCurrent(channel)) {
        await this.retireFromPump(channel, "authority-stale");
        return;
      }
      const batch = channel.pending.splice(0);
      let admitted = false;
      let admittedVersion = channel.serverVersion;
      for (let attempt = 0; attempt <= this.maxBusyRetries; attempt += 1) {
        let prepared: ReturnType<IncrementalDocumentSyncCoordinator["prepareFlush"]>;
        try {
          prepared = this.coordinator.prepareFlush(
            channel.lease,
            channel.serverVersion + 1,
            channel.snapshotReader,
          );
        } catch {
          await this.retireFromPump(channel, "gateway-rejected");
          return;
        }
        if (prepared.status !== "prepared") {
          const reason =
            prepared.status === "busy"
              ? "busy"
              : prepared.status === "stale"
                ? "authority-stale"
                : "gateway-rejected";
          await this.retireFromPump(channel, reason);
          return;
        }
        const lifecycleToken = channel.lifecycleToken;
        if (!lifecycleToken) {
          this.coordinator.rollbackFlush(channel.lease, prepared.transaction);
          await this.retireFromPump(channel, "authority-stale");
          return;
        }
        try {
          const pendingChange = this.gateway.didChange({
            authority: boundedDocumentSyncAuthority(
              channel.lease,
              channel.authority.syncGeneration,
              lifecycleToken,
            ),
            change: prepared.envelope,
            expectedSessionId: channel.authority.expectedSessionId,
            rootPath: channel.authority.rootPath,
          });
          const outcome = await withDeadline(pendingChange, this.gatewayTimeoutMs);
          if (outcome.status === "timed-out") {
            this.coordinator.rollbackFlush(channel.lease, prepared.transaction);
            break;
          }
          const receipt = outcome.value;
          if (!this.channelIsCurrent(channel) || channel.state !== "open") {
            this.coordinator.rollbackFlush(channel.lease, prepared.transaction);
            break;
          }
          if (receipt.kind === "admitted") {
            const settlement = this.coordinator.commitFlush(channel.lease, prepared.transaction);
            admitted = settlement.status === "committed";
            admittedVersion = prepared.envelope.version;
            if (admitted) break;
          } else {
            this.coordinator.rollbackFlush(channel.lease, prepared.transaction);
            if (receipt.kind !== "busy") break;
          }
        } catch {
          this.coordinator.rollbackFlush(channel.lease, prepared.transaction);
        }
        if (attempt < this.maxBusyRetries) continue;
      }

      if (admitted) {
        if (this.channelIsCurrent(channel)) {
          channel.serverVersion = admittedVersion;
          channel.lastAcceptedRevision = Math.max(
            channel.lastAcceptedRevision,
            ...batch.map(({ revision }) => revision),
          );
          this.resolveAccepted(channel, batch);
          continue;
        }
      }
      await this.retireFromPump(
        channel,
        this.channelIsCurrent(channel) ? "gateway-rejected" : "authority-stale",
      );
      return;
    }
  }

  private async closeChannel(
    channel: SyncChannel,
  ): Promise<JavaScriptTypeScriptIncrementalSyncReleaseResult> {
    if (channel.closePromise) return channel.closePromise;
    const closing = this.closeChannelOwned(channel).finally(() => {
      if (channel.state === "blocked") channel.closePromise = null;
    });
    channel.closePromise = closing;
    return closing;
  }

  private async closeChannelOwned(
    channel: SyncChannel,
  ): Promise<JavaScriptTypeScriptIncrementalSyncReleaseResult> {
    if (channel.state === "closed") {
      return Object.freeze({ channel: "closed", status: "released" });
    }
    if (channel.state === "fallback") {
      return (await this.retire(channel, "gateway-rejected"))
        ? legacyRelease("gateway-rejected")
        : blockedRelease();
    }
    this.cancelScheduledFlush(channel);
    await channel.openPromise;
    await this.flush(channel);
    if (channel.state !== "open" || !this.channelIsCurrent(channel)) {
      return (await this.retire(channel, "authority-stale"))
        ? legacyRelease("authority-stale")
        : blockedRelease();
    }
    channel.state = "closing";
    const lifecycleToken = channel.lifecycleToken;
    if (!lifecycleToken) {
      return (await this.retire(channel, "authority-stale"))
        ? legacyRelease("authority-stale")
        : blockedRelease();
    }
    const currentBeforeClose = this.channelIsCurrent(channel);
    if (await this.settleExactClose(channel)) {
      this.rememberPredecessor(channel);
      this.finishClosed(channel);
      return currentBeforeClose
        ? Object.freeze({ channel: "closed", status: "released" })
        : legacyRelease("authority-stale");
    }
    channel.failureReason = "gateway-rejected";
    channel.state = "blocked";
    return blockedRelease();
  }

  private async retire(
    channel: SyncChannel,
    reason: JavaScriptTypeScriptIncrementalSyncFallbackReason,
    skipPump = false,
  ): Promise<boolean> {
    if (channel.state === "closed") return true;
    if (channel.retirePromise) return channel.retirePromise;
    const retirement = this.retireOwned(channel, reason, skipPump);
    channel.retirePromise = retirement;
    return retirement;
  }

  private async retireOwned(
    channel: SyncChannel,
    reason: JavaScriptTypeScriptIncrementalSyncFallbackReason,
    skipPump: boolean,
  ): Promise<boolean> {
    this.cancelScheduledFlush(channel);
    channel.failureReason = reason;
    channel.state = "retiring";
    await channel.openPromise;
    if (channel.lateOpenPending) {
      channel.state = "blocked";
      for (const binding of channel.bindings) {
        const record = this.bindings.get(binding);
        if (record) record.released = true;
      }
      channel.bindings.clear();
      this.resolveBlocked(channel, [...channel.revisionArbitrations.values()]);
      return false;
    }
    if (!skipPump && channel.pumpPromise) {
      await channel.pumpPromise;
    }
    channel.state = "retiring";
    this.coordinator.drop(channel.lease);
    channel.pending.splice(0);
    const unsettled = [...channel.revisionArbitrations.values()];
    const closed = channel.lifecycleToken ? await this.settleExactClose(channel) : true;
    if (closed) {
      this.rememberPredecessor(channel);
      this.resolveFallback(channel, unsettled, reason);
      this.finishClosed(channel);
      return true;
    }
    channel.state = "blocked";
    for (const binding of channel.bindings) {
      const record = this.bindings.get(binding);
      if (record) record.released = true;
    }
    channel.bindings.clear();
    this.resolveBlocked(channel, unsettled);
    return false;
  }

  private async retireFromPump(
    channel: SyncChannel,
    reason: JavaScriptTypeScriptIncrementalSyncFallbackReason,
  ): Promise<void> {
    if (channel.retirePromise) return;
    await this.retire(channel, reason, true);
  }

  private async compensateClose(channel: SyncChannel): Promise<boolean> {
    const lifecycleToken = channel.lifecycleToken;
    if (!lifecycleToken) return true;
    for (let attempt = 0; attempt <= this.maxBusyRetries; attempt += 1) {
      try {
        const pendingClose = this.gateway.didClose({
          authority: boundedDocumentSyncAuthority(
            channel.lease,
            channel.authority.syncGeneration,
            lifecycleToken,
          ),
          expectedSessionId: channel.authority.expectedSessionId,
          path: channel.authority.path,
          rootPath: channel.authority.rootPath,
          version: channel.serverVersion,
        });
        const outcome = await withDeadline(pendingClose, this.gatewayTimeoutMs);
        if (outcome.status === "timed-out") {
          channel.lateClosePending = true;
          void pendingClose.then(
            (receipt) => {
              channel.lateClosePending = false;
              this.settleLateClose(channel, receipt.kind === "admitted");
            },
            () => {
              channel.lateClosePending = false;
            },
          );
          return false;
        }
        const receipt = outcome.value;
        if (receipt.kind === "admitted") return true;
        if (receipt.kind !== "busy") return false;
      } catch {
        if (attempt >= this.maxBusyRetries) return false;
      }
    }
    return false;
  }

  private async settleExactClose(channel: SyncChannel): Promise<boolean> {
    if (channel.settlementPromise) return channel.settlementPromise;
    const settlement = this.compensateClose(channel).finally(() => {
      if (channel.settlementPromise === settlement) channel.settlementPromise = null;
    });
    channel.settlementPromise = settlement;
    return settlement;
  }

  private settleLateClose(channel: SyncChannel, admitted: boolean): void {
    if (!admitted || channel.state === "closed") return;
    this.rememberPredecessor(channel);
    this.finishClosed(channel);
  }

  private async settleBlocked(channel: SyncChannel): Promise<boolean> {
    if (channel.state !== "blocked") return channel.state === "closed";
    if (channel.lateOpenPending || channel.lateClosePending) return false;
    if (!(await this.settleExactClose(channel))) return false;
    this.rememberPredecessor(channel);
    this.finishClosed(channel);
    return true;
  }

  private async settleLateOpen(
    channel: SyncChannel,
    receipt: BoundedLanguageServerDidOpenReceipt | null,
  ): Promise<void> {
    if (!channel.lateOpenPending) return;
    channel.lateOpenPending = false;
    if (receipt?.kind !== "admitted") {
      this.finishClosed(channel);
      return;
    }
    channel.lifecycleToken = receipt.lifecycleToken;
    if (!(await this.settleExactClose(channel))) {
      channel.state = "blocked";
      return;
    }
    this.rememberPredecessor(channel);
    this.finishClosed(channel);
  }

  private finishClosed(channel: SyncChannel): void {
    channel.state = "closed";
    channel.lifecycleToken = null;
    this.cancelScheduledFlush(channel);
    this.coordinator.drop(channel.lease);
    if (this.channels.get(channelKey(channel.authority)) === channel) {
      this.channels.delete(channelKey(channel.authority));
    }
    for (const binding of channel.bindings) {
      const record = this.bindings.get(binding);
      if (record) record.released = true;
    }
    channel.bindings.clear();
  }

  private rememberPredecessor(channel: SyncChannel): void {
    if (!channel.lifecycleToken) return;
    const key = channelKey(channel.authority);
    if (!this.predecessorTokens.has(key) && this.predecessorTokens.size >= this.maxChannels) {
      const oldest = this.predecessorTokens.keys().next().value as string | undefined;
      if (oldest) this.predecessorTokens.delete(oldest);
    }
    this.predecessorTokens.set(key, channel.lifecycleToken);
  }

  private resolveAccepted(channel: SyncChannel, batch: readonly PendingArbitration[]): void {
    for (const arbitration of batch) {
      arbitration.resolve(
        Object.freeze({
          revision: arbitration.revision,
          serverVersion: channel.serverVersion,
          status: "incremental-accepted",
        }),
      );
      channel.revisionArbitrations.delete(arbitration.revision);
    }
  }

  private resolveFallback(
    channel: SyncChannel,
    batch: readonly PendingArbitration[],
    reason: JavaScriptTypeScriptIncrementalSyncFallbackReason,
  ): void {
    for (const arbitration of batch) {
      arbitration.resolve(legacyArbitration(arbitration.revision, reason));
      channel.revisionArbitrations.delete(arbitration.revision);
    }
  }

  private resolveBlocked(channel: SyncChannel, batch: readonly PendingArbitration[]): void {
    for (const arbitration of batch) {
      arbitration.resolve(blockedArbitration(arbitration.revision));
      channel.revisionArbitrations.delete(arbitration.revision);
    }
  }

  private currentBinding(
    binding: JavaScriptTypeScriptIncrementalSyncBinding,
  ): BindingRecord | null {
    const record = this.bindings.get(binding);
    return record && !record.released ? record : null;
  }

  private channelIsCurrent(channel: SyncChannel): boolean {
    if (this.channels.get(channelKey(channel.authority)) !== channel) return false;
    for (const binding of channel.bindings) {
      const record = this.bindings.get(binding);
      if (
        record &&
        !record.released &&
        safeCurrent(record.isCurrent) &&
        this.channels.get(channelKey(channel.authority)) === channel &&
        !["blocked", "closed", "fallback", "retiring"].includes(channel.state) &&
        !record.released
      ) {
        return true;
      }
      if (this.channels.get(channelKey(channel.authority)) !== channel) return false;
    }
    return false;
  }

  private detachBinding(
    binding: JavaScriptTypeScriptIncrementalSyncBinding,
    record: BindingRecord,
  ): boolean {
    record.released = true;
    record.channel.bindings.delete(binding);
    return record.channel.bindings.size > 0;
  }

  private modelIncarnation(model: object): string | null {
    const existing = this.modelTokens.get(model);
    if (existing) return existing;
    if (!Number.isSafeInteger(this.nextModelToken) || this.nextModelToken <= 0) return null;
    const token = `js-ts-model-${this.nextModelToken}`;
    this.nextModelToken += 1;
    this.modelTokens.set(model, token);
    return token;
  }
}

function deferredArbitration(revision: number): PendingArbitration {
  let resolve!: (result: JavaScriptTypeScriptIncrementalSyncArbitration) => void;
  const promise = new Promise<JavaScriptTypeScriptIncrementalSyncArbitration>((settle) => {
    resolve = settle;
  });
  return { promise, resolve, revision };
}

function createLease(
  authority: JavaScriptTypeScriptIncrementalSyncAuthority,
  modelIncarnation: string,
): IncrementalDocumentSyncLease {
  return Object.freeze({
    documentIncarnation: authority.documentIncarnation,
    modelIncarnation,
    ownerGeneration: authority.ownerGeneration,
    ownerIncarnation: authority.ownerIncarnation,
    ownerKey: authority.ownerKey,
    path: authority.path,
  });
}

function channelKey(authority: JavaScriptTypeScriptIncrementalSyncAuthority): string {
  return `${authority.rootPath}\0${authority.path}`;
}

function authoritiesEqual(
  left: JavaScriptTypeScriptIncrementalSyncAuthority,
  right: JavaScriptTypeScriptIncrementalSyncAuthority,
): boolean {
  return (
    left.documentIncarnation === right.documentIncarnation &&
    left.expectedSessionId === right.expectedSessionId &&
    left.ownerGeneration === right.ownerGeneration &&
    left.ownerIncarnation === right.ownerIncarnation &&
    left.ownerKey === right.ownerKey &&
    left.path === right.path &&
    left.rootPath === right.rootPath &&
    left.syncGeneration === right.syncGeneration
  );
}

function validOpenRequest(request: JavaScriptTypeScriptIncrementalSyncOpenRequest): boolean {
  return (
    isRecord(request) &&
    isObject(request.model) &&
    (request.initialText === null ||
      (typeof request.initialText === "string" &&
        request.initialText.length === request.utf16Length)) &&
    typeof request.isCurrent === "function" &&
    ["javascript", "javascriptreact", "typescript", "typescriptreact"].includes(
      request.languageId,
    ) &&
    validRevision(request.versionId) &&
    validRevision(request.alternativeVersionId) &&
    validAuthority(request.authority) &&
    isRecord(request.capability)
  );
}

function validAuthority(authority: JavaScriptTypeScriptIncrementalSyncAuthority): boolean {
  return (
    isRecord(authority) &&
    validToken(authority.documentIncarnation) &&
    validRevision(authority.expectedSessionId) &&
    validRevision(authority.ownerGeneration) &&
    validToken(authority.ownerIncarnation) &&
    validToken(authority.ownerKey) &&
    validDocumentSyncPath(authority.path) &&
    validDocumentSyncPath(authority.rootPath) &&
    validRevision(authority.syncGeneration)
  );
}

function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validToken(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 4_096 && !value.includes("\0")
  );
}

function safeCurrent(isCurrent: () => boolean): boolean {
  try {
    return isCurrent() === true;
  } catch {
    return false;
  }
}

function legacyOpen(
  reason: JavaScriptTypeScriptIncrementalSyncFallbackReason,
): JavaScriptTypeScriptIncrementalSyncOpenResult {
  return Object.freeze({ reason, status: "legacy-fallback" });
}

function blockedOpen(): JavaScriptTypeScriptIncrementalSyncOpenResult {
  return Object.freeze({ reason: "close-uncertain", status: "blocked" });
}

function suppressedOpen(): JavaScriptTypeScriptIncrementalSyncOpenResult {
  return Object.freeze({ reason: "shared-lifecycle", status: "suppressed" });
}

function legacyArbitration(
  revision: number,
  reason: JavaScriptTypeScriptIncrementalSyncFallbackReason,
): JavaScriptTypeScriptIncrementalSyncArbitration {
  return Object.freeze({ reason, revision, status: "legacy-fallback" });
}

function blockedArbitration(revision: number): JavaScriptTypeScriptIncrementalSyncArbitration {
  return Object.freeze({ reason: "close-uncertain", revision, status: "blocked" });
}

function suppressedArbitration(
  revision: number,
  reason: "invalid-event" | "shared-lifecycle",
): JavaScriptTypeScriptIncrementalSyncArbitration {
  return Object.freeze({ reason, revision, status: "suppressed" });
}

function legacyRelease(
  reason: JavaScriptTypeScriptIncrementalSyncFallbackReason,
): JavaScriptTypeScriptIncrementalSyncReleaseResult {
  return Object.freeze({ reason, status: "legacy-fallback" });
}

function blockedRelease(): JavaScriptTypeScriptIncrementalSyncReleaseResult {
  return Object.freeze({ reason: "close-uncertain", status: "blocked" });
}

function validatedOption(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError("Invalid bounded incremental sync service option.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<{ readonly status: "settled"; readonly value: T } | { readonly status: "timed-out" }> {
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeout = new Promise<{ readonly status: "timed-out" }>((resolve) => {
    timer = globalThis.setTimeout(() => resolve({ status: "timed-out" }), timeoutMs);
  });
  const settled = operation.then(
    (value) => ({ status: "settled" as const, value }),
    (error: unknown) => Promise.reject(error),
  );
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    if (timer !== null) globalThis.clearTimeout(timer);
  }
}
