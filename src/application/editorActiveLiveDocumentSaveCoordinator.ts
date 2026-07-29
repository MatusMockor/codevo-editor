import type { EditorDocument } from "../domain/workspace";
import { MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS } from "../domain/liveDocumentContentAuthority";
import type { ActiveDocumentSaveStorePort, DocumentSaveTarget } from "./activeDocumentSaveStore";
import {
  captureEditorActiveLiveDocumentForSave,
  releaseEditorActiveLiveDocumentContent,
  type EditorActiveLiveDocumentBinding,
} from "./editorActiveLiveDocumentBinding";
import type { DocumentSaveLease } from "./documentSaveCoordinator";
import {
  acknowledgeEditorGroupLiveDocumentSave,
  advanceEditorGroupLiveDocumentSave,
  cancelEditorGroupLiveDocumentSave,
  isEditorGroupLiveDocumentSaveCurrent,
  issueEditorGroupLiveDocumentSave,
  replaceEditorGroupLiveDocumentSaveContent,
  type EditorGroupLiveDocumentAttachment,
} from "./editorSessionDocumentAuthority";
import type { DocumentSessionSavePermit } from "../domain/documentSession";
import type { LiveModelRevision } from "./liveModelIngressCoordinator";
import {
  documentSaveOwnershipKey,
  isRegisteredDocumentSaveIdentity,
  type RegisteredDocumentSaveIdentity,
} from "./documentSaveIdentity";

interface ActiveLiveSaveCapabilities {
  readonly applyContent: (content: string) => LiveModelRevision | null;
  readonly attachment: EditorGroupLiveDocumentAttachment;
  readonly binding: EditorActiveLiveDocumentBinding;
  readonly registeredIdentity: RegisteredDocumentSaveIdentity | null;
  readonly retirementScopeKey: string;
  readonly workspaceMatches: (rootPath: string) => boolean;
}

export interface EditorActiveLiveDocumentSaveBinding {
  readonly groupId: string;
  readonly path: string;
  isCurrent(): boolean;
}

export type EditorActiveLiveDocumentSaveAdmission =
  | { readonly status: "fallback" }
  | {
      readonly reason: EditorActiveLiveDocumentSaveRejectionReason;
      readonly status: "rejected";
    }
  | {
      readonly saveStore: ActiveDocumentSaveStorePort;
      readonly settle: () => void;
      readonly target: DocumentSaveTarget;
      readonly status: "admitted";
    };

export type EditorActiveLiveDocumentSaveRejectionReason =
  "document-too-large" | "exact-live-unavailable";

export interface EditorActiveLiveDocumentSaveAdmissionInput {
  readonly document: EditorDocument;
  readonly legacySaveStore: ActiveDocumentSaveStorePort;
  readonly lease: DocumentSaveLease;
  readonly requireExactLiveSave: boolean;
  readonly target: DocumentSaveTarget;
}

export interface EditorActiveLiveDocumentSaveAdmissionPort {
  admit(input: EditorActiveLiveDocumentSaveAdmissionInput): EditorActiveLiveDocumentSaveAdmission;
  publish(binding: EditorActiveLiveDocumentSaveBinding | null): void;
  resetRetiredOwnership?(): void;
}

const capabilitiesByBinding = new WeakMap<
  EditorActiveLiveDocumentSaveBinding,
  ActiveLiveSaveCapabilities
>();

export function createEditorActiveLiveDocumentSaveBinding(input: {
  readonly applyContent: (content: string) => LiveModelRevision | null;
  readonly attachment: EditorGroupLiveDocumentAttachment;
  readonly binding: EditorActiveLiveDocumentBinding;
  readonly registeredIdentity?: RegisteredDocumentSaveIdentity | null;
  readonly retirementScopeKey: string;
  readonly workspaceMatches: (rootPath: string) => boolean;
}): EditorActiveLiveDocumentSaveBinding {
  const facade = Object.freeze({
    groupId: input.binding.groupId,
    path: input.binding.path,
    isCurrent: () => input.binding.isCurrent(),
  });
  capabilitiesByBinding.set(
    facade,
    Object.freeze({
      ...input,
      registeredIdentity: isRegisteredDocumentSaveIdentity(input.registeredIdentity)
        ? input.registeredIdentity
        : null,
    }),
  );
  return facade;
}

