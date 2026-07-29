import type { EditorSessionOwnerKey } from "./editorSessionOwnerKey";
import type { EditorDocument, WorkspaceFileRevision } from "./workspace";

export interface DocumentSessionOwnerLease {
  readonly canonicalRoot: string;
  readonly generation: number;
  readonly incarnation: object;
  readonly ownerKey: EditorSessionOwnerKey;
  readonly rootPath: string;
  readonly workspaceId: string;
}

export interface DocumentSessionDocumentLease {
  readonly identityKey: string;
  readonly incarnation: object;
  readonly owner: DocumentSessionOwnerLease;
  readonly path: string;
}

export interface DocumentSessionReceipt {
  readonly contentVersion: number;
  readonly documentIncarnation: object;
  readonly identityKey: string;
  readonly ownerGeneration: number;
  readonly ownerIncarnation: object;
  readonly ownerKey: EditorSessionOwnerKey;
  readonly version: number;
}

export interface DocumentSessionLiveCheckpoint {
  readonly alternativeVersionId: number;
  readonly contentVersion: number;
  readonly modelVersionId: number;
  readonly utf16Length: number | null;
}

export interface DocumentSessionLiveAttachmentLease {
  readonly authority: object;
  readonly documentIncarnation: object;
  readonly holderIncarnation: object;
  readonly identityKey: string;
  readonly ownerGeneration: number;
  readonly ownerIncarnation: object;
  readonly ownerKey: EditorSessionOwnerKey;
  readonly sourceIncarnation: object;
}

export interface DocumentSessionLiveSynchronizationPermit {
  readonly authority: object;
  readonly checkpoint: DocumentSessionLiveCheckpoint;
  readonly contentVersion: number;
  readonly documentIncarnation: object;
  readonly identityKey: string;
  readonly ownerGeneration: number;
  readonly ownerIncarnation: object;
  readonly ownerKey: EditorSessionOwnerKey;
  readonly sourceIncarnation: object;
  readonly version: number;
}

export type DocumentSessionLiveAttachmentResult =
  | {
      readonly attachment: DocumentSessionLiveAttachmentLease;
      readonly status: "attached";
    }
  | {
      readonly reason:
        | "attachment-limit"
        | "duplicate-holder"
        | "invalid-checkpoint"
        | "reentrant-operation"
        | "stale-checkpoint"
        | "stale-receipt"
        | "stale-synchronization";
      readonly status: "rejected";
    };

export type DocumentSessionLiveCheckpointResult =
  | {
      readonly dirty: boolean;
      readonly status: "applied";
    }
  | {
      readonly reason: "invalid-checkpoint" | "reentrant-operation" | "stale-attachment";
      readonly status: "rejected";
    };

export type DocumentSessionDocumentSnapshot =
  | {
      readonly status: "unavailable";
    }
  | {
      readonly contentVersion: number;
      readonly dirty: boolean;
      readonly document: Readonly<EditorDocument>;
      readonly estimatedRetainedBytes: number;
      readonly status: "available";
      readonly version: number;
    };

export type DocumentSessionOwnerSnapshot =
  | {
      readonly status: "unavailable";
    }
  | {
      readonly dirtyCount: number;
      readonly documentCount: number;
      readonly generation: number;
      readonly identityKeys: readonly string[];
      readonly ownerKey: EditorSessionOwnerKey;
      readonly status: "active";
    };

export interface DocumentSessionStoreLimits {
  readonly maxDocumentsPerOwner: number;
  readonly maxOwners: number;
  readonly maxRetainedDocuments: number;
  /**
   * Conservative UTF-16 heap estimate. Every retained code unit is charged two
   * bytes, avoiding an O(file-size) UTF-8 encoding pass on every edit.
   */
  readonly maxRetainedEstimatedBytes: number;
}

export type DocumentSessionAdmissionFailureReason =
  | "content-budget"
  | "document-limit"
  | "invalid-document"
  | "invalid-owner"
  | "owner-limit"
  | "reentrant-operation"
  | "save-in-flight";

export interface DocumentSessionAdmissionFailure {
  readonly reason: DocumentSessionAdmissionFailureReason;
  readonly status: "rejected";
}

export interface DocumentSessionMutationApplied {
  readonly receipt: DocumentSessionReceipt;
  readonly snapshot: Extract<DocumentSessionDocumentSnapshot, { readonly status: "available" }>;
  readonly status: "applied";
}

export type DocumentSessionMutationResult =
  | DocumentSessionMutationApplied
  | {
      readonly reason:
        | "content-budget"
        | "dirty-document"
        | "invalid-document"
        | "reentrant-operation"
        | "save-in-flight"
        | "stale-receipt";
      readonly status: "rejected";
    };

export interface DocumentSessionSaveAcknowledgement {
  readonly revision: WorkspaceFileRevision | null | undefined;
}

export interface DocumentSessionSavePermit {
  readonly authority: object;
  readonly receipt: DocumentSessionReceipt;
  readonly sequence: number;
  readonly writtenContent: string;
}

export const UNAVAILABLE_DOCUMENT_SESSION_DOCUMENT_SNAPSHOT: DocumentSessionDocumentSnapshot =
  Object.freeze({ status: "unavailable" });

export const UNAVAILABLE_DOCUMENT_SESSION_OWNER_SNAPSHOT: DocumentSessionOwnerSnapshot =
  Object.freeze({ status: "unavailable" });

export function isDocumentSessionEditorDocument(
  document: EditorDocument,
): document is EditorDocument {
  return (
    typeof document.path === "string" &&
    document.path.length > 0 &&
    typeof document.name === "string" &&
    typeof document.language === "string" &&
    typeof document.content === "string" &&
    typeof document.savedContent === "string"
  );
}
