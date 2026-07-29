import type { DocumentSaveIdentity, ResolveDocumentSaveOwnership } from "./documentSaveIdentity";
import type {
  DocumentSessionAdmissionFailure,
  DocumentSessionDocumentLease,
  DocumentSessionDocumentSnapshot,
  DocumentSessionLiveAttachmentLease,
  DocumentSessionLiveAttachmentResult,
  DocumentSessionLiveCheckpoint,
  DocumentSessionLiveCheckpointResult,
  DocumentSessionLiveSynchronizationPermit,
  DocumentSessionMutationResult,
  DocumentSessionOwnerLease,
  DocumentSessionOwnerSnapshot,
  DocumentSessionReceipt,
  DocumentSessionSaveAcknowledgement,
  DocumentSessionSavePermit,
} from "../domain/documentSession";
import type { EditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorDocument } from "../domain/workspace";

export interface DocumentSessionOwnerInput {
  readonly canonicalRoot: string;
  readonly ownerKey: EditorSessionOwnerKey;
  readonly rootPath: string;
  readonly workspaceId: string;
}

export interface DocumentSessionOpenInput {
  readonly document: EditorDocument;
  readonly identity: DocumentSaveIdentity;
}

export interface DocumentSessionLiveAttachmentInput {
  readonly checkpoint: DocumentSessionLiveCheckpoint;
  readonly holderIncarnation: object;
  readonly sourceIncarnation: object;
  readonly synchronization: DocumentSessionLiveSynchronizationPermit | null;
}

export type DocumentSessionOwnerActivation =
  | {
      readonly lease: DocumentSessionOwnerLease;
      readonly status: "activated";
    }
  | DocumentSessionAdmissionFailure;

export type DocumentSessionOpenResult =
  | {
      readonly lease: DocumentSessionDocumentLease;
      readonly status: "opened";
    }
  | DocumentSessionAdmissionFailure;

export interface DocumentSessionCompatibilityDocument {
  readonly document: EditorDocument;
  readonly identity: DocumentSaveIdentity;
  /**
   * Exact CAS authority for a retained document. New documents must use null.
   * A full reconciliation fails when any receipt is stale or omitted.
   */
  readonly receipt: DocumentSessionReceipt | null;
}

export interface DocumentSessionCompatibilityReconciliation {
  readonly documents: readonly DocumentSessionCompatibilityDocument[];
  readonly removals: readonly {
    readonly discardDirty: boolean;
    readonly receipt: DocumentSessionReceipt;
  }[];
  /** The exact cached owner snapshot observed while the batch was prepared. */
  readonly ownerSnapshot: DocumentSessionOwnerSnapshot;
}

export interface DocumentSessionCompatibilityProjectionLease {
  readonly authority: object;
  readonly ownerGeneration: number;
  readonly ownerIncarnation: object;
  readonly ownerKey: EditorSessionOwnerKey;
}

export interface DocumentSessionCompatibilityProjectionActivation {
  readonly lease: DocumentSessionCompatibilityProjectionLease;
  readonly projection: Readonly<Record<string, Readonly<EditorDocument>>>;
}

export type DocumentSessionCompatibilityReconciliationResult =
  | {
      readonly documents: readonly {
        readonly lease: DocumentSessionDocumentLease;
        readonly snapshot: Extract<
          DocumentSessionDocumentSnapshot,
          { readonly status: "available" }
        >;
      }[];
      readonly ownerSnapshot: Extract<DocumentSessionOwnerSnapshot, { readonly status: "active" }>;
      readonly status: "applied";
    }
  | {
      readonly reason:
        | "content-budget"
        | "dirty-document"
        | "document-limit"
        | "invalid-document"
        | "invalid-owner"
        | "reentrant-operation"
        | "save-in-flight"
        | "stale-receipt";
      readonly status: "rejected";
    };

