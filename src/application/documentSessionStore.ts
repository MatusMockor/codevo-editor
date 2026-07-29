import {
  UNAVAILABLE_DOCUMENT_SESSION_DOCUMENT_SNAPSHOT,
  UNAVAILABLE_DOCUMENT_SESSION_OWNER_SNAPSHOT,
  type DocumentSessionDocumentLease,
  type DocumentSessionDocumentSnapshot,
  type DocumentSessionLiveAttachmentLease,
  type DocumentSessionLiveAttachmentResult,
  type DocumentSessionLiveCheckpoint,
  type DocumentSessionLiveCheckpointResult,
  type DocumentSessionLiveSynchronizationPermit,
  type DocumentSessionMutationResult,
  type DocumentSessionOwnerLease,
  type DocumentSessionOwnerSnapshot,
  type DocumentSessionReceipt,
  type DocumentSessionSavePermit,
  type DocumentSessionStoreLimits,
  isDocumentSessionEditorDocument,
} from "../domain/documentSession";
import { isDirty, type EditorDocument } from "../domain/workspace";
import {
  isRegisteredDocumentSaveWorkspaceId,
  registeredDocumentSaveIdentityFromSelectedPath,
  registeredDocumentSaveIdentityKey,
  registeredDocumentSaveIdentityMatches,
  type ResolveDocumentSaveOwnership,
} from "./documentSaveIdentity";
import type {
  DocumentSessionOpenInput,
  DocumentSessionOpenResult,
  DocumentSessionCompatibilityProjectionActivation,
  DocumentSessionCompatibilityProjectionLease,
  DocumentSessionCompatibilityReconciliation,
  DocumentSessionCompatibilityReconciliationResult,
  DocumentSessionLiveAttachmentInput,
  DocumentSessionOwnerActivation,
  DocumentSessionOwnerInput,
  DocumentSessionStorePort,
} from "./documentSessionStorePort";
import {
  acknowledgeLiveSaveCheckpoint,
  issueLegacySavePermit,
  issuedSaveBytesThrough,
  issuedLiveSaveAttachmentIsCurrent,
  issuedLiveSaveIsCurrent,
  liveSaveCheckpointMatches,
  MAX_ISSUED_SAVES_PER_DOCUMENT,
  prepareAdvancedLiveSavePermit,
  prepareLiveSavePermit,
  prepareReplacementLiveSavePermit,
  removeIssuedSave,
  removeIssuedSavesThrough,
  replaceIssuedSaveRecord,
  snapshotSaveAcknowledgement,
  snapshotDocumentSessionReceipt,
  storeIssuedSaveRecord,
  type DocumentSessionIssuedSaveRecord,
  validIssuedSavePermitShape,
} from "./documentSessionLiveSavePermit";
import {
  editorDocumentsEqual,
  estimatedDocumentBytes,
  freezeDocument,
  freezeLiveCheckpoint,
  liveCheckpointsEqual,
  validOwnerInput,
  workspaceFileRevisionsEqual,
} from "./documentSessionStoreValue";

export const DEFAULT_DOCUMENT_SESSION_STORE_LIMITS: DocumentSessionStoreLimits = Object.freeze({
  maxDocumentsPerOwner: 256,
  maxOwners: 16,
  maxRetainedDocuments: 1_024,
  maxRetainedEstimatedBytes: 128 * 1024 * 1024,
});
const MAX_LIVE_DOCUMENT_HOLDERS = 16;

interface DocumentSubscriber {
  readonly lease: DocumentSessionDocumentLease;
  readonly listener: () => void;
}

interface OwnerSubscriber {
  readonly lease: DocumentSessionOwnerLease;
  readonly listener: () => void;
}

interface StoredDocument {
  readonly issuedSaves: Map<number, DocumentSessionIssuedSaveRecord>;
  issuedSaveEstimatedBytes: number;
  liveAttachment: StoredLiveAttachment | null;
  liveDirty: boolean;
  liveSynchronization: DocumentSessionLiveSynchronizationPermit | null;
  nextSaveSequence: number;
  contentVersion: number;
  document: Readonly<EditorDocument>;
  readonly incarnation: object;
  readonly identityKey: string;
  lastAccess: number;
  readonly subscribers: Set<DocumentSubscriber>;
  snapshot: AvailableDocumentSnapshot;
  version: number;
}

interface StoredLiveAttachment {
  checkpoint: DocumentSessionLiveCheckpoint;
  readonly holders: Map<object, StoredLiveHolder>;
  savedAlternativeVersionId: number | null;
  savedUtf16Length: number | null;
  readonly sourceIncarnation: object;
}

interface StoredLiveHolder {
  lastCheckpoint: DocumentSessionLiveCheckpoint;
  readonly lease: DocumentSessionLiveAttachmentLease;
}

interface StoredOwner {
  active: boolean;
  readonly canonicalRoot: string;
  compatibilityProjection: StoredCompatibilityProjection | null;
  dirtyCount: number;
  readonly documents: Map<string, StoredDocument>;
  generation: number;
  incarnation: object;
  lastAccess: number;
  readonly ownerKey: DocumentSessionOwnerLease["ownerKey"];
  resolveOwnership: ResolveDocumentSaveOwnership;
  retainedEstimatedBytes: number;
  rootPath: string;
  snapshot: DocumentSessionOwnerSnapshot;
  readonly subscribers: Set<OwnerSubscriber>;
  readonly workspaceId: string;
}

interface StoredCompatibilityProjection {
  readonly activation: DocumentSessionCompatibilityProjectionActivation;
  readonly clear: () => void;
  readonly deleteDocument: (path: string) => void;
  readonly replaceAll: (documents: Readonly<Record<string, Readonly<EditorDocument>>>) => void;
  readonly setDocument: (document: Readonly<EditorDocument>) => void;
}

type AvailableDocumentSnapshot = Extract<
  DocumentSessionDocumentSnapshot,
  { readonly status: "available" }
>;

export class DocumentSessionStore implements DocumentSessionStorePort {
  private activeOwner: StoredOwner | null = null;
  private accessClock = 0;
  private documentCount = 0;
  private generation = 0;
  private readonly issuedLiveAttachments = new WeakSet<object>();
  private readonly limits: DocumentSessionStoreLimits;
  private readonly owners = new Map<string, StoredOwner>();
  private retainedEstimatedBytes = 0;
  private readonly pendingLiveDetachments = new Map<object, DocumentSessionLiveAttachmentLease>();
  private publishing = false;

  constructor(
    limits: DocumentSessionStoreLimits = DEFAULT_DOCUMENT_SESSION_STORE_LIMITS,
    private readonly reportSubscriberError: (error: unknown) => void = () => undefined,
  ) {
    this.limits = validateLimits(limits);
  }

  activateOwner(
    input: DocumentSessionOwnerInput,
    resolveOwnership?: ResolveDocumentSaveOwnership,
  ): DocumentSessionOwnerActivation {
    if (this.publishing) {
      return rejectedAdmission("reentrant-operation");
    }
    if (!validOwnerInput(input) || !isRegisteredDocumentSaveWorkspaceId(input.workspaceId)) {
      return rejectedAdmission("invalid-owner");
    }

    const existing = this.owners.get(input.ownerKey);
    if (
      existing &&
      (existing.canonicalRoot !== input.canonicalRoot ||
        existing.rootPath !== input.rootPath ||
        existing.workspaceId !== input.workspaceId)
    ) {
      return rejectedAdmission("invalid-owner");
    }
    if (
      existing &&
      [...existing.documents.values()].some((document) => document.issuedSaves.size > 0)
    ) {
      return rejectedAdmission("save-in-flight");
    }
    const ownerToEvict = existing ? null : this.ownerEvictionCandidate();
    if (!existing && this.owners.size >= this.limits.maxOwners && !ownerToEvict) {
      return rejectedAdmission("owner-limit");
    }

    const previousOwner = this.activeOwner;
    if (previousOwner) this.retireActiveOwner(previousOwner);
    if (ownerToEvict) this.evictOwner(ownerToEvict);
    const effectiveResolveOwnership =
      resolveOwnership ??
      ((rootPath: string, path: string) =>
        registeredDocumentSaveIdentityFromSelectedPath(
          input.workspaceId,
          input.canonicalRoot,
          rootPath,
          path,
        ));
    const owner = existing ?? this.createOwner(input);
    owner.active = true;
    owner.generation = ++this.generation;
    owner.incarnation = Object.freeze({});
    owner.rootPath = input.rootPath;
    owner.resolveOwnership = effectiveResolveOwnership;
    owner.lastAccess = this.tick();
    this.activeOwner = owner;
    this.refreshOwnerSnapshot(owner);

    return {
      lease: ownerLease(owner),
      status: "activated",
    };
  }