/**
 * Owns the exact live-save capability outside React. The public binding is a
 * path-scoped facade; attachment, snapshot and Store permit remain in WeakMaps.
 */
export class EditorActiveLiveDocumentSaveCoordinator {
  private active: EditorActiveLiveDocumentSaveBinding | null = null;
  private readonly retired = new Map<EditorActiveLiveDocumentSaveBinding, null>();
  private readonly retiredPathFilters = new Map<string, RetiredExactLiveSavePathFilter>();
  private readonly retiredRegisteredPathFilters = new Map<
    string,
    RegisteredRetiredExactLiveSavePathFilter
  >();

  publish(binding: EditorActiveLiveDocumentSaveBinding | null): void {
    if (this.active && this.active !== binding) {
      this.retired.set(this.active, null);
      if (this.retired.size > MAX_RETAINED_EXACT_LIVE_SAVE_BINDINGS) {
        const oldest = this.retired.keys().next().value;
        if (oldest) {
          this.retired.delete(oldest);
          const capabilities = capabilitiesByBinding.get(oldest);
          if (capabilities) {
            if (capabilities.registeredIdentity) {
              const scopeKey = registeredSaveOwnerScopeKey(capabilities.registeredIdentity);
              let filter = this.retiredRegisteredPathFilters.get(scopeKey);
              if (!filter) {
                filter = new RegisteredRetiredExactLiveSavePathFilter();
                this.retiredRegisteredPathFilters.set(scopeKey, filter);
              }
              filter.add(capabilities.registeredIdentity.workspaceRelativePath);
            } else {
              let filter = this.retiredPathFilters.get(capabilities.retirementScopeKey);
              if (!filter) {
                filter = new RetiredExactLiveSavePathFilter(capabilities.workspaceMatches);
                this.retiredPathFilters.set(capabilities.retirementScopeKey, filter);
              }
              filter.add(oldest.path);
            }
          }
        }
      }
    }
    this.active = binding;
    if (binding) {
      this.retired.delete(binding);
    }
  }

  resetRetiredOwnership(): void {
    this.retired.clear();
    this.retiredPathFilters.clear();
    this.retiredRegisteredPathFilters.clear();
  }

  admit(input: EditorActiveLiveDocumentSaveAdmissionInput): EditorActiveLiveDocumentSaveAdmission {
    const facade = this.active;
    const capabilities = facade ? capabilitiesByBinding.get(facade) : null;
    const activeOwnership = exactOwnershipMatch(facade, capabilities, input.target);
    if (activeOwnership !== "matched") {
      if (activeOwnership === "uncertain") {
        return rejectedLiveSave("exact-live-unavailable");
      }
      if (
        input.requireExactLiveSave ||
        this.hasFilteredRetiredExactOwnership(input.target) ||
        this.hasRetiredExactOwnership(input.target)
      ) {
        return rejectedLiveSave("exact-live-unavailable");
      }
      return { status: "fallback" };
    }
    if (!facade || !capabilities || !safeCurrent(facade)) {
      return rejectedLiveSave("exact-live-unavailable");
    }

    const captured = captureEditorActiveLiveDocumentForSave(capabilities.binding);
    if (captured.status !== "captured") {
      return rejectedLiveSave(
        captured.reason === "document-too-large" ? "document-too-large" : "exact-live-unavailable",
      );
    }
    const permit = issueEditorGroupLiveDocumentSave(
      capabilities.attachment,
      capabilities.binding,
      captured.capture,
    );
    if (!permit) {
      releaseEditorActiveLiveDocumentContent(capabilities.binding, captured.capture);
      return rejectedLiveSave("exact-live-unavailable");
    }

    const exactDocument = Object.freeze({
      ...input.document,
      content: captured.capture.content,
    });
    const transaction = new ExactLiveDocumentSaveTransaction({
      capabilities,
      exactDocument,
      legacySaveStore: input.legacySaveStore,
      outerLease: input.lease,
      permit,
      target: input.target,
    });
    return {
      saveStore: transaction,
      settle: () => transaction.settle(),
      status: "admitted",
      target: {
        ...input.target,
        lease: transaction.lease,
      },
    };
  }

