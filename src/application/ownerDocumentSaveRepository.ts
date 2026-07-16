import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import type {
  ActiveDocumentSaveStorePort,
  DocumentSaveAcknowledgement,
  DocumentSaveTarget,
} from "./activeDocumentSaveStore";

export type DocumentRepositoryKind = "active" | "cached";

/** Identity captured when the dirty close scope is assembled. */
export interface CapturedOwnerDocumentSaveTarget {
  readonly owner: WorkspaceRuntimeOwner;
  readonly documentIdentity: string;
  readonly document: EditorDocument;
}

export interface RepositoryDocumentSnapshot {
  readonly incarnation: object;
  readonly document: EditorDocument;
}

/**
 * One active or cached repository incarnation. Implementations must make
 * replaceDocument conditional on all supplied expected values.
 */
export interface OwnerDocumentRepositoryCandidate {
  readonly kind: DocumentRepositoryKind;
  readonly owner: WorkspaceRuntimeOwner;
  readonly rootPath: string;
  readonly incarnation: object;
  readDocument(documentIdentity: string): RepositoryDocumentSnapshot | null;
  replaceDocument(
    documentIdentity: string,
    expectedRepositoryIncarnation: object,
    expectedDocumentIncarnation: object,
    expectedDocument: EditorDocument,
    nextDocument: EditorDocument,
  ): boolean;
}

export interface OwnerDocumentSaveRepositoryDependencies {
  active(): OwnerDocumentRepositoryCandidate | null;
  cached(owner: WorkspaceRuntimeOwner): OwnerDocumentRepositoryCandidate | null;
}

export interface ResolvedOwnerDocumentSaveRepository {
  readonly kind: DocumentRepositoryKind;
  readonly owner: WorkspaceRuntimeOwner;
  readonly rootPath: string;
  readonly path: string;
  readonly saveStore: ActiveDocumentSaveStorePort;
  isCurrent(): boolean;
  currentDocument(): EditorDocument | null;
}

/** Resolves one captured owner without changing which workspace is active. */
export class OwnerDocumentSaveRepository {
  constructor(
    private readonly dependencies: OwnerDocumentSaveRepositoryDependencies,
  ) {}

  resolve(
    target: CapturedOwnerDocumentSaveTarget,
  ): ResolvedOwnerDocumentSaveRepository | null {
    if (!target.documentIdentity) {
      return null;
    }

    const candidate = this.candidate(target.owner);
    if (!candidate) {
      return null;
    }
    const snapshot = candidate.readDocument(target.documentIdentity);
    if (!snapshot || snapshot.document !== target.document) {
      return null;
    }
    if (snapshot.document.path !== target.document.path) {
      return null;
    }

    return new ResolvedRepositorySession(
      this.dependencies,
      target,
      candidate,
      snapshot.incarnation,
    );
  }

  private candidate(
    owner: WorkspaceRuntimeOwner,
  ): OwnerDocumentRepositoryCandidate | null {
    const active = this.dependencies.active();
    if (active && ownersEqual(active.owner, owner)) {
      return active;
    }

    const cached = this.dependencies.cached(owner);
    if (!cached || !ownersEqual(cached.owner, owner)) {
      return null;
    }

    return cached;
  }
}

class ResolvedRepositorySession
  implements ResolvedOwnerDocumentSaveRepository, ActiveDocumentSaveStorePort
{
  readonly kind: DocumentRepositoryKind;
  readonly owner: WorkspaceRuntimeOwner;
  readonly rootPath: string;
  readonly path: string;
  readonly saveStore: ActiveDocumentSaveStorePort = this;

  constructor(
    private readonly dependencies: OwnerDocumentSaveRepositoryDependencies,
    private readonly captured: CapturedOwnerDocumentSaveTarget,
    private readonly repository: OwnerDocumentRepositoryCandidate,
    private readonly documentIncarnation: object,
  ) {
    this.kind = repository.kind;
    this.owner = captured.owner;
    this.rootPath = repository.rootPath;
    this.path = captured.document.path;
  }

  isCurrent(): boolean {
    return this.currentCandidate() !== null && this.currentDocument() !== null;
  }

  current(target?: DocumentSaveTarget): EditorDocument | null {
    if (target && !target.lease.isCurrent()) {
      return null;
    }

    return this.currentDocument();
  }

  acknowledgeIssuedWrite(
    target: DocumentSaveTarget,
    acknowledgement: DocumentSaveAcknowledgement,
  ): void {
    if (!target.lease.isCurrent()) {
      return;
    }

    const live = this.currentDocument();
    if (!live) {
      return;
    }

    const content =
      live === acknowledgement.expectedDocument &&
        live.content === acknowledgement.startingContent
        ? acknowledgement.savedDocument.content
        : live.content;
    const next = {
      ...live,
      content,
      savedContent: acknowledgement.savedDocument.content,
      revision: acknowledgement.revision,
    };
    this.replace(live, next);
  }

  updateRevisionForIssuedWrite(
    target: DocumentSaveTarget,
    _expectedDocument: EditorDocument,
    revision: EditorDocument["revision"],
  ): void {
    if (!target.lease.isCurrent()) {
      return;
    }

    const live = this.currentDocument();
    if (!live) {
      return;
    }

    this.replace(live, { ...live, revision });
  }

  updateRevision(
    target: DocumentSaveTarget,
    revision: EditorDocument["revision"],
  ): void {
    if (!target.lease.isCurrent()) {
      return;
    }

    const live = this.currentDocument();
    if (!live) {
      return;
    }

    this.replace(live, { ...live, revision });
  }

  private currentCandidate(): OwnerDocumentRepositoryCandidate | null {
    const candidate = this.kind === "active"
      ? this.dependencies.active()
      : this.dependencies.cached(this.owner);
    if (!candidate) {
      return null;
    }
    if (candidate.kind !== this.kind) {
      return null;
    }
    if (!ownersEqual(candidate.owner, this.owner)) {
      return null;
    }
    if (candidate.incarnation !== this.repository.incarnation) {
      return null;
    }
    if (candidate.rootPath !== this.rootPath) {
      return null;
    }

    return candidate;
  }

  currentDocument(): EditorDocument | null {
    const candidate = this.currentCandidate();
    if (!candidate) {
      return null;
    }
    const snapshot = candidate.readDocument(this.captured.documentIdentity);
    if (!snapshot) {
      return null;
    }
    if (snapshot.incarnation !== this.documentIncarnation) {
      return null;
    }
    if (snapshot.document.path !== this.path) {
      return null;
    }

    return snapshot.document;
  }

  private replace(
    expectedDocument: EditorDocument,
    nextDocument: EditorDocument,
  ): void {
    const candidate = this.currentCandidate();
    if (!candidate) {
      return;
    }

    candidate.replaceDocument(
      this.captured.documentIdentity,
      this.repository.incarnation,
      this.documentIncarnation,
      expectedDocument,
      nextDocument,
    );
  }
}

function ownersEqual(
  left: WorkspaceRuntimeOwner,
  right: WorkspaceRuntimeOwner,
): boolean {
  return left.ownerKey === right.ownerKey &&
    workspaceRootKeysEqual(left.executionRoot, right.executionRoot);
}