  deactivateOwner(lease: DocumentSessionOwnerLease): boolean {
    if (this.publishing) {
      return false;
    }
    const owner = this.currentOwner(lease);
    if (!owner) {
      return false;
    }

    this.retireActiveOwner(owner);
    return true;
  }

  open(
    lease: DocumentSessionOwnerLease,
    input: DocumentSessionOpenInput,
  ): DocumentSessionOpenResult {
    if (this.publishing) {
      return rejectedAdmission("reentrant-operation");
    }
    const owner = this.currentOwner(lease);
    const identityKey = owner
      ? registeredDocumentSaveIdentityKey(owner.workspaceId, owner.canonicalRoot, input.identity)
      : null;
    if (
      !owner ||
      !identityKey ||
      !isDocumentSessionEditorDocument(input.document) ||
      !documentBelongsToOwner(owner, input)
    ) {
      return rejectedAdmission("invalid-document");
    }

    const existing = owner.documents.get(identityKey);
    if (existing) {
      if (existing.document.path !== input.document.path) {
        return rejectedAdmission("invalid-document");
      }
      existing.lastAccess = this.tick();
      return { lease: documentLease(lease, existing), status: "opened" };
    }

    if (owner.documents.size >= this.limits.maxDocumentsPerOwner) {
      return rejectedAdmission("document-limit");
    }

    const document = freezeDocument(input.document);
    const estimatedBytes = estimatedDocumentBytes(document);
    if (estimatedBytes > this.limits.maxRetainedEstimatedBytes) {
      return rejectedAdmission("content-budget");
    }
    if (!this.makeDocumentCapacity(1, estimatedBytes)) {
      return rejectedAdmission(
        this.documentCount >= this.limits.maxRetainedDocuments
          ? "document-limit"
          : "content-budget",
      );
    }

    const stored = this.createStoredDocument(identityKey, document);
    owner.documents.set(identityKey, stored);
    owner.dirtyCount += isDirty(document) ? 1 : 0;
    owner.retainedEstimatedBytes += stored.snapshot.estimatedRetainedBytes;
    owner.lastAccess = this.tick();
    this.documentCount += 1;
    this.retainedEstimatedBytes += stored.snapshot.estimatedRetainedBytes;
    owner.compatibilityProjection?.setDocument(stored.document);
    this.refreshOwnerSnapshot(owner);
    this.emitOwner(owner);

    return { lease: documentLease(lease, stored), status: "opened" };
  }

  createCompatibilityProjection(
    lease: DocumentSessionOwnerLease,
  ): DocumentSessionCompatibilityProjectionActivation | null {
    const owner = this.currentOwner(lease);
    if (!owner || this.publishing) {
      return null;
    }
    if (!owner.compatibilityProjection) {
      owner.compatibilityProjection = createStoredCompatibilityProjection(lease, owner.documents);
    }
    return owner.compatibilityProjection.activation;
  }

  reconcileCompatibilityProjection(
    lease: DocumentSessionOwnerLease,
    projectionLease: DocumentSessionCompatibilityProjectionLease,
    reconciliation: DocumentSessionCompatibilityReconciliation,
  ): DocumentSessionCompatibilityReconciliationResult {
    if (this.publishing) {
      return rejectedCompatibilityReconciliation("reentrant-operation");
    }
    const owner = this.currentOwner(lease);
    if (
      !owner ||
      !owner.compatibilityProjection ||
      !compatibilityProjectionLeaseEqual(
        owner.compatibilityProjection.activation.lease,
        projectionLease,
      ) ||
      reconciliation.ownerSnapshot !== owner.snapshot
    ) {
      return rejectedCompatibilityReconciliation(owner ? "stale-receipt" : "invalid-owner");
    }
    if (
      reconciliation.documents.length > this.limits.maxDocumentsPerOwner ||
      reconciliation.documents.length > this.limits.maxRetainedDocuments ||
      reconciliation.removals.length > this.limits.maxDocumentsPerOwner
    ) {
      return rejectedCompatibilityReconciliation("document-limit");
    }

    const prepared = new Map<
      string,
      {
        readonly document: Readonly<EditorDocument>;
        readonly existing: StoredDocument | null;
      }
    >();
    const preparedPaths = new Set<string>();
    const acceptedProjection: Record<string, Readonly<EditorDocument>> = Object.create(
      null,
    ) as Record<string, Readonly<EditorDocument>>;
    const removals = new Map<
      string,
      { readonly discardDirty: boolean; readonly document: StoredDocument }
    >();
    for (const removal of reconciliation.removals) {
      const resolved = this.documentForReceipt(removal.receipt);
      if (!resolved || resolved.owner !== owner || removals.has(removal.receipt.identityKey)) {
        return rejectedCompatibilityReconciliation("stale-receipt");
      }
      removals.set(removal.receipt.identityKey, {
        discardDirty: removal.discardDirty,
        document: resolved.document,
      });
    }
    let desiredBytes = 0;
    for (const candidate of reconciliation.documents) {
      const identityKey = registeredDocumentSaveIdentityKey(
        owner.workspaceId,
        owner.canonicalRoot,
        candidate.identity,
      );
      if (
        !identityKey ||
        prepared.has(identityKey) ||
        preparedPaths.has(candidate.document.path) ||
        !isDocumentSessionEditorDocument(candidate.document) ||
        !documentBelongsToOwner(owner, candidate)
      ) {
        return rejectedCompatibilityReconciliation("invalid-document");
      }

      const existing = owner.documents.get(identityKey) ?? null;
      if (
        (existing === null && candidate.receipt !== null) ||
        (existing !== null &&
          (candidate.receipt === null ||
            this.documentForReceipt(candidate.receipt)?.document !== existing ||
            existing.document.path !== candidate.document.path))
      ) {
        return rejectedCompatibilityReconciliation("stale-receipt");
      }
      if (
        existing &&
        existing.issuedSaves.size > 0 &&
        (existing.document.savedContent !== candidate.document.savedContent ||
          !workspaceFileRevisionsEqual(existing.document.revision, candidate.document.revision))
      ) {
        return rejectedCompatibilityReconciliation("save-in-flight");
      }

      const document = freezeDocument(candidate.document);
      preparedPaths.add(document.path);
      acceptedProjection[document.path] =
        existing && editorDocumentsEqual(existing.document, document)
          ? existing.document
          : document;
      desiredBytes += estimatedDocumentBytes(document);
      if (
        !Number.isSafeInteger(desiredBytes) ||
        desiredBytes > this.limits.maxRetainedEstimatedBytes
      ) {
        return rejectedCompatibilityReconciliation("content-budget");
      }
      prepared.set(identityKey, { document, existing });
    }

    const removed = [...owner.documents.values()].filter(
      (document) => !prepared.has(document.identityKey),
    );
    if (
      removals.size !== removed.length ||
      [...removals.values()].some((removal) => !removed.includes(removal.document))
    ) {
      return rejectedCompatibilityReconciliation("invalid-document");
    }
    if (removed.some((document) => document.issuedSaves.size > 0)) {
      return rejectedCompatibilityReconciliation("save-in-flight");
    }
    if (
      removed.some(
        (document) =>
          effectiveDirty(document) && removals.get(document.identityKey)?.discardDirty !== true,
      )
    ) {
      return rejectedCompatibilityReconciliation("dirty-document");
    }

    const projectedDocumentCount = this.documentCount - owner.documents.size + prepared.size;
    const projectedBytes =
      this.retainedEstimatedBytes - owner.retainedEstimatedBytes + desiredBytes;
    const evictionPlan = this.documentCapacityPlan(projectedDocumentCount, projectedBytes);
    if (!evictionPlan) {
      return rejectedCompatibilityReconciliation(
        projectedDocumentCount > this.limits.maxRetainedDocuments
          ? "document-limit"
          : "content-budget",
      );
    }

    for (const candidate of evictionPlan) {
      this.removeDocument(candidate.owner, candidate.document);
    }

    const previousDirtyCount = owner.dirtyCount;
    const previousIdentityKeys =
      owner.snapshot.status === "active" ? owner.snapshot.identityKeys : [];
    const changedDocuments: StoredDocument[] = [];
    for (const document of removed) {
      this.removeDocument(owner, document, false);
      changedDocuments.push(document);
    }
    for (const [identityKey, candidate] of prepared) {
      if (candidate.existing) {
        candidate.existing.liveSynchronization = null;
        if (!editorDocumentsEqual(candidate.existing.document, candidate.document)) {
          const wasDirty = effectiveDirty(candidate.existing);
          const contentChanged = candidate.existing.document.content !== candidate.document.content;
          this.replaceStoredDocument(owner, candidate.existing, candidate.document, contentChanged);
          const dirty = effectiveDirty(candidate.existing);
          owner.dirtyCount += dirty === wasDirty ? 0 : dirty ? 1 : -1;
          changedDocuments.push(candidate.existing);
        }
        continue;
      }

      const stored = this.createStoredDocument(identityKey, candidate.document);
      owner.documents.set(identityKey, stored);
      owner.dirtyCount += isDirty(stored.document) ? 1 : 0;
      owner.retainedEstimatedBytes += stored.snapshot.estimatedRetainedBytes;
      owner.lastAccess = this.tick();
      this.documentCount += 1;
      this.retainedEstimatedBytes += stored.snapshot.estimatedRetainedBytes;
    }

    const topologyChanged =
      previousIdentityKeys.length !== owner.documents.size ||
      previousIdentityKeys.some((identityKey) => !owner.documents.has(identityKey));
    if (topologyChanged || previousDirtyCount !== owner.dirtyCount) {
      this.refreshOwnerSnapshot(owner);
    }
    owner.compatibilityProjection.replaceAll(acceptedProjection);
    if (topologyChanged || previousDirtyCount !== owner.dirtyCount) {
      this.emitOwner(owner);
    }
    for (const document of changedDocuments) {
      this.emitDocument(owner, document);
    }

    return {
      documents: Object.freeze(
        [...prepared.entries()].map(([identityKey, candidate]) => {
          const document = candidate.existing ?? owner.documents.get(identityKey);
          if (!document) {
            throw new Error("Reconciled document was not retained.");
          }
          return Object.freeze({
            lease: documentLease(lease, document),
            snapshot: document.snapshot,
          });
        }),
      ),
      ownerSnapshot: owner.snapshot as Extract<
        DocumentSessionOwnerSnapshot,
        { readonly status: "active" }
      >,
      status: "applied",
    };
  }