export interface DocumentSessionStorePort {
  acknowledgeSave(
    permit: DocumentSessionSavePermit,
    acknowledgement: DocumentSessionSaveAcknowledgement,
  ): DocumentSessionMutationResult;
  advanceIssuedLiveSave(
    permit: DocumentSessionSavePermit,
    checkpoint: DocumentSessionLiveCheckpoint,
    content: string,
  ): DocumentSessionSavePermit | null;
  activateOwner(
    input: DocumentSessionOwnerInput,
    resolveOwnership?: ResolveDocumentSaveOwnership,
  ): DocumentSessionOwnerActivation;
  attachLiveDocument(
    receipt: DocumentSessionReceipt,
    input: DocumentSessionLiveAttachmentInput,
  ): DocumentSessionLiveAttachmentResult;
  capture(document: DocumentSessionDocumentLease): DocumentSessionReceipt | null;
  cancelSave(permit: DocumentSessionSavePermit): boolean;
  cancelLiveDocumentSynchronization(permit: DocumentSessionLiveSynchronizationPermit): boolean;
  canJoinLiveDocument(
    receipt: DocumentSessionReceipt,
    sourceIncarnation: object,
    checkpoint: DocumentSessionLiveCheckpoint,
  ): boolean;
  checkpointLiveDocument(
    attachment: DocumentSessionLiveAttachmentLease,
    checkpoint: DocumentSessionLiveCheckpoint,
  ): DocumentSessionLiveCheckpointResult;
  createCompatibilityProjection(
    owner: DocumentSessionOwnerLease,
  ): DocumentSessionCompatibilityProjectionActivation | null;
  close(
    receipt: DocumentSessionReceipt,
    options?: { readonly discardDirty?: boolean },
  ): DocumentSessionMutationResult;
  deactivateOwner(owner: DocumentSessionOwnerLease): boolean;
  detachLiveDocument(attachment: DocumentSessionLiveAttachmentLease): boolean;
  edit(receipt: DocumentSessionReceipt, content: string): DocumentSessionMutationResult;
  getDocumentSnapshot(document: DocumentSessionDocumentLease): DocumentSessionDocumentSnapshot;
  getOwnerSnapshot(owner: DocumentSessionOwnerLease): DocumentSessionOwnerSnapshot;
  isCurrent(receipt: DocumentSessionReceipt): boolean;
  isIssuedSaveCurrent(permit: DocumentSessionSavePermit): boolean;
  issueSave(receipt: DocumentSessionReceipt): DocumentSessionSavePermit | null;
  issueLiveSave(
    receipt: DocumentSessionReceipt,
    attachment: DocumentSessionLiveAttachmentLease,
    checkpoint: DocumentSessionLiveCheckpoint,
    capturedSnapshotContent: string,
  ): DocumentSessionSavePermit | null;
  replaceIssuedSaveContent(
    permit: DocumentSessionSavePermit,
    content: string,
  ): DocumentSessionSavePermit | null;
  issueLiveDocumentSynchronization(
    receipt: DocumentSessionReceipt,
    sourceIncarnation: object,
    checkpoint: DocumentSessionLiveCheckpoint,
    capturedCurrentContent: string,
  ): DocumentSessionLiveSynchronizationPermit | null;
  open(
    owner: DocumentSessionOwnerLease,
    input: DocumentSessionOpenInput,
  ): DocumentSessionOpenResult;
  reconcileCompatibilityProjection(
    owner: DocumentSessionOwnerLease,
    projection: DocumentSessionCompatibilityProjectionLease,
    reconciliation: DocumentSessionCompatibilityReconciliation,
  ): DocumentSessionCompatibilityReconciliationResult;
  resolve(
    owner: DocumentSessionOwnerLease,
    identity: DocumentSaveIdentity,
  ): DocumentSessionDocumentLease | null;
  subscribeDocument(document: DocumentSessionDocumentLease, listener: () => void): () => void;
  subscribeOwner(owner: DocumentSessionOwnerLease, listener: () => void): () => void;
}
