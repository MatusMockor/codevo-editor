import type {
  DocumentSessionDocumentLease,
  DocumentSessionLiveAttachmentLease,
  DocumentSessionLiveCheckpoint,
  DocumentSessionOwnerLease,
  DocumentSessionSavePermit,
} from "../domain/documentSession";
import { isPersistableEditorDocumentPath } from "../domain/editorDocumentSchemes";
import type { LiveDocumentAuthority } from "../domain/liveDocumentContentAuthority";
import { boundedUtf8Length } from "../domain/incrementalDocumentSync";
import type { EditorDocument } from "../domain/workspace";
import type {
  DocumentSessionCompatibilityProjectionActivation,
  DocumentSessionCompatibilityReconciliationResult,
  DocumentSessionOwnerInput,
  DocumentSessionStorePort,
} from "./documentSessionStorePort";
import {
  createRegisteredDocumentSaveIdentity,
  documentSaveOwnershipKey,
  isRegisteredDocumentSaveIdentity,
  legacyDocumentSaveIdentity,
  registeredDocumentSaveIdentityKey,
  type DocumentSaveIdentity,
  type RegisteredDocumentSaveIdentity,
  type ResolveDocumentSaveOwnership,
} from "./documentSaveIdentity";
import type { EditorChangeHunksBaseline } from "./editorChangeHunksSnapshotPort";
import {
  consumeEditorActiveLiveDocumentSaveCapture,
  type EditorActiveLiveDocumentBinding,
  type EditorActiveLiveDocumentContentCapture,
} from "./editorActiveLiveDocumentBinding";
import type { LiveModelRevision } from "./liveModelIngressCoordinator";
import {
  createEditorDocumentDirtyProjection,
  createEditorOwnerDirtyCountProjection,
  type EditorDocumentDirtyProjection,
  type EditorOwnerDirtyCountProjection,
} from "./editorSessionDirtyProjection";

export interface EditorSessionDocumentLifecycleAuthority {
  readonly identity: object;
}

export interface EditorGroupDocumentSessionAuthority extends EditorSessionDocumentLifecycleAuthority {
  readonly groupId: string;
  readonly path: string;
}

export interface EditorGroupLiveDocumentAttachment {
  observe(revision: LiveModelRevision): boolean;
  /**
   * Returns true once release is settled or accepted for deterministic
   * deferred settlement. False means bounded Store admission rejected the
   * request before settlement, so the caller may retry.
   */
  release(): boolean;
}

export interface EditorGroupLiveDocumentSource {
  captureCurrentContent(): string | null;
  readonly holderIncarnation: object;
  readonly modelIncarnation: object;
}

export type AttachEditorGroupLiveDocument = (
  authority: EditorGroupDocumentSessionAuthority,
  source: EditorGroupLiveDocumentSource,
  baseRevision: LiveModelRevision,
) => EditorGroupLiveDocumentAttachment | null;

export type EditorSessionAuthorityReconciliationResult =
  | { readonly status: "applied" }
  | Extract<DocumentSessionCompatibilityReconciliationResult, { readonly status: "rejected" }>;

interface LifecycleAuthorityCapabilities {
  readonly dirtyProjection: EditorDocumentDirtyProjection;
  lease: DocumentSessionDocumentLease;
  readonly registeredIdentity: RegisteredDocumentSaveIdentity | null;
  readonly sidecarAuthority: object;
  readonly store: DocumentSessionStorePort;
}

interface GroupAuthorityCapabilities {
  readonly lifecycle: LifecycleAuthorityCapabilities;
  readonly selectionIdentity: object;
}

const lifecycleCapabilities = new WeakMap<
  EditorSessionDocumentLifecycleAuthority,
  LifecycleAuthorityCapabilities
>();
const groupCapabilities = new WeakMap<
  EditorGroupDocumentSessionAuthority,
  GroupAuthorityCapabilities