  resolve(
    lease: DocumentSessionOwnerLease,
    identity: DocumentSessionOpenInput["identity"],
  ): DocumentSessionDocumentLease | null {
    const owner = this.currentOwner(lease);
    const identityKey = owner
      ? registeredDocumentSaveIdentityKey(owner.workspaceId, owner.canonicalRoot, identity)
      : null;
    if (!owner || identity.canonicalRoot !== owner.canonicalRoot) {
      return null;
    }
    const document = identityKey ? owner?.documents.get(identityKey) : null;
    if (!owner || !document) {
      return null;
    }
    document.lastAccess = this.tick();
    return documentLease(lease, document);
  }

  capture(lease: DocumentSessionDocumentLease): DocumentSessionReceipt | null {
    const resolved = this.currentDocument(lease);
    return resolved ? receipt(lease.owner, resolved.document) : null;
  }

  isCurrent(candidate: DocumentSessionReceipt): boolean {
    const resolved = this.documentForReceipt(candidate);
    return Boolean(
      resolved &&
      resolved.document.version === candidate.version &&
      resolved.document.contentVersion === candidate.contentVersion,
    );
  }

  issueLiveDocumentSynchronization(
    candidate: DocumentSessionReceipt,
    sourceIncarnation: object,
    checkpoint: DocumentSessionLiveCheckpoint,
    capturedCurrentContent: string,
  ): DocumentSessionLiveSynchronizationPermit | null {
    if (
      this.publishing ||
      !this.isCurrent(candidate) ||
      !validAuthority(sourceIncarnation) ||
      !validLiveCheckpoint(checkpoint) ||
      typeof capturedCurrentContent !== "string"
    ) {
      return null;
    }
    const resolved = this.documentForReceipt(candidate);
    if (
      !resolved ||
      resolved.document.liveSynchronization ||
      capturedCurrentContent.length > Math.floor(this.limits.maxRetainedEstimatedBytes / 2) ||
      capturedCurrentContent !== resolved.document.document.savedContent
    ) {
      return null;
    }
    const permit = Object.freeze({
      authority: Object.freeze({}),
      checkpoint: freezeLiveCheckpoint(checkpoint),
      contentVersion: candidate.contentVersion,
      documentIncarnation: candidate.documentIncarnation,
      identityKey: candidate.identityKey,
      ownerGeneration: candidate.ownerGeneration,
      ownerIncarnation: candidate.ownerIncarnation,
      ownerKey: candidate.ownerKey,
      sourceIncarnation,
      version: candidate.version,
    });
    resolved.document.liveSynchronization = permit;
    return permit;
  }

  canJoinLiveDocument(
    candidate: DocumentSessionReceipt,
    sourceIncarnation: object,
    checkpoint: DocumentSessionLiveCheckpoint,
  ): boolean {
    if (
      this.publishing ||
      !this.isCurrent(candidate) ||
      !validAuthority(sourceIncarnation) ||
      !validLiveCheckpoint(checkpoint)
    ) {
      return false;
    }
    const current = this.documentForReceipt(candidate)?.document.liveAttachment;
    return Boolean(
      current &&
      current.sourceIncarnation === sourceIncarnation &&
      current.holders.size < MAX_LIVE_DOCUMENT_HOLDERS &&
      liveCheckpointsEqual(current.checkpoint, checkpoint),
    );
  }

  cancelLiveDocumentSynchronization(permit: DocumentSessionLiveSynchronizationPermit): boolean {
    const owner = this.owners.get(permit.ownerKey);
    const document = owner?.documents.get(permit.identityKey);
    if (document?.liveSynchronization === permit) {
      document.liveSynchronization = null;
    }
    return true;
  }