  private hasRetiredExactOwnership(target: DocumentSaveTarget): boolean {
    for (const facade of this.retired.keys()) {
      const capabilities = capabilitiesByBinding.get(facade);
      if (exactOwnershipMatch(facade, capabilities, target) !== "not-matched") return true;
    }
    return false;
  }

  private hasFilteredRetiredExactOwnership(target: DocumentSaveTarget): boolean {
    if (isRegisteredDocumentSaveIdentity(target.registeredIdentity)) {
      return (
        this.retiredRegisteredPathFilters
          .get(registeredSaveOwnerScopeKey(target.registeredIdentity))
          ?.mightContain(target.registeredIdentity.workspaceRelativePath) === true
      );
    }
    for (const filter of this.retiredPathFilters.values()) {
      if (filter.matches(target.rootPath) && filter.mightContain(target.path)) return true;
    }
    return false;
  }
}

class ExactLiveDocumentSaveTransaction implements ActiveDocumentSaveStorePort {
  private acknowledged = false;
  private authoritativeDocument: EditorDocument | null = null;
  private legacyProjectionAtAuthoritativeDocument: EditorDocument | null = null;
  private permit: DocumentSessionSavePermit;
  private phase: "preparing" | "writing" | "settled" = "preparing";

  readonly lease = {
    isCurrent: () => this.isPreparingCurrent(),
    tryBeginWrite: () => {
      if (!this.isPreparingCurrent()) return null;
      const outer = this.input.outerLease.tryBeginWrite();
      if (!outer) return null;
      this.phase = "writing";
      let settled = false;
      return {
        granted: true as const,
        settle: () => {
          if (settled) return;
          settled = true;
          outer.settle();
          if (!this.acknowledged) {
            cancelEditorGroupLiveDocumentSave(this.input.capabilities.attachment, this.permit);
          }
          this.phase = "settled";
        },
      };
    },
  };

  constructor(
    private readonly input: {
      readonly capabilities: ActiveLiveSaveCapabilities;
      readonly exactDocument: EditorDocument;
      readonly legacySaveStore: ActiveDocumentSaveStorePort;
      readonly outerLease: DocumentSaveLease;
      readonly permit: DocumentSessionSavePermit;
      readonly target: DocumentSaveTarget;
    },
  ) {
    this.permit = input.permit;
  }

  settle(): void {
    if (this.phase === "settled") return;
    if (!this.acknowledged) {
      cancelEditorGroupLiveDocumentSave(this.input.capabilities.attachment, this.permit);
    }
    this.phase = "settled";
  }

  current(_target: DocumentSaveTarget): EditorDocument | null {
    if (this.phase === "preparing") {
      return this.isPreparingCurrent() ? this.input.exactDocument : null;
    }
    const live = this.input.legacySaveStore.current(this.input.target);
    if (this.authoritativeDocument) {
      return this.legacyProjectionAtAuthoritativeDocument &&
        live === this.legacyProjectionAtAuthoritativeDocument
        ? this.authoritativeDocument
        : live;
    }
    if (!live) return null;
    return live.content === this.input.exactDocument.content ? this.input.exactDocument : live;
  }

  prepareIssuedWrite(
    _target: DocumentSaveTarget,
    expectedDocument: EditorDocument,
    savedDocument: EditorDocument,
  ): boolean {
    if (this.phase !== "writing" || expectedDocument !== this.input.exactDocument) {
      return false;
    }
    const replacement = this.prepareContent(savedDocument.content);
    if (!replacement) return false;
    this.permit = replacement;
    return true;
  }

  acknowledgeIssuedWrite(
    _target: DocumentSaveTarget,
    acknowledgement: Parameters<ActiveDocumentSaveStorePort["acknowledgeIssuedWrite"]>[1],
  ): boolean {
    if (
      this.phase !== "writing" ||
      !acknowledgeEditorGroupLiveDocumentSave(
        this.input.capabilities.attachment,
        this.permit,
        acknowledgement.revision,
      )
    ) {
      return false;
    }
    this.acknowledged = true;
    const legacyBeforeAcknowledgement = this.input.legacySaveStore.current(this.input.target);
    this.input.legacySaveStore.acknowledgeIssuedWrite(this.input.target, acknowledgement);
    if (this.authoritativeDocument) {
      this.authoritativeDocument = Object.freeze({
        ...this.authoritativeDocument,
        revision: acknowledgement.revision,
        savedContent: acknowledgement.savedDocument.content,
      });
      if (legacyBeforeAcknowledgement === this.legacyProjectionAtAuthoritativeDocument) {
        this.legacyProjectionAtAuthoritativeDocument = this.input.legacySaveStore.current(
          this.input.target,
        );
      }
    }
    return true;
  }