>();
const liveAttachmentCapabilities = new WeakMap<
  EditorGroupLiveDocumentAttachment,
  {
    readonly acknowledgeSave: (
      permit: DocumentSessionSavePermit,
      revision: EditorDocument["revision"],
    ) => boolean;
    readonly advanceSave: (
      permit: DocumentSessionSavePermit,
      revision: LiveModelRevision,
      content: string,
    ) => DocumentSessionSavePermit | null;
    readonly cancelSave: (permit: DocumentSessionSavePermit) => boolean;
    readonly isSaveCurrent: (permit: DocumentSessionSavePermit) => boolean;
    readonly issueSave: (
      binding: EditorActiveLiveDocumentBinding,
      capture: EditorActiveLiveDocumentContentCapture,
    ) => DocumentSessionSavePermit | null;
    readonly replaceSaveContent: (
      permit: DocumentSessionSavePermit,
      content: string,
    ) => DocumentSessionSavePermit | null;
  }
>();

export function issueEditorGroupLiveDocumentSave(
  attachment: EditorGroupLiveDocumentAttachment,
  binding: EditorActiveLiveDocumentBinding,
  capture: EditorActiveLiveDocumentContentCapture,
): DocumentSessionSavePermit | null {
  return liveAttachmentCapabilities.get(attachment)?.issueSave(binding, capture) ?? null;
}

export function acknowledgeEditorGroupLiveDocumentSave(
  attachment: EditorGroupLiveDocumentAttachment,
  permit: DocumentSessionSavePermit,
  revision: EditorDocument["revision"],
): boolean {
  return liveAttachmentCapabilities.get(attachment)?.acknowledgeSave(permit, revision) ?? false;
}

export function advanceEditorGroupLiveDocumentSave(
  attachment: EditorGroupLiveDocumentAttachment,
  permit: DocumentSessionSavePermit,
  revision: LiveModelRevision,
  content: string,
): DocumentSessionSavePermit | null {
  return liveAttachmentCapabilities.get(attachment)?.advanceSave(permit, revision, content) ?? null;
}

export function cancelEditorGroupLiveDocumentSave(
  attachment: EditorGroupLiveDocumentAttachment,
  permit: DocumentSessionSavePermit,
): boolean {
  return liveAttachmentCapabilities.get(attachment)?.cancelSave(permit) ?? false;
}

export function isEditorGroupLiveDocumentSaveCurrent(
  attachment: EditorGroupLiveDocumentAttachment,
  permit: DocumentSessionSavePermit,
): boolean {
  return liveAttachmentCapabilities.get(attachment)?.isSaveCurrent(permit) ?? false;
}

export function replaceEditorGroupLiveDocumentSaveContent(
  attachment: EditorGroupLiveDocumentAttachment,
  permit: DocumentSessionSavePermit,
  content: string,
): DocumentSessionSavePermit | null {
  return liveAttachmentCapabilities.get(attachment)?.replaceSaveContent(permit, content) ?? null;
}

export function editorGroupDocumentSessionWorkspaceMatches(
  authority: EditorGroupDocumentSessionAuthority,
  workspaceRoot: string,
): boolean {
  const capabilities = groupCapabilities.get(authority)?.lifecycle;
  return isNonEmptyText(workspaceRoot) && capabilities?.lease.owner.rootPath === workspaceRoot;
}

export function registeredDocumentSaveIdentityForEditorGroupAuthority(
  authority: EditorGroupDocumentSessionAuthority,
): RegisteredDocumentSaveIdentity | null {
  const capabilities = groupCapabilities.get(authority)?.lifecycle;
  const identity = capabilities?.registeredIdentity;
  if (!capabilities || !identity) {
    return null;
  }
  const { lease } = capabilities;
  const identityKey = registeredDocumentSaveIdentityKey(
    lease.owner.workspaceId,
    lease.owner.canonicalRoot,
    identity,
  );
  if (
    identity.workspaceId !== lease.owner.workspaceId ||
    identity.canonicalRoot !== lease.owner.canonicalRoot ||
    identityKey === null ||
    identityKey !== lease.identityKey ||
    capabilities.store.getDocumentSnapshot(lease).status !== "available"
  ) {
    return null;
  }
  return identity;
}