  attachLiveDocument(
    candidate: DocumentSessionReceipt,
    input: DocumentSessionLiveAttachmentInput,
  ): DocumentSessionLiveAttachmentResult {
    if (this.publishing) {
      return { reason: "reentrant-operation", status: "rejected" };
    }
    const validInput = validLiveAttachmentInput(input);
    if (!validInput || !this.isCurrent(candidate)) {
      return {
        reason: validInput ? "stale-receipt" : "invalid-checkpoint",
        status: "rejected",
      };
    }
    const resolved = this.documentForReceipt(candidate);
    if (!resolved) {
      return { reason: "stale-receipt", status: "rejected" };
    }
    const { document, owner } = resolved;
    const wasDirty = effectiveDirty(document);
    const current = document.liveAttachment;
    const sameSource = current?.sourceIncarnation === input.sourceIncarnation;
    const synchronized = input.synchronization
      ? this.consumeLiveSynchronization(
          candidate,
          input.synchronization,
          input.sourceIncarnation,
          input.checkpoint,
        )
      : false;
    if (input.synchronization && !synchronized) {
      return { reason: "stale-synchronization", status: "rejected" };
    }
    if (!sameSource) {
      document.liveSynchronization = null;
    }
    if (sameSource) {
      if (current.holders.has(input.holderIncarnation)) {
        return { reason: "duplicate-holder", status: "rejected" };
      }
      if (current.holders.size >= MAX_LIVE_DOCUMENT_HOLDERS) {
        return { reason: "attachment-limit", status: "rejected" };
      }
      if (!liveCheckpointsEqual(current.checkpoint, input.checkpoint)) {
        return { reason: "stale-checkpoint", status: "rejected" };
      }
    }
    const attachment = Object.freeze({
      authority: Object.freeze({}),
      documentIncarnation: document.incarnation,
      holderIncarnation: input.holderIncarnation,
      identityKey: document.identityKey,
      ownerGeneration: candidate.ownerGeneration,
      ownerIncarnation: candidate.ownerIncarnation,
      ownerKey: candidate.ownerKey,
      sourceIncarnation: input.sourceIncarnation,
    });
    if (sameSource) {
      current.holders.set(input.holderIncarnation, {
        lastCheckpoint: current.checkpoint,
        lease: attachment,
      });
    } else {
      const baseCheckpoint = freezeLiveCheckpoint(input.checkpoint);
      const synchronizedCleanBase =
        synchronized &&
        !wasDirty &&
        baseCheckpoint.utf16Length !== null &&
        baseCheckpoint.utf16Length === document.document.content.length;
      document.liveDirty = !synchronizedCleanBase;
      document.liveAttachment = {
        checkpoint: baseCheckpoint,
        holders: new Map([
          [input.holderIncarnation, { lastCheckpoint: baseCheckpoint, lease: attachment }],
        ]),
        savedAlternativeVersionId: synchronizedCleanBase
          ? input.checkpoint.alternativeVersionId
          : null,
        savedUtf16Length: synchronizedCleanBase ? input.checkpoint.utf16Length : null,
        sourceIncarnation: input.sourceIncarnation,
      };
    }
    document.lastAccess = this.tick();
    owner.lastAccess = this.tick();
    this.issuedLiveAttachments.add(attachment);
    const dirty = effectiveDirty(document);
    if (wasDirty !== dirty) {
      this.refreshDocumentSnapshot(document);
      this.publishDirtyTransition(owner, wasDirty, dirty);
      this.emitDocument(owner, document);
    }
    return { attachment, status: "attached" };
  }

  checkpointLiveDocument(
    attachment: DocumentSessionLiveAttachmentLease,
    checkpoint: DocumentSessionLiveCheckpoint,
  ): DocumentSessionLiveCheckpointResult {
    if (this.publishing) {
      return { reason: "reentrant-operation", status: "rejected" };
    }
    if (!validLiveCheckpoint(checkpoint)) {
      return { reason: "invalid-checkpoint", status: "rejected" };
    }
    const resolved = this.documentForLiveAttachment(attachment);
    if (!resolved) {
      return { reason: "stale-attachment", status: "rejected" };
    }
    const { document, owner } = resolved;
    const current = document.liveAttachment;
    const holder = current?.holders.get(attachment.holderIncarnation);
    if (!current || !holder || holder.lease !== attachment) {
      return { reason: "stale-attachment", status: "rejected" };
    }
    if (
      checkpoint.contentVersion <= holder.lastCheckpoint.contentVersion ||
      checkpoint.modelVersionId <= holder.lastCheckpoint.modelVersionId
    ) {
      return { reason: "stale-attachment", status: "rejected" };
    }
    if (liveCheckpointsEqual(current.checkpoint, checkpoint)) {
      holder.lastCheckpoint = current.checkpoint;
      return { dirty: effectiveDirty(document), status: "applied" };
    }
    if (
      checkpoint.contentVersion <= current.checkpoint.contentVersion ||
      checkpoint.modelVersionId <= current.checkpoint.modelVersionId
    ) {
      return { reason: "stale-attachment", status: "rejected" };
    }

    const wasDirty = effectiveDirty(document);
    const nextCheckpoint = freezeLiveCheckpoint(checkpoint);
    document.liveDirty =
      current.savedAlternativeVersionId === null ||
      current.savedUtf16Length === null ||
      nextCheckpoint.alternativeVersionId !== current.savedAlternativeVersionId ||
      nextCheckpoint.utf16Length !== current.savedUtf16Length;
    current.checkpoint = nextCheckpoint;
    holder.lastCheckpoint = nextCheckpoint;
    document.lastAccess = this.tick();
    owner.lastAccess = this.tick();
    const dirty = effectiveDirty(document);
    if (wasDirty !== dirty) {
      this.refreshDocumentSnapshot(document);
      this.publishDirtyTransition(owner, wasDirty, dirty);
      this.emitDocument(owner, document);
    }
    return { dirty, status: "applied" };
  }

  detachLiveDocument(attachment: DocumentSessionLiveAttachmentLease): boolean {
    if (!validAuthority(attachment) || !this.issuedLiveAttachments.has(attachment)) {
      return false;
    }
    if (this.publishing) {
      if (
        !validAuthority(attachment?.authority) ||
        (!this.pendingLiveDetachments.has(attachment.authority) &&
          this.pendingLiveDetachments.size >= MAX_LIVE_DOCUMENT_HOLDERS)
      ) {
        return false;
      }
      this.pendingLiveDetachments.set(attachment.authority, attachment);
      return true;
    }
    const resolved = this.documentForLiveAttachment(attachment);
    if (!resolved) {
      return true;
    }
    const current = resolved.document.liveAttachment;
    if (!current || !current.holders.delete(attachment.holderIncarnation)) {
      return true;
    }
    return true;
  }

  edit(candidate: DocumentSessionReceipt, content: string): DocumentSessionMutationResult {
    if (this.publishing) {
      return rejectedMutation("reentrant-operation");
    }
    if (typeof content !== "string" || !this.isCurrent(candidate)) {
      return rejectedMutation("stale-receipt");
    }
    const resolved = this.documentForReceipt(candidate);
    if (!resolved) {
      return rejectedMutation("stale-receipt");
    }
    const { document, owner } = resolved;
    if (document.document.readOnly === true) {
      return rejectedMutation("invalid-document");
    }
    if (document.document.content === content) {
      return applied(document, receipt(ownerLease(owner), document));
    }

    const nextDocument = freezeDocument({ ...document.document, content });
    const nextBytes = estimatedDocumentBytes(nextDocument);
    const additionalBytes = nextBytes - document.snapshot.estimatedRetainedBytes;
    if (additionalBytes > 0 && !this.makeDocumentCapacity(0, additionalBytes)) {
      return rejectedMutation("content-budget");
    }

    const wasDirty = effectiveDirty(document);
    this.replaceStoredDocument(owner, document, nextDocument, true);
    this.publishDirtyTransition(owner, wasDirty, effectiveDirty(document));
    this.emitDocument(owner, document);
    return applied(document, receipt(ownerLease(owner), document));
  }

