import type { DocumentSessionOwnerLease } from "../domain/documentSession";
import type { EditorDocument } from "../domain/workspace";
import { documentSaveIdentityFromSelectedPath } from "./documentSaveIdentity";
import type {
  DocumentSessionCompatibilityProjectionActivation,
  DocumentSessionCompatibilityReconciliationResult,
  DocumentSessionStorePort,
} from "./documentSessionStorePort";

export interface LegacyDocumentProjectionLimits {
  readonly maxDocuments: number;
}

export type LegacyDocumentProjectionResult =
  | {
      readonly projection: Readonly<Record<string, Readonly<EditorDocument>>>;
      readonly status: "applied";
    }
  | Extract<DocumentSessionCompatibilityReconciliationResult, { readonly status: "rejected" }>;

export interface LegacyDocumentProjectionReconciliationOptions {
  readonly discardDirtyPaths?: readonly string[];
}

/** Guarded anti-corruption layer for complete legacy document records. */
export class LegacyDocumentProjectionAdapter {
  private readonly projection: DocumentSessionCompatibilityProjectionActivation;
  private reconciling = false;

  constructor(
    private readonly store: DocumentSessionStorePort,
    private readonly owner: DocumentSessionOwnerLease,
    private readonly limits: LegacyDocumentProjectionLimits = {
      maxDocuments: 256,
    },
  ) {
    if (!Number.isSafeInteger(limits.maxDocuments) || limits.maxDocuments <= 0) {
      throw new RangeError("Legacy document projection limit must be a positive safe integer.");
    }
    const projection = store.createCompatibilityProjection(owner);
    if (!projection) {
      throw new TypeError("Document projection owner is not current.");
    }
    this.projection = projection;
  }

  getSnapshot(): Readonly<Record<string, Readonly<EditorDocument>>> {
    return this.projection.projection;
  }

  reconcile(
    proposed: Readonly<Record<string, EditorDocument>>,
    options: LegacyDocumentProjectionReconciliationOptions = {},
  ): LegacyDocumentProjectionResult {
    if (this.reconciling) {
      return { reason: "reentrant-operation", status: "rejected" };
    }
    if (!isPlainProjectionRecord(proposed)) {
      return { reason: "invalid-document", status: "rejected" };
    }
    const paths = Object.keys(proposed);
    if (
      paths.length > this.limits.maxDocuments ||
      (options.discardDirtyPaths?.length ?? 0) > this.limits.maxDocuments
    ) {
      return { reason: "document-limit", status: "rejected" };
    }

    const documents = [];
    for (const path of paths) {
      const descriptor = Object.getOwnPropertyDescriptor(proposed, path);
      const document =
        descriptor && "value" in descriptor
          ? (descriptor.value as EditorDocument | undefined)
          : undefined;
      const identity = document
        ? documentSaveIdentityFromSelectedPath(
            this.owner.canonicalRoot,
            this.owner.rootPath,
            document.path,
          )
        : null;
      if (!document || document.path !== path || !identity) {
        return { reason: "invalid-document", status: "rejected" };
      }
      const lease = this.store.resolve(this.owner, identity);
      documents.push({
        document,
        identity,
        receipt: lease ? this.store.capture(lease) : null,
      });
    }

    const discardDirtyPaths = new Set(options.discardDirtyPaths ?? []);
    if (discardDirtyPaths.size !== (options.discardDirtyPaths?.length ?? 0)) {
      return { reason: "invalid-document", status: "rejected" };
    }
    const removals = [];
    for (const path of Object.keys(this.projection.projection)) {
      if (path in proposed) {
        continue;
      }
      const document = this.projection.projection[path];
      const identity = document
        ? documentSaveIdentityFromSelectedPath(
            this.owner.canonicalRoot,
            this.owner.rootPath,
            document.path,
          )
        : null;
      const lease = identity ? this.store.resolve(this.owner, identity) : null;
      const receipt = lease ? this.store.capture(lease) : null;
      if (!document || !receipt) {
        return { reason: "invalid-document", status: "rejected" };
      }
      removals.push({
        discardDirty: discardDirtyPaths.delete(path),
        receipt,
      });
    }
    if (discardDirtyPaths.size > 0) {
      return { reason: "invalid-document", status: "rejected" };
    }

    this.reconciling = true;
    try {
      const result = this.store.reconcileCompatibilityProjection(
        this.owner,
        this.projection.lease,
        {
          documents,
          ownerSnapshot: this.store.getOwnerSnapshot(this.owner),
          removals,
        },
      );
      return result.status === "rejected"
        ? result
        : { projection: this.projection.projection, status: "applied" };
    } finally {
      this.reconciling = false;
    }
  }
}

function isPlainProjectionRecord(proposed: Readonly<Record<string, EditorDocument>>): boolean {
  if (!proposed || typeof proposed !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(proposed);
  return prototype === Object.prototype || prototype === null;
}