export function createEditorGroupLiveDocumentAuthority(
  authority: EditorGroupDocumentSessionAuthority,
  model: {
    readonly id: string;
    readonly incarnation: object;
  },
): LiveDocumentAuthority | null {
  const capabilities = groupCapabilities.get(authority)?.lifecycle;
  if (!capabilities || !isNonEmptyText(model.id) || !isObjectIdentity(model.incarnation)) {
    return null;
  }
  const { lease } = capabilities;
  const projectedIdentityKey = projectDocumentIdentityKey(lease.identityKey);
  if (!projectedIdentityKey) {
    return null;
  }
  return Object.freeze({
    canonicalRoot: lease.owner.canonicalRoot,
    documentIdentityKey: projectedIdentityKey,
    documentIncarnation: lease.incarnation,
    modelId: model.id,
    modelIncarnation: model.incarnation,
    ownerGeneration: lease.owner.generation,
    ownerIncarnation: lease.owner.incarnation,
    ownerKey: lease.owner.ownerKey,
    path: authority.path,
  });
}

export function createEditorGroupChangeHunksBaseline(
  authority: EditorGroupDocumentSessionAuthority,
  content: string,
): EditorChangeHunksBaseline | null {
  const group = groupCapabilities.get(authority);
  const capabilities = group?.lifecycle;
  if (!group || !capabilities || typeof content !== "string") {
    return null;
  }
  const { lease } = capabilities;
  const projectedIdentityKey = projectDocumentIdentityKey(lease.identityKey);
  if (!projectedIdentityKey) {
    return null;
  }
  return Object.freeze({
    authority: group.selectionIdentity,
    canonicalRoot: lease.owner.canonicalRoot,
    content,
    documentIdentityKey: projectedIdentityKey,
    documentIncarnation: lease.incarnation,
    ownerGeneration: lease.owner.generation,
    ownerIncarnation: lease.owner.incarnation,
    ownerKey: lease.owner.ownerKey,
    path: authority.path,
  });
}

/**
 * Exact, fail-closed sidecar authority for the legacy editor projection.
 * It never mutates the legacy UI state and accepts only injected canonical ownership.
 */
export class EditorSessionDocumentAuthoritySidecar {
  private static readonly maxDocuments = 256;
  private authorities = new Map<string, EditorSessionDocumentLifecycleAuthority>();
  private readonly sidecarAuthority = Object.freeze({});
  private owner: DocumentSessionOwnerLease | null = null;
  private ownerDirtyProjection: EditorOwnerDirtyCountProjection | null = null;
  private projection: DocumentSessionCompatibilityProjectionActivation | null = null;
  private resolveOwnership: ResolveDocumentSaveOwnership | null = null;

  constructor(private readonly store: DocumentSessionStorePort) {}

  activateOwner(
    input: DocumentSessionOwnerInput,
    resolveOwnership: ResolveDocumentSaveOwnership,
    documents: Readonly<Record<string, EditorDocument>>,
  ): boolean {
    this.deactivate();
    const activation = this.store.activateOwner(input, resolveOwnership);
    if (activation.status !== "activated") {
      return false;
    }
    const projection = this.store.createCompatibilityProjection(activation.lease);
    if (!projection) {
      this.store.deactivateOwner(activation.lease);
      return false;
    }
    this.owner = activation.lease;
    this.ownerDirtyProjection = createEditorOwnerDirtyCountProjection(this.store, activation.lease);
    this.projection = projection;
    this.resolveOwnership = resolveOwnership;
    return this.reconcile(documents).status === "applied";
  }

  deactivate(): void {
    if (this.owner) {
      this.store.deactivateOwner(this.owner);
    }
    this.clearAuthority();
  }