  issueSave(candidate: DocumentSessionReceipt) {
    if (this.publishing) return null;
    const receipt = snapshotDocumentSessionReceipt(candidate);
    const resolved = receipt ? this.documentForReceipt(receipt) : null;
    const issued = resolved
      ? issueLegacySavePermit(resolved.document, receipt!, (bytes) =>
          this.makeDocumentCapacity(0, bytes),
        )
      : null;
    if (!issued) return null;
    this.retainedEstimatedBytes += issued.bytes;
    return issued.permit;
  }

  issueLiveSave(
    candidate: DocumentSessionReceipt,
    attachment: DocumentSessionLiveAttachmentLease,
    checkpoint: DocumentSessionLiveCheckpoint,
    capturedSnapshotContent: string,
  ) {
    if (this.publishing) return null;
    const receipt = snapshotDocumentSessionReceipt(candidate);
    const byReceipt = receipt ? this.documentForReceipt(receipt) : null;
    if (!byReceipt) return null;
    const document = byReceipt.document;
    if (
      document.document.readOnly === true ||
      document.issuedSaves.size >= MAX_ISSUED_SAVES_PER_DOCUMENT
    ) {
      return null;
    }
    const prepared = prepareLiveSavePermit({
      attachment,
      checkpoint,
      content: capturedSnapshotContent,
      receipt: receipt!,
      sequence: byReceipt.document.nextSaveSequence + 1,
    });
    if (!prepared) return null;
    const byAttachment = this.documentForLiveAttachment(attachment);
    if (!byAttachment || document !== byAttachment.document) {
      return null;
    }
    if (
      !liveSaveCheckpointMatches(
        document.liveAttachment,
        attachment,
        prepared.record.liveCheckpoint!,
      )
    ) {
      return null;
    }
    const bytes = storeIssuedSaveRecord(
      document,
      prepared.permit.sequence,
      prepared.record,
      (size) => this.makeDocumentCapacity(0, size),
    );
    if (bytes === null) return null;
    document.nextSaveSequence = prepared.permit.sequence;
    this.retainedEstimatedBytes += bytes;
    return prepared.permit;
  }

  cancelSave(permit: DocumentSessionSavePermit) {
    if (this.publishing) return false;
    const resolved = this.documentForIssuedPermit(permit);
    if (!resolved) return false;
    this.retainedEstimatedBytes -= removeIssuedSave(resolved.document, permit.sequence);
    return true;
  }

  advanceIssuedLiveSave(
    permit: DocumentSessionSavePermit,
    checkpoint: DocumentSessionLiveCheckpoint,
    content: string,
  ) {
    if (this.publishing) return null;
    const resolved = this.documentForIssuedPermit(permit);
    const issued = resolved?.document.issuedSaves.get(permit.sequence);
    if (!resolved || !issued) return null;
    const prepared = prepareAdvancedLiveSavePermit({
      checkpoint,
      content,
      current: resolved.document.liveAttachment,
      issued,
    });
    if (!prepared) return null;
    const appliedDelta = replaceIssuedSaveRecord(
      resolved.document,
      permit.sequence,
      issued,
      prepared.record,
      (bytes) => this.makeDocumentCapacity(0, bytes),
    );
    if (appliedDelta === null) return null;
    this.retainedEstimatedBytes += appliedDelta;
    return prepared.permit;
  }

  isIssuedSaveCurrent(permit: DocumentSessionSavePermit) {
    const document = this.documentForIssuedPermit(permit)?.document;
    return (
      !!document &&
      issuedLiveSaveIsCurrent(document.liveAttachment, document.issuedSaves.get(permit.sequence))
    );
  }

  replaceIssuedSaveContent(
    permit: DocumentSessionSavePermit,
    content: string,
  ): DocumentSessionSavePermit | null {
    if (this.publishing) return null;
    const resolved = this.documentForIssuedPermit(permit);
    const issued = resolved?.document.issuedSaves.get(permit.sequence);
    if (!resolved || !issued) return null;
    const prepared = prepareReplacementLiveSavePermit(
      resolved.document.liveAttachment,
      issued,
      content,
    );
    if (!prepared) return null;
    const appliedDelta = replaceIssuedSaveRecord(
      resolved.document,
      permit.sequence,
      issued,
      prepared.record,
      (bytes) => this.makeDocumentCapacity(0, bytes),
    );
    if (appliedDelta === null) return null;
    this.retainedEstimatedBytes += appliedDelta;
    return prepared.permit;
  }

  acknowledgeSave(
    permit: DocumentSessionSavePermit,
    acknowledgement: { readonly revision: EditorDocument["revision"] },
  ): DocumentSessionMutationResult {
    if (this.publishing) {
      return rejectedMutation("reentrant-operation");
    }
    const exactAcknowledgement = snapshotSaveAcknowledgement(acknowledgement);
    if (!exactAcknowledgement) {
      return rejectedMutation("invalid-document");
    }
    const resolved = this.documentForIssuedPermit(permit);
    if (!resolved) {
      return rejectedMutation("stale-receipt");
    }
    const { document, owner } = resolved;
    const issuedSave = document.issuedSaves.get(permit.sequence);
    if (!issuedLiveSaveAttachmentIsCurrent(document.liveAttachment, issuedSave)) {
      this.retainedEstimatedBytes -= removeIssuedSave(document, permit.sequence);
      return rejectedMutation("stale-receipt");
    }
    const isLiveSave = issuedSave?.liveAttachment != null;
    const nextDocument = freezeDocument({
      ...document.document,
      ...(isLiveSave ? { content: permit.writtenContent } : {}),
      revision: exactAcknowledgement.revision,
      savedContent: permit.writtenContent,
    });
    const nextBytes = estimatedDocumentBytes(nextDocument);
    const additionalBytes = nextBytes - document.snapshot.estimatedRetainedBytes;
    const releasableSaveBytes = issuedSaveBytesThrough(document, permit.sequence);
    if (
      additionalBytes > releasableSaveBytes &&
      !this.makeDocumentCapacity(0, additionalBytes - releasableSaveBytes)
    ) {
      return rejectedMutation("content-budget");
    }
    if (!issuedLiveSaveAttachmentIsCurrent(document.liveAttachment, issuedSave)) {
      this.retainedEstimatedBytes -= removeIssuedSave(document, permit.sequence);
      return rejectedMutation("stale-receipt");
    }
    this.retainedEstimatedBytes -= removeIssuedSavesThrough(document, permit.sequence);

    const wasDirty = effectiveDirty(document);
    this.replaceStoredDocument(owner, document, nextDocument, false);
    const liveDirty = issuedSave
      ? acknowledgeLiveSaveCheckpoint(
          document.liveAttachment,
          issuedSave,
          permit.writtenContent.length,
        )
      : null;
    if (liveDirty !== null) {
      document.liveDirty = liveDirty;
      this.refreshDocumentSnapshot(document);
    }
    this.publishDirtyTransition(owner, wasDirty, effectiveDirty(document));
    this.emitDocument(owner, document);
    return applied(document, receipt(ownerLease(owner), document));
  }

  close(
    candidate: DocumentSessionReceipt,
    options: { readonly discardDirty?: boolean } = {},
  ): DocumentSessionMutationResult {
    if (this.publishing) {
      return rejectedMutation("reentrant-operation");
    }
    if (!this.isCurrent(candidate)) {
      return rejectedMutation("stale-receipt");
    }
    const resolved = this.documentForReceipt(candidate);
    if (!resolved) {
      return rejectedMutation("stale-receipt");
    }
    const { document, owner } = resolved;
    if (document.issuedSaves.size > 0) {
      return rejectedMutation("save-in-flight");
    }
    if (effectiveDirty(document) && options.discardDirty !== true) {
      return rejectedMutation("dirty-document");
    }

    const lastSnapshot = document.snapshot;
    this.removeDocument(owner, document);
    this.emitDocument(owner, document);
    return {
      receipt: candidate,
      snapshot: lastSnapshot,
      status: "applied",
    };
  }