  reconcileUnchangedPreparedContent(
    _target: DocumentSaveTarget,
    expectedDocument: EditorDocument,
    preparedContent: string,
  ): EditorDocument | null {
    if (!this.isPreparingCurrent() || expectedDocument !== this.input.exactDocument) {
      return null;
    }
    const replacement = this.prepareContent(preparedContent);
    if (!replacement) return null;
    this.permit = replacement;
    if (
      !acknowledgeEditorGroupLiveDocumentSave(
        this.input.capabilities.attachment,
        this.permit,
        expectedDocument.revision,
      )
    ) {
      return null;
    }
    this.acknowledged = true;
    this.phase = "settled";
    const legacy = this.input.legacySaveStore.current(this.input.target);
    return legacy
      ? (this.input.legacySaveStore.reconcileUnchangedPreparedContent?.(
          this.input.target,
          legacy,
          preparedContent,
        ) ?? null)
      : null;
  }

  updateRevisionForIssuedWrite(
    _target: DocumentSaveTarget,
    expectedDocument: EditorDocument,
    revision: EditorDocument["revision"],
  ): void {
    cancelEditorGroupLiveDocumentSave(this.input.capabilities.attachment, this.permit);
    const legacyBeforeRevision = this.input.legacySaveStore.current(this.input.target);
    this.input.legacySaveStore.updateRevisionForIssuedWrite(
      this.input.target,
      expectedDocument,
      revision,
    );
    this.retainAuthoritativeRevision(legacyBeforeRevision, revision);
  }

  updateRevision(_target: DocumentSaveTarget, revision: EditorDocument["revision"]): void {
    const legacyBeforeRevision = this.input.legacySaveStore.current(this.input.target);
    this.input.legacySaveStore.updateRevision(this.input.target, revision);
    this.retainAuthoritativeRevision(legacyBeforeRevision, revision);
  }

  private isPreparingCurrent(): boolean {
    return (
      this.phase === "preparing" &&
      this.input.outerLease.isCurrent() &&
      safeCurrent(this.activeFacade()) &&
      isEditorGroupLiveDocumentSaveCurrent(this.input.capabilities.attachment, this.permit)
    );
  }

  private prepareContent(content: string): DocumentSessionSavePermit | null {
    if (!isEditorGroupLiveDocumentSaveCurrent(this.input.capabilities.attachment, this.permit)) {
      return null;
    }
    if (content.length > MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS) {
      return null;
    }
    if (content === this.input.exactDocument.content) {
      const replacement = replaceEditorGroupLiveDocumentSaveContent(
        this.input.capabilities.attachment,
        this.permit,
        content,
      );
      if (replacement) {
        this.authoritativeDocument = this.input.exactDocument;
        this.legacyProjectionAtAuthoritativeDocument = this.input.legacySaveStore.current(
          this.input.target,
        );
      }
      return replacement;
    }
    let revision: LiveModelRevision | null = null;
    try {
      revision = this.input.capabilities.applyContent(content);
    } catch {
      return null;
    }
    if (!revision) return null;
    const replacement = advanceEditorGroupLiveDocumentSave(
      this.input.capabilities.attachment,
      this.permit,
      revision,
      content,
    );
    if (!replacement) return null;
    this.authoritativeDocument = Object.freeze({
      ...this.input.exactDocument,
      content,
    });
    this.legacyProjectionAtAuthoritativeDocument = this.input.legacySaveStore.current(
      this.input.target,
    );
    return replacement;
  }

  private activeFacade(): EditorActiveLiveDocumentSaveBinding {
    return this.input.capabilities.binding;
  }

  private retainAuthoritativeRevision(
    legacyBeforeRevision: EditorDocument | null,
    revision: EditorDocument["revision"],
  ): void {
    if (!this.authoritativeDocument) return;
    this.authoritativeDocument = Object.freeze({
      ...this.authoritativeDocument,
      revision,
    });
    if (legacyBeforeRevision === this.legacyProjectionAtAuthoritativeDocument) {
      this.legacyProjectionAtAuthoritativeDocument = this.input.legacySaveStore.current(
        this.input.target,
      );
    }
  }
}