  reconcile(
    documents: Readonly<Record<string, EditorDocument>>,
  ): EditorSessionAuthorityReconciliationResult {
    const owner = this.owner;
    const projection = this.projection;
    const resolveOwnership = this.resolveOwnership;
    if (!owner || !projection || !resolveOwnership) {
      return { reason: "invalid-owner", status: "rejected" };
    }
    if (!isPlainDocumentRecord(documents)) {
      return this.reject("invalid-document");
    }
    const paths = Object.keys(documents);
    if (paths.length > EditorSessionDocumentAuthoritySidecar.maxDocuments) {
      return this.reject("document-limit");
    }

    const preparedByIdentity = new Map<
      string,
      {
        readonly aliases: string[];
        readonly document: EditorDocument;
        readonly identity: DocumentSaveIdentity;
      }
    >();
    for (const path of paths) {
      if (!isWorkspaceFileCandidate(path)) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(documents, path);
      const document =
        descriptor && "value" in descriptor
          ? (descriptor.value as EditorDocument | undefined)
          : undefined;
      if (!document || document.path !== path) {
        return this.reject("invalid-document");
      }
      let ownership: ReturnType<ResolveDocumentSaveOwnership>;
      try {
        ownership = resolveOwnership(owner.rootPath, path);
      } catch {
        return this.reject("invalid-document");
      }
      if (!ownership) {
        continue;
      }
      const identity = canonicalIdentity(ownership, owner, path);
      if (!identity) {
        return this.reject("invalid-document");
      }
      const identityKey = documentIdentityKey(owner, identity);
      if (!identityKey) {
        return this.reject("invalid-document");
      }
      const existing = preparedByIdentity.get(identityKey);
      if (existing) {
        if (!aliasDocumentsEqual(existing.document, document)) {
          return this.reject("invalid-document");
        }
        existing.aliases.push(path);
        continue;
      }
      preparedByIdentity.set(identityKey, {
        aliases: [path],
        document: normalizeLifecycleDocument(document),
        identity,
      });
    }

    const preparedDocuments = [...preparedByIdentity.values()].map(
      ({ aliases, document, identity }) => {
        const lease = this.store.resolve(owner, identity);
        const stableAlias = lease && aliases.includes(lease.path) ? lease.path : null;
        const stableDocument = stableAlias
          ? Object.getOwnPropertyDescriptor(documents, stableAlias)?.value
          : null;
        const retainedSnapshot = lease ? this.store.getDocumentSnapshot(lease) : null;
        return {
          document:
            stableDocument && stableDocument.path === stableAlias
              ? normalizeLifecycleDocument(stableDocument)
              : retainedSnapshot?.status === "available"
                ? retainedSnapshot.document
                : document,
          identity,
          receipt: lease ? this.store.capture(lease) : null,
        };
      },
    );
    const removals = [];
    for (const path of Object.keys(projection.projection)) {
      const identity = resolveCanonicalIdentity(resolveOwnership, owner, path);
      const identityKey = identity ? documentIdentityKey(owner, identity) : null;
      if (identityKey && preparedByIdentity.has(identityKey)) continue;
      const lease = identity ? this.store.resolve(owner, identity) : null;
      const receipt = lease ? this.store.capture(lease) : null;
      if (!lease || !receipt) {
        return this.reject("invalid-document");
      }
      removals.push({
        discardDirty: false,
        receipt,
      });
    }

    const result = this.store.reconcileCompatibilityProjection(owner, projection.lease, {
      documents: preparedDocuments,
      ownerSnapshot: this.store.getOwnerSnapshot(owner),
      removals,
    });
    if (result.status === "rejected") {
      return this.reject(result.reason);
    }

    const leasesByIdentity = new Map<string, DocumentSessionDocumentLease>();
    for (const { lease } of result.documents) {
      leasesByIdentity.set(lease.identityKey, lease);
    }
    const authorities = new Map<string, EditorSessionDocumentLifecycleAuthority>();
    for (const [identityKey, prepared] of preparedByIdentity) {
      const lease = leasesByIdentity.get(identityKey);
      if (!lease) {
        return this.reject("stale-receipt");
      }
      for (const alias of prepared.aliases) {
        const current = this.authorities.get(alias);
        const currentCapabilities = current ? lifecycleCapabilities.get(current) : null;
        if (
          current &&
          currentCapabilities?.sidecarAuthority === this.sidecarAuthority &&
          currentCapabilities.lease.identityKey === lease.identityKey &&
          currentCapabilities.lease.incarnation === lease.incarnation &&
          currentCapabilities.lease.owner.incarnation === lease.owner.incarnation &&
          registeredIdentityKeysEqual(currentCapabilities.registeredIdentity, prepared.identity)
        ) {
          currentCapabilities.lease = lease;
          authorities.set(alias, current);
          continue;
        }
        const authority = Object.freeze({
          identity: Object.freeze({}),
        });
        lifecycleCapabilities.set(authority, {
          dirtyProjection: createEditorDocumentDirtyProjection(this.store, lease),
          lease,
          registeredIdentity: registeredIdentity(prepared.identity),
          sidecarAuthority: this.sidecarAuthority,
          store: this.store,
        });
        authorities.set(alias, authority);
      }
    }
    this.authorities = authorities;
    return { status: "applied" };
  }