  getDocumentSnapshot(lease: DocumentSessionDocumentLease): DocumentSessionDocumentSnapshot {
    return (
      this.storedDocumentForLease(lease)?.snapshot ?? UNAVAILABLE_DOCUMENT_SESSION_DOCUMENT_SNAPSHOT
    );
  }

  getOwnerSnapshot(lease: DocumentSessionOwnerLease): DocumentSessionOwnerSnapshot {
    return this.currentOwner(lease)?.snapshot ?? UNAVAILABLE_DOCUMENT_SESSION_OWNER_SNAPSHOT;
  }

  subscribeDocument(lease: DocumentSessionDocumentLease, listener: () => void): () => void {
    const resolved = this.currentDocument(lease);
    if (!resolved) {
      return () => undefined;
    }
    const subscriber = { lease, listener };
    resolved.document.subscribers.add(subscriber);
    return () => resolved.document.subscribers.delete(subscriber);
  }

  subscribeOwner(lease: DocumentSessionOwnerLease, listener: () => void): () => void {
    const owner = this.currentOwner(lease);
    if (!owner) {
      return () => undefined;
    }
    const subscriber = { lease, listener };
    owner.subscribers.add(subscriber);
    return () => owner.subscribers.delete(subscriber);
  }

  private createOwner(input: DocumentSessionOwnerInput): StoredOwner {
    const owner: StoredOwner = {
      active: false,
      canonicalRoot: input.canonicalRoot,
      compatibilityProjection: null,
      dirtyCount: 0,
      documents: new Map(),
      generation: 0,
      incarnation: Object.freeze({}),
      lastAccess: this.tick(),
      ownerKey: input.ownerKey,
      resolveOwnership: (rootPath, path) =>
        registeredDocumentSaveIdentityFromSelectedPath(
          input.workspaceId,
          input.canonicalRoot,
          rootPath,
          path,
        ),
      retainedEstimatedBytes: 0,
      rootPath: input.rootPath,
      snapshot: UNAVAILABLE_DOCUMENT_SESSION_OWNER_SNAPSHOT,
      subscribers: new Set(),
      workspaceId: input.workspaceId,
    };
    this.owners.set(input.ownerKey, owner);
    return owner;
  }

  private createStoredDocument(
    identityKey: string,
    document: Readonly<EditorDocument>,
  ): StoredDocument {
    return {
      contentVersion: 0,
      document,
      incarnation: Object.freeze({}),
      identityKey,
      issuedSaves: new Map(),
      issuedSaveEstimatedBytes: 0,
      lastAccess: this.tick(),
      liveAttachment: null,
      liveDirty: false,
      liveSynchronization: null,
      nextSaveSequence: 0,
      snapshot: availableSnapshot(document, 0, 0),
      subscribers: new Set(),
      version: 0,
    };
  }

  private retireActiveOwner(owner: StoredOwner): void {
    owner.compatibilityProjection?.clear();
    owner.compatibilityProjection = null;
    owner.active = false;
    owner.lastAccess = this.tick();
    if (this.activeOwner === owner) {
      this.activeOwner = null;
    }
    this.emitOwner(owner, true);
    this.pruneRetiredOwnerSubscribers(owner);
    for (const document of owner.documents.values()) {
      document.liveSynchronization = null;
      document.liveAttachment?.holders.clear();
      this.emitDocument(owner, document, true);
      this.pruneRetiredDocumentSubscribers(owner, document);
    }
  }

  private currentOwner(lease: DocumentSessionOwnerLease): StoredOwner | null {
    const owner = this.owners.get(lease.ownerKey);
    return owner?.active === true &&
      owner.generation === lease.generation &&
      owner.incarnation === lease.incarnation &&
      owner.canonicalRoot === lease.canonicalRoot &&
      owner.rootPath === lease.rootPath &&
      owner.workspaceId === lease.workspaceId
      ? owner
      : null;
  }

  private currentDocument(
    lease: DocumentSessionDocumentLease,
  ): { readonly document: StoredDocument; readonly owner: StoredOwner } | null {
    const owner = this.currentOwner(lease.owner);
    const document = owner?.documents.get(lease.identityKey);
    return owner &&
      document &&
      document.incarnation === lease.incarnation &&
      document.document.path === lease.path
      ? { document, owner }
      : null;
  }

  private storedDocumentForLease(lease: DocumentSessionDocumentLease): StoredDocument | null {
    const owner = this.currentOwner(lease.owner);
    const document = owner?.documents.get(lease.identityKey);
    return document &&
      document.incarnation === lease.incarnation &&
      document.document.path === lease.path
      ? document
      : null;
  }

  private documentForReceipt(
    candidate: DocumentSessionReceipt,
    requireVersion = true,
  ): { readonly document: StoredDocument; readonly owner: StoredOwner } | null {
    const owner = this.owners.get(candidate.ownerKey);
    const document = owner?.documents.get(candidate.identityKey);
    if (
      !owner ||
      !owner.active ||
      owner.generation !== candidate.ownerGeneration ||
      owner.incarnation !== candidate.ownerIncarnation ||
      !document ||
      document.incarnation !== candidate.documentIncarnation ||
      (requireVersion &&
        (document.version !== candidate.version ||
          document.contentVersion !== candidate.contentVersion))
    ) {
      return null;
    }
    return { document, owner };
  }

  private documentForIssuedPermit(
    permit: DocumentSessionSavePermit,
  ): { readonly document: StoredDocument; readonly owner: StoredOwner } | null {
    if (!validIssuedSavePermitShape(permit)) {
      return null;
    }
    try {
      const candidate = permit.receipt;
      const owner = this.owners.get(candidate.ownerKey);
      const document = owner?.documents.get(candidate.identityKey);
      const issued = document?.issuedSaves.get(permit.sequence);
      if (
        !owner ||
        owner.generation !== candidate.ownerGeneration ||
        owner.incarnation !== candidate.ownerIncarnation ||
        !document ||
        document.incarnation !== candidate.documentIncarnation ||
        issued?.authority !== permit.authority ||
        issued.permit !== permit
      ) {
        return null;
      }
      return { document, owner };
    } catch {
      return null;
    }
  }

  private consumeLiveSynchronization(
    candidate: DocumentSessionReceipt,
    permit: DocumentSessionLiveSynchronizationPermit,
    sourceIncarnation: object,
    checkpoint: DocumentSessionLiveCheckpoint,
  ): boolean {
    const resolved = this.documentForReceipt(candidate);
    if (!resolved || resolved.document.liveSynchronization !== permit) {
      return false;
    }
    resolved.document.liveSynchronization = null;
    return (
      liveCheckpointsEqual(permit.checkpoint, checkpoint) &&
      permit.contentVersion === candidate.contentVersion &&
      permit.documentIncarnation === candidate.documentIncarnation &&
      permit.identityKey === candidate.identityKey &&
      permit.ownerGeneration === candidate.ownerGeneration &&
      permit.ownerIncarnation === candidate.ownerIncarnation &&
      permit.ownerKey === candidate.ownerKey &&
      permit.sourceIncarnation === sourceIncarnation &&
      permit.version === candidate.version
    );
  }