function safeCurrent(binding: { isCurrent(): boolean }): boolean {
  try {
    return binding.isCurrent() === true;
  } catch {
    return false;
  }
}

function safeWorkspaceMatch(
  capabilities: ActiveLiveSaveCapabilities,
  rootPath: string,
): boolean | null {
  try {
    return capabilities.workspaceMatches(rootPath) === true;
  } catch {
    return null;
  }
}

function exactOwnershipMatch(
  facade: EditorActiveLiveDocumentSaveBinding | null,
  capabilities: ActiveLiveSaveCapabilities | null | undefined,
  target: DocumentSaveTarget,
): "matched" | "not-matched" | "uncertain" {
  if (facade === null || capabilities === null || capabilities === undefined) {
    return "not-matched";
  }
  if (capabilities.registeredIdentity) {
    if (!isRegisteredDocumentSaveIdentity(target.registeredIdentity)) {
      return facade.path === target.path ? "uncertain" : "not-matched";
    }
    return documentSaveOwnershipKey(capabilities.registeredIdentity) ===
      documentSaveOwnershipKey(target.registeredIdentity)
      ? "matched"
      : "not-matched";
  }
  if (facade.path !== target.path) return "not-matched";
  const workspaceMatch = safeWorkspaceMatch(capabilities, target.rootPath);
  if (workspaceMatch === null) return "uncertain";
  return workspaceMatch ? "matched" : "not-matched";
}

function registeredSaveOwnerScopeKey(identity: RegisteredDocumentSaveIdentity): string {
  return `${identity.workspaceId}\0${identity.canonicalRoot}`;
}

function rejectedLiveSave(
  reason: EditorActiveLiveDocumentSaveRejectionReason,
): EditorActiveLiveDocumentSaveAdmission {
  return Object.freeze({ reason, status: "rejected" });
}

/**
 * Bounded no-false-negative retirement memory. Hash collisions can only
 * reject an otherwise legacy-safe fallback; they can never reopen stale data.
 */
class RetiredExactLiveSavePathFilter {
  private readonly words = new Uint32Array(RETIRED_PATH_FILTER_WORDS);

  constructor(private readonly workspaceMatches: (rootPath: string) => boolean) {}

  add(path: string): void {
    for (const seed of RETIRED_PATH_FILTER_SEEDS) {
      const bit = retiredPathHash(path, seed) % (this.words.length * 32);
      this.words[bit >>> 5] |= 1 << (bit & 31);
    }
  }

  mightContain(path: string): boolean {
    for (const seed of RETIRED_PATH_FILTER_SEEDS) {
      const bit = retiredPathHash(path, seed) % (this.words.length * 32);
      if ((this.words[bit >>> 5]! & (1 << (bit & 31))) === 0) return false;
    }
    return true;
  }

  matches(rootPath: string): boolean {
    try {
      return this.workspaceMatches(rootPath) === true;
    } catch {
      return true;
    }
  }
}

class RegisteredRetiredExactLiveSavePathFilter {
  private readonly words = new Uint32Array(RETIRED_PATH_FILTER_WORDS);

  add(relativePath: string): void {
    for (const seed of RETIRED_PATH_FILTER_SEEDS) {
      const bit = retiredPathHash(relativePath, seed) % (this.words.length * 32);
      this.words[bit >>> 5] |= 1 << (bit & 31);
    }
  }

  mightContain(relativePath: string): boolean {
    for (const seed of RETIRED_PATH_FILTER_SEEDS) {
      const bit = retiredPathHash(relativePath, seed) % (this.words.length * 32);
      if ((this.words[bit >>> 5]! & (1 << (bit & 31))) === 0) return false;
    }
    return true;
  }
}

function retiredPathHash(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const MAX_RETAINED_EXACT_LIVE_SAVE_BINDINGS = 64;
const RETIRED_PATH_FILTER_WORDS = 32_768;
const RETIRED_PATH_FILTER_SEEDS = Object.freeze([0x811c9dc5, 0x9e3779b1, 0x85ebca77]);