  resolveLifecycle(path: string): EditorSessionDocumentLifecycleAuthority | null {
    const authority = this.authorities.get(path);
    return authority && this.isLifecycleCurrent(authority) ? authority : null;
  }

  createGroupAuthority(
    lifecycle: EditorSessionDocumentLifecycleAuthority,
    groupId: string,
    path: string,
    selectionIdentity: object,
  ): EditorGroupDocumentSessionAuthority | null {
    const capabilities = this.lifecycleCapabilities(lifecycle);
    if (
      !capabilities ||
      !isNonEmptyText(groupId) ||
      !isNonEmptyText(path) ||
      !isObjectIdentity(selectionIdentity) ||
      !this.isLifecycleCurrent(lifecycle)
    ) {
      return null;
    }
    const authority = Object.freeze({
      groupId,
      identity: Object.freeze({}),
      path,
    });
    groupCapabilities.set(authority, {
      lifecycle: capabilities,
      selectionIdentity,
    });
    return authority;
  }

  isLifecycleCurrent(authority: EditorSessionDocumentLifecycleAuthority): boolean {
    const capabilities =
      this.lifecycleCapabilities(authority) ??
      this.groupCapabilities(authority as EditorGroupDocumentSessionAuthority)?.lifecycle ??
      null;
    return (
      capabilities !== null &&
      this.store.getDocumentSnapshot(capabilities.lease).status === "available"
    );
  }

  isGroupLifecycleCurrent(authority: EditorGroupDocumentSessionAuthority): boolean {
    const capabilities = this.groupCapabilities(authority)?.lifecycle;
    return (
      !!capabilities && this.store.getDocumentSnapshot(capabilities.lease).status === "available"
    );
  }

  documentDirty(
    authority: EditorSessionDocumentLifecycleAuthority | EditorGroupDocumentSessionAuthority,
  ): boolean | null {
    const capabilities =
      groupCapabilities.get(authority as EditorGroupDocumentSessionAuthority)?.lifecycle ??
      lifecycleCapabilities.get(authority);
    if (capabilities?.sidecarAuthority !== this.sidecarAuthority) {
      return null;
    }
    const snapshot = this.store.getDocumentSnapshot(capabilities.lease);
    return snapshot.status === "available" ? snapshot.dirty : null;
  }

  resolveDocumentDirtyProjection(
    authority: EditorSessionDocumentLifecycleAuthority | EditorGroupDocumentSessionAuthority,
  ): EditorDocumentDirtyProjection | null {
    const capabilities =
      groupCapabilities.get(authority as EditorGroupDocumentSessionAuthority)?.lifecycle ??
      lifecycleCapabilities.get(authority);
    return capabilities?.sidecarAuthority === this.sidecarAuthority
      ? capabilities.dirtyProjection
      : null;
  }

  resolveOwnerDirtyCountProjection(): EditorOwnerDirtyCountProjection | null {
    return this.owner && this.ownerDirtyProjection ? this.ownerDirtyProjection : null;
  }