  private documentForLiveAttachment(
    attachment: DocumentSessionLiveAttachmentLease,
  ): { readonly document: StoredDocument; readonly owner: StoredOwner } | null {
    const owner = this.owners.get(attachment.ownerKey);
    const document = owner?.documents.get(attachment.identityKey);
    return owner?.active === true &&
      owner.generation === attachment.ownerGeneration &&
      owner.incarnation === attachment.ownerIncarnation &&
      document?.incarnation === attachment.documentIncarnation &&
      document.liveAttachment?.sourceIncarnation === attachment.sourceIncarnation &&
      document.liveAttachment.holders.get(attachment.holderIncarnation)?.lease === attachment &&
      attachment.authority !== null
      ? { document, owner }
      : null;
  }

  private replaceStoredDocument(
    owner: StoredOwner,
    stored: StoredDocument,
    document: Readonly<EditorDocument>,
    contentChanged: boolean,
  ): void {
    const previousBytes = stored.snapshot.estimatedRetainedBytes;
    stored.liveSynchronization = null;
    if (contentChanged && stored.liveAttachment) {
      stored.liveDirty = stored.liveDirty || document.content !== stored.document.savedContent;
    }
    stored.document = document;
    stored.version += 1;
    stored.contentVersion += contentChanged ? 1 : 0;
    stored.lastAccess = this.tick();
    stored.snapshot = availableSnapshot(
      document,
      stored.version,
      stored.contentVersion,
      effectiveDirty(stored),
    );
    const delta = stored.snapshot.estimatedRetainedBytes - previousBytes;
    owner.retainedEstimatedBytes += delta;
    owner.lastAccess = this.tick();
    this.retainedEstimatedBytes += delta;
    owner.compatibilityProjection?.setDocument(document);
  }

  private publishDirtyTransition(owner: StoredOwner, wasDirty: boolean, dirty: boolean): void {
    if (wasDirty === dirty) {
      return;
    }
    owner.dirtyCount += dirty ? 1 : -1;
    this.refreshOwnerSnapshot(owner);
    this.emitOwner(owner);
  }

  private refreshDocumentSnapshot(document: StoredDocument): void {
    document.snapshot = availableSnapshot(
      document.document,
      document.version,
      document.contentVersion,
      effectiveDirty(document),
    );
  }

  private refreshOwnerSnapshot(owner: StoredOwner): void {
    owner.snapshot = Object.freeze({
      dirtyCount: owner.dirtyCount,
      documentCount: owner.documents.size,
      generation: owner.generation,
      identityKeys: Object.freeze([...owner.documents.keys()]),
      ownerKey: owner.ownerKey,
      status: "active",
    });
  }

  private emitDocument(owner: StoredOwner, document: StoredDocument, force = false): void {
    if (!owner.active && !force) return;
    this.publishing = true;
    try {
      for (const subscriber of [...document.subscribers]) {
        if (
          subscriber.lease.owner.generation === owner.generation &&
          subscriber.lease.owner.incarnation === owner.incarnation &&
          subscriber.lease.incarnation === document.incarnation
        ) {
          this.notifySubscriber(subscriber.listener);
        }
      }
    } finally {
      this.publishing = false;
      this.drainPendingLiveDetachments();
    }
  }

  private emitOwner(owner: StoredOwner, force = false): void {
    if (!owner.active && !force) return;
    this.publishing = true;
    try {
      for (const subscriber of [...owner.subscribers]) {
        if (
          subscriber.lease.generation === owner.generation &&
          subscriber.lease.incarnation === owner.incarnation
        ) {
          this.notifySubscriber(subscriber.listener);
        }
      }
    } finally {
      this.publishing = false;
      this.drainPendingLiveDetachments();
    }
  }

  private drainPendingLiveDetachments(): void {
    if (this.publishing || this.pendingLiveDetachments.size === 0) {
      return;
    }
    const pending = [...this.pendingLiveDetachments.values()];
    this.pendingLiveDetachments.clear();
    for (const attachment of pending) {
      this.detachLiveDocument(attachment);
    }
  }

  private pruneRetiredDocumentSubscribers(owner: StoredOwner, document: StoredDocument): void {
    for (const subscriber of document.subscribers) {
      if (
        subscriber.lease.owner.generation === owner.generation &&
        subscriber.lease.owner.incarnation === owner.incarnation
      ) {
        document.subscribers.delete(subscriber);
      }
    }
  }

  private notifySubscriber(listener: () => void): void {
    try {
      listener();
    } catch (error) {
      try {
        this.reportSubscriberError(error);
      } catch {
        // Observer error reporting must not make an already committed
        // document transaction appear to have failed.
      }
    }
  }

  private pruneRetiredOwnerSubscribers(owner: StoredOwner): void {
    for (const subscriber of owner.subscribers) {
      if (
        subscriber.lease.generation === owner.generation &&
        subscriber.lease.incarnation === owner.incarnation
      ) {
        owner.subscribers.delete(subscriber);
      }
    }
  }

  private ownerEvictionCandidate(): StoredOwner | null {
    if (this.owners.size < this.limits.maxOwners) return null;
    return (
      [...this.owners.values()]
        .filter(
          (owner) =>
            owner.dirtyCount === 0 &&
            [...owner.documents.values()].every((document) => document.issuedSaves.size === 0),
        )
        .sort(compareOwnersForEviction)[0] ?? null
    );
  }

  private makeDocumentCapacity(additionalDocuments: number, additionalBytes: number): boolean {
    const plan = this.documentCapacityPlan(
      this.documentCount + additionalDocuments,
      this.retainedEstimatedBytes + additionalBytes,
    );
    if (!plan) {
      return false;
    }
    for (const candidate of plan) this.removeDocument(candidate.owner, candidate.document);
    return true;
  }

  private documentCapacityPlan(
    projectedDocumentCount: number,
    projectedRetainedBytes: number,
  ): Array<{ readonly document: StoredDocument; readonly owner: StoredOwner }> | null {
    let projectedDocuments = projectedDocumentCount;
    let projectedBytes = projectedRetainedBytes;
    const plan: Array<{ readonly document: StoredDocument; readonly owner: StoredOwner }> = [];
    for (const candidate of this.cleanInactiveDocuments()) {
      if (
        projectedDocuments <= this.limits.maxRetainedDocuments &&
        projectedBytes <= this.limits.maxRetainedEstimatedBytes
      ) {
        break;
      }
      plan.push(candidate);
      projectedDocuments -= 1;
      projectedBytes -= candidate.document.snapshot.estimatedRetainedBytes;
    }
    if (
      projectedDocuments > this.limits.maxRetainedDocuments ||
      projectedBytes > this.limits.maxRetainedEstimatedBytes
    )
      return null;
    return plan;
  }

  private cleanInactiveDocuments(): Array<{
    readonly document: StoredDocument;
    readonly owner: StoredOwner;
  }> {
    return [...this.owners.values()]
      .filter((owner) => !owner.active)
      .flatMap((owner) =>
        [...owner.documents.values()]
          .filter((document) => !effectiveDirty(document) && document.issuedSaves.size === 0)
          .map((document) => ({ document, owner })),
      )
      .sort(
        (left, right) =>
          left.owner.lastAccess - right.owner.lastAccess ||
          left.document.lastAccess - right.document.lastAccess ||
          left.document.identityKey.localeCompare(right.document.identityKey),
      );
  }

  private removeDocument(owner: StoredOwner, document: StoredDocument, publishOwner = true): void {
    if (owner.documents.get(document.identityKey) !== document) {
      return;
    }
    owner.documents.delete(document.identityKey);
    owner.compatibilityProjection?.deleteDocument(document.document.path);
    const documentBytes = document.snapshot.estimatedRetainedBytes;
    const totalBytes = documentBytes + document.issuedSaveEstimatedBytes;
    owner.retainedEstimatedBytes -= documentBytes;
    owner.dirtyCount -= effectiveDirty(document) ? 1 : 0;
    owner.lastAccess = this.tick();
    this.documentCount -= 1;
    this.retainedEstimatedBytes -= totalBytes;
    if (owner.active && publishOwner) {
      this.refreshOwnerSnapshot(owner);
      this.emitOwner(owner);
    }
  }