  attachEditorGroupLiveDocument(
    authority: EditorGroupDocumentSessionAuthority,
    source: EditorGroupLiveDocumentSource,
    baseRevision: LiveModelRevision,
    isSelectionCurrent: () => boolean,
  ): EditorGroupLiveDocumentAttachment | null {
    const checkpoint = liveCheckpoint(baseRevision);
    const capabilities = this.groupCapabilities(authority)?.lifecycle;
    const exactSource = liveDocumentSource(source);
    if (
      !checkpoint ||
      !capabilities ||
      !exactSource ||
      !this.isExactSelectionCurrent(authority, isSelectionCurrent)
    ) {
      return null;
    }

    const receipt = this.store.capture(capabilities.lease);
    if (!receipt || !this.isExactSelectionCurrent(authority, isSelectionCurrent)) {
      return null;
    }

    const joining = this.store.canJoinLiveDocument(
      receipt,
      exactSource.modelIncarnation,
      checkpoint,
    );
    const capturedCurrentContent = joining ? null : captureCurrentContent(exactSource);
    if (
      (!joining && capturedCurrentContent === null) ||
      !this.isExactSelectionCurrent(authority, isSelectionCurrent)
    ) {
      return null;
    }
    const synchronization = joining
      ? null
      : this.store.issueLiveDocumentSynchronization(
          receipt,
          exactSource.modelIncarnation,
          checkpoint,
          capturedCurrentContent!,
        );
    if (!this.isExactSelectionCurrent(authority, isSelectionCurrent)) {
      if (synchronization) {
        this.store.cancelLiveDocumentSynchronization(synchronization);
      }
      return null;
    }

    const attached = this.store.attachLiveDocument(receipt, {
      checkpoint,
      holderIncarnation: exactSource.holderIncarnation,
      sourceIncarnation: exactSource.modelIncarnation,
      synchronization,
    });
    if (attached.status !== "attached") {
      if (synchronization) {
        this.store.cancelLiveDocumentSynchronization(synchronization);
      }
      return null;
    }
    if (!this.isExactSelectionCurrent(authority, isSelectionCurrent)) {
      this.store.detachLiveDocument(attached.attachment);
      return null;
    }

    return this.createLiveDocumentAttachment(
      authority,
      attached.attachment,
      exactSource,
      isSelectionCurrent,
    );
  }

  private createLiveDocumentAttachment(
    authority: EditorGroupDocumentSessionAuthority,
    attachment: DocumentSessionLiveAttachmentLease,
    source: EditorGroupLiveDocumentSource,
    isSelectionCurrent: () => boolean,
  ): EditorGroupLiveDocumentAttachment {
    let released = false;
    const issueSave = (
      binding: EditorActiveLiveDocumentBinding,
      capture: EditorActiveLiveDocumentContentCapture,
    ): DocumentSessionSavePermit | null => {
      if (released || !this.isExactSelectionCurrent(authority, isSelectionCurrent)) {
        return null;
      }
      const capabilities = this.groupCapabilities(authority)?.lifecycle;
      const captured = exactLiveSaveCapture(capture);
      if (!capabilities || !captured) {
        return null;
      }
      const receipt = this.store.capture(capabilities.lease);
      if (!receipt || !this.isExactSelectionCurrent(authority, isSelectionCurrent)) {
        return null;
      }
      const permit = this.store.issueLiveSave(
        receipt,
        attachment,
        captured.checkpoint,
        captured.content,
      );
      if (!permit) return null;
      const consumed = consumeEditorActiveLiveDocumentSaveCapture(
        binding,
        authority,
        capture,
        source.modelIncarnation,
      );
      if (!consumed || !this.isExactSelectionCurrent(authority, isSelectionCurrent)) {
        this.store.cancelSave(permit);
        return null;
      }
      return permit;
    };
    const facade = Object.freeze({
      observe: (revision: LiveModelRevision): boolean => {
        if (released || !this.isExactSelectionCurrent(authority, isSelectionCurrent)) {
          return false;
        }
        // A null-length revision is not a compact canonical checkpoint. Reject
        // it before touching the Store so the editor coordinator performs one
        // exact guarded full publication while the live model is still current.
        if (revision.utf16Length === null) {
          return false;
        }
        const checkpoint = liveCheckpoint(revision);
        if (!checkpoint) {
          return false;
        }
        const result = this.store.checkpointLiveDocument(attachment, checkpoint);
        return (
          result.status === "applied" && this.isExactSelectionCurrent(authority, isSelectionCurrent)
        );
      },
      release: (): boolean => {
        if (released) {
          return true;
        }
        // Selection changes are the normal reason the framework releases this
        // facade. The private attachment capability still identifies the exact
        // document/model source, while the lifecycle check prevents a stale
        // owner or same-path reincarnation from touching its replacement.
        if (!this.isGroupLifecycleCurrent(authority)) {
          released = true;
          return true;
        }
        const detached = this.store.detachLiveDocument(attachment);
        if (detached) {
          released = true;
        }
        return detached;
      },
    });
    liveAttachmentCapabilities.set(facade, {
      acknowledgeSave: (permit, revision) =>
        this.store.acknowledgeSave(permit, { revision }).status === "applied",
      advanceSave: (permit, revision, content) => {
        const checkpoint = liveCheckpoint(revision);
        return checkpoint ? this.store.advanceIssuedLiveSave(permit, checkpoint, content) : null;
      },
      cancelSave: (permit) => this.store.cancelSave(permit),
      isSaveCurrent: (permit) => this.store.isIssuedSaveCurrent(permit),
      issueSave,
      replaceSaveContent: (permit, content) => this.store.replaceIssuedSaveContent(permit, content),
    });
    return facade;
  }

  private isExactSelectionCurrent(
    authority: EditorGroupDocumentSessionAuthority,
    isSelectionCurrent: () => boolean,
  ): boolean {
    try {
      return (
        isSelectionCurrent() && this.isGroupLifecycleCurrent(authority) && isSelectionCurrent()
      );
    } catch {
      return false;
    }
  }

  private lifecycleCapabilities(
    authority: EditorSessionDocumentLifecycleAuthority,
  ): LifecycleAuthorityCapabilities | null {
    const capabilities = lifecycleCapabilities.get(authority);
    return capabilities?.sidecarAuthority === this.sidecarAuthority ? capabilities : null;
  }

  private groupCapabilities(
    authority: EditorGroupDocumentSessionAuthority,
  ): GroupAuthorityCapabilities | null {
    const capabilities = groupCapabilities.get(authority);
    return capabilities?.lifecycle.sidecarAuthority === this.sidecarAuthority ? capabilities : null;
  }

  private reject(
    reason: Extract<
      DocumentSessionCompatibilityReconciliationResult,
      { readonly status: "rejected" }
    >["reason"],
  ): Extract<DocumentSessionCompatibilityReconciliationResult, { readonly status: "rejected" }> {
    this.deactivate();
    return { reason, status: "rejected" };
  }

  private clearAuthority(): void {
    this.authorities.clear();
    this.owner = null;
    this.ownerDirtyProjection = null;
    this.projection = null;
    this.resolveOwnership = null;
  }
}

function liveCheckpoint(revision: LiveModelRevision): DocumentSessionLiveCheckpoint | null {
  try {
    if (
      !revision ||
      (revision.mode !== "incremental" &&
        revision.mode !== "retained" &&
        revision.mode !== "snapshot-required") ||
      !isPositiveSafeInteger(revision.alternativeVersionId) ||
      !isPositiveSafeInteger(revision.contentVersion) ||
      !isPositiveSafeInteger(revision.modelVersionId) ||
      (revision.utf16Length !== null && !isNonNegativeSafeInteger(revision.utf16Length))
    ) {
      return null;
    }
    return Object.freeze({
      alternativeVersionId: revision.alternativeVersionId,
      contentVersion: revision.contentVersion,
      modelVersionId: revision.modelVersionId,
      utf16Length: revision.utf16Length,
    });
  } catch {
    return null;
  }
}

function isObjectIdentity(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function liveDocumentSource(value: unknown): EditorGroupLiveDocumentSource | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  try {
    const keys = Object.keys(value).sort();
    if (
      keys.length === 3 &&
      keys[0] === "captureCurrentContent" &&
      keys[1] === "holderIncarnation" &&
      keys[2] === "modelIncarnation" &&
      typeof (value as EditorGroupLiveDocumentSource).captureCurrentContent === "function"
    ) {
      const capture = (value as EditorGroupLiveDocumentSource).captureCurrentContent;
      const holderIncarnation = (value as EditorGroupLiveDocumentSource).holderIncarnation;
      const modelIncarnation = (value as EditorGroupLiveDocumentSource).modelIncarnation;
      if (isObjectIdentity(holderIncarnation) && isObjectIdentity(modelIncarnation)) {
        return Object.freeze({
          captureCurrentContent: () => Reflect.apply(capture, value, []),
          holderIncarnation,
          modelIncarnation,
        });
      }
    }
    return null;
  } catch {
    return null;
  }
}