  private evictOwner(owner: StoredOwner): void {
    if (owner.active || owner.dirtyCount > 0) {
      return;
    }
    for (const document of [...owner.documents.values()]) {
      this.removeDocument(owner, document);
    }
    this.owners.delete(owner.ownerKey);
  }

  private tick(): number {
    this.accessClock += 1;
    return this.accessClock;
  }
}

function availableSnapshot(
  document: Readonly<EditorDocument>,
  version: number,
  contentVersion: number,
  dirty = isDirty(document),
): AvailableDocumentSnapshot {
  return Object.freeze({
    contentVersion,
    dirty,
    document,
    estimatedRetainedBytes: estimatedDocumentBytes(document),
    status: "available",
    version,
  });
}

function effectiveDirty(document: StoredDocument): boolean {
  return document.liveDirty || isDirty(document.document);
}

function ownerLease(owner: StoredOwner): DocumentSessionOwnerLease {
  return Object.freeze({
    canonicalRoot: owner.canonicalRoot,
    generation: owner.generation,
    incarnation: owner.incarnation,
    ownerKey: owner.ownerKey,
    rootPath: owner.rootPath,
    workspaceId: owner.workspaceId,
  });
}

function documentLease(
  owner: DocumentSessionOwnerLease,
  document: StoredDocument,
): DocumentSessionDocumentLease {
  return Object.freeze({
    identityKey: document.identityKey,
    incarnation: document.incarnation,
    owner,
    path: document.document.path,
  });
}

function receipt(
  owner: DocumentSessionOwnerLease,
  document: StoredDocument,
): DocumentSessionReceipt {
  return Object.freeze({
    contentVersion: document.contentVersion,
    documentIncarnation: document.incarnation,
    identityKey: document.identityKey,
    ownerGeneration: owner.generation,
    ownerIncarnation: owner.incarnation,
    ownerKey: owner.ownerKey,
    version: document.version,
  });
}

function applied(
  document: StoredDocument,
  currentReceipt: DocumentSessionReceipt,
): DocumentSessionMutationResult {
  return {
    receipt: currentReceipt,
    snapshot: document.snapshot,
    status: "applied",
  };
}

function rejectedAdmission(
  reason:
    | "content-budget"
    | "document-limit"
    | "invalid-document"
    | "invalid-owner"
    | "owner-limit"
    | "reentrant-operation"
    | "save-in-flight",
): Extract<DocumentSessionOpenResult | DocumentSessionOwnerActivation, { status: "rejected" }> {
  return { reason, status: "rejected" };
}

function rejectedMutation(
  reason:
    | "content-budget"
    | "dirty-document"
    | "invalid-document"
    | "reentrant-operation"
    | "save-in-flight"
    | "stale-receipt",
): DocumentSessionMutationResult {
  return { reason, status: "rejected" };
}

function rejectedCompatibilityReconciliation(
  reason: Extract<
    DocumentSessionCompatibilityReconciliationResult,
    { readonly status: "rejected" }
  >["reason"],
): DocumentSessionCompatibilityReconciliationResult {
  return { reason, status: "rejected" };
}

function createStoredCompatibilityProjection(
  owner: DocumentSessionOwnerLease,
  documents: ReadonlyMap<string, StoredDocument>,
): StoredCompatibilityProjection {
  let records = Object.create(null) as Record<string, Readonly<EditorDocument>>;
  for (const document of documents.values()) {
    records[document.document.path] = document.document;
  }
  const proxyTarget = Object.create(null) as Record<string, never>;
  const projection = new Proxy(proxyTarget, {
    defineProperty: () => false,
    deleteProperty: () => false,
    get: (_target, property) =>
      Object.prototype.hasOwnProperty.call(records, property)
        ? records[property as string]
        : undefined,
    getOwnPropertyDescriptor: (_target, property) => {
      if (!Object.prototype.hasOwnProperty.call(records, property)) {
        return undefined;
      }
      return {
        configurable: true,
        enumerable: true,
        value: records[property as string],
        writable: false,
      };
    },
    getPrototypeOf: () => null,
    has: (_target, property) => Object.prototype.hasOwnProperty.call(records, property),
    isExtensible: () => true,
    ownKeys: () => Reflect.ownKeys(records),
    preventExtensions: () => false,
    set: () => false,
    setPrototypeOf: () => false,
  }) as Readonly<Record<string, Readonly<EditorDocument>>>;
  const activation = Object.freeze({
    lease: Object.freeze({
      authority: Object.freeze({}),
      ownerGeneration: owner.generation,
      ownerIncarnation: owner.incarnation,
      ownerKey: owner.ownerKey,
    }),
    projection,
  });
  return {
    activation,
    clear: () => {
      records = Object.create(null) as Record<string, Readonly<EditorDocument>>;
    },
    deleteDocument: (path) => {
      delete records[path];
    },
    replaceAll: (documentsByPath) => {
      records = documentsByPath as Record<string, Readonly<EditorDocument>>;
    },
    setDocument: (document) => {
      records[document.path] = document;
    },
  };
}

function compatibilityProjectionLeaseEqual(
  current: DocumentSessionCompatibilityProjectionLease,
  candidate: DocumentSessionCompatibilityProjectionLease,
): boolean {
  return (
    current.authority === candidate.authority &&
    current.ownerGeneration === candidate.ownerGeneration &&
    current.ownerIncarnation === candidate.ownerIncarnation &&
    current.ownerKey === candidate.ownerKey
  );
}

function documentBelongsToOwner(owner: StoredOwner, input: DocumentSessionOpenInput): boolean {
  return registeredDocumentSaveIdentityMatches(
    owner.workspaceId,
    owner.canonicalRoot,
    input.identity,
    owner.resolveOwnership(owner.rootPath, input.document.path),
  );
}

function validLiveAttachmentInput(input: DocumentSessionLiveAttachmentInput): boolean {
  return (
    isClosedRecord(input, [
      "checkpoint",
      "holderIncarnation",
      "sourceIncarnation",
      "synchronization",
    ]) &&
    validAuthority(input.holderIncarnation) &&
    validAuthority(input.sourceIncarnation) &&
    (input.synchronization === null || validAuthority(input.synchronization)) &&
    validLiveCheckpoint(input.checkpoint)
  );
}

function validLiveCheckpoint(checkpoint: DocumentSessionLiveCheckpoint): boolean {
  return (
    isClosedRecord(checkpoint, [
      "alternativeVersionId",
      "contentVersion",
      "modelVersionId",
      "utf16Length",
    ]) &&
    positiveSafeInteger(checkpoint.alternativeVersionId) &&
    positiveSafeInteger(checkpoint.contentVersion) &&
    positiveSafeInteger(checkpoint.modelVersionId) &&
    (checkpoint.utf16Length === null ||
      (Number.isSafeInteger(checkpoint.utf16Length) && checkpoint.utf16Length >= 0))
  );
}

function validAuthority(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isClosedRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expectedKeys.length &&
    keys.every((key) => typeof key === "string" && expectedKeys.includes(key)) &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function validateLimits(limits: DocumentSessionStoreLimits): DocumentSessionStoreLimits {
  const values = [
    limits.maxDocumentsPerOwner,
    limits.maxOwners,
    limits.maxRetainedDocuments,
    limits.maxRetainedEstimatedBytes,
  ];
  if (!values.every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new RangeError("Document session store limits must be positive safe integers.");
  }
  return Object.freeze({ ...limits });
}

function compareOwnersForEviction(left: StoredOwner, right: StoredOwner): number {
  return left.lastAccess - right.lastAccess || left.ownerKey.localeCompare(right.ownerKey);
}