function captureCurrentContent(source: EditorGroupLiveDocumentSource): string | null {
  try {
    const content = source.captureCurrentContent();
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}

function exactLiveSaveCapture(
  capture: EditorActiveLiveDocumentContentCapture,
): { readonly checkpoint: DocumentSessionLiveCheckpoint; readonly content: string } | null {
  try {
    if (
      !capture ||
      capture.purpose !== "save" ||
      typeof capture.content !== "string" ||
      capture.utf16Length !== capture.content.length ||
      !isPositiveSafeInteger(capture.alternativeVersionId) ||
      !isPositiveSafeInteger(capture.contentVersion) ||
      !isPositiveSafeInteger(capture.modelVersionId)
    ) {
      return null;
    }
    return Object.freeze({
      checkpoint: Object.freeze({
        alternativeVersionId: capture.alternativeVersionId,
        contentVersion: capture.contentVersion,
        modelVersionId: capture.modelVersionId,
        utf16Length: capture.utf16Length,
      }),
      content: capture.content,
    });
  } catch {
    return null;
  }
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function canonicalIdentity(
  ownership: ReturnType<ResolveDocumentSaveOwnership>,
  owner: DocumentSessionOwnerLease,
  expectedPath: string,
): DocumentSaveIdentity | null {
  try {
    if (!ownership) {
      return null;
    }
    if (!("canonicalRoot" in ownership)) {
      if (
        !("rootPath" in ownership) ||
        !("path" in ownership) ||
        ownership.rootPath !== owner.rootPath ||
        ownership.path !== expectedPath
      ) {
        return null;
      }
      const identity = legacyDocumentSaveIdentity(ownership.rootPath, ownership.path);
      return identity?.canonicalRoot === owner.canonicalRoot ? identity : null;
    }
    if (ownership.canonicalRoot !== owner.canonicalRoot) {
      return null;
    }
    if ("workspaceId" in ownership) {
      return isRegisteredDocumentSaveIdentity(ownership) &&
        ownership.workspaceId === owner.workspaceId
        ? ownership
        : null;
    }
    return ownership;
  } catch {
    return null;
  }
}

function resolveCanonicalIdentity(
  resolveOwnership: ResolveDocumentSaveOwnership,
  owner: DocumentSessionOwnerLease,
  path: string,
): DocumentSaveIdentity | null {
  try {
    return canonicalIdentity(resolveOwnership(owner.rootPath, path), owner, path);
  } catch {
    return null;
  }
}

function documentIdentityKey(
  owner: DocumentSessionOwnerLease,
  identity: DocumentSaveIdentity,
): string | null {
  return registeredDocumentSaveIdentityKey(owner.workspaceId, owner.canonicalRoot, identity);
}

function registeredIdentity(identity: DocumentSaveIdentity): RegisteredDocumentSaveIdentity | null {
  return isRegisteredDocumentSaveIdentity(identity)
    ? createRegisteredDocumentSaveIdentity(
        identity.workspaceId,
        identity.canonicalRoot,
        identity.workspaceRelativePath,
      )
    : null;
}

function registeredIdentityKeysEqual(
  current: RegisteredDocumentSaveIdentity | null,
  next: DocumentSaveIdentity,
): boolean {
  const nextRegistered = registeredIdentity(next);
  if (!current || !nextRegistered) {
    return current === nextRegistered;
  }
  return documentSaveOwnershipKey(current) === documentSaveOwnershipKey(nextRegistered);
}

function projectDocumentIdentityKey(identityKey: string): string | null {
  const projected = JSON.stringify(identityKey);
  return boundedUtf8Length(projected, 4096).status === "within-limit" ? projected : null;
}

function isWorkspaceFileCandidate(path: string): boolean {
  return (
    isPersistableEditorDocumentPath(path) && (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path))
  );
}

function aliasDocumentsEqual(left: EditorDocument, right: EditorDocument): boolean {
  return (
    left.content === right.content &&
    left.savedContent === right.savedContent &&
    left.language === right.language &&
    left.readOnly === right.readOnly
  );
}

function normalizeLifecycleDocument(document: EditorDocument): EditorDocument {
  const baseline = document.savedContent ?? document.content;
  return {
    ...document,
    content: baseline,
    savedContent: baseline,
  };
}

function isPlainDocumentRecord(documents: Readonly<Record<string, EditorDocument>>): boolean {
  const prototype = Object.getPrototypeOf(documents);
  return prototype === Object.prototype || prototype === null;
}
