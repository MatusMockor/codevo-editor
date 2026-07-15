import { isPersistableEditorDocumentPath } from "./editorDocumentSchemes";
import { isDirty, type EditorDocument } from "./workspace";
import type {
  WorkspaceRuntimeOwner,
  WorkspaceRuntimeOwnerKey,
} from "./workspaceRuntimeOwner";

export type DirtyCloseDecision = "save" | "discard" | "cancel";

export type CloseCompletion = "closed" | "cancelled" | "blocked" | "stale";

/**
 * One editor-group membership of a document considered by a close operation.
 * `documentIdentity` must be stable across aliases of the same workspace.
 */
export interface DirtyCloseDocumentMembership {
  readonly owner: WorkspaceRuntimeOwner;
  readonly documentIdentity: string;
  readonly document: EditorDocument;
}

/** A unique dirty document owned by one admitted workspace. */
export interface DirtyCloseTarget {
  readonly ownerKey: WorkspaceRuntimeOwnerKey;
  readonly executionRoot: string;
  readonly documentIdentity: string;
  readonly path: string;
  readonly document: EditorDocument;
}

export interface DirtyCloseWorkspaceMemberships {
  readonly owner: WorkspaceRuntimeOwner;
  readonly documents: Readonly<Record<string, EditorDocument>>;
  /**
   * Visible document identities. Repeated values represent shared editor-group
   * memberships and are intentionally accepted here.
   */
  readonly documentIdentities: readonly string[];
}

export function isDirtyCloseDocument(document: EditorDocument): boolean {
  if (document.readOnly === true) {
    return false;
  }

  if (!isPersistableEditorDocumentPath(document.path)) {
    return false;
  }

  return isDirty(document);
}

/**
 * Collects each owner-scoped dirty document once. Stable owner and document
 * identities make the result independent of workspace aliases and shared tabs.
 */
export function collectDirtyCloseTargets(
  memberships: readonly DirtyCloseDocumentMembership[],
): DirtyCloseTarget[] {
  const targets: DirtyCloseTarget[] = [];
  const targetsByOwner = new Map<
    WorkspaceRuntimeOwnerKey,
    Map<string, DirtyCloseTarget[]>
  >();

  for (const membership of memberships) {
    if (!membership.documentIdentity) {
      continue;
    }

    if (!isDirtyCloseDocument(membership.document)) {
      continue;
    }

    const ownerTargets = targetsByOwner.get(membership.owner.ownerKey) ??
      new Map<string, DirtyCloseTarget[]>();
    if (!targetsByOwner.has(membership.owner.ownerKey)) {
      targetsByOwner.set(membership.owner.ownerKey, ownerTargets);
    }

    const identityTargets = ownerTargets.get(membership.documentIdentity) ?? [];
    if (identityTargets.some((target) =>
      equivalentDocumentSnapshot(target.document, membership.document)
    )) {
      continue;
    }

    const target = {
      ownerKey: membership.owner.ownerKey,
      executionRoot: membership.owner.executionRoot,
      documentIdentity: membership.documentIdentity,
      path: membership.document.path,
      document: membership.document,
    };
    identityTargets.push(target);
    ownerTargets.set(membership.documentIdentity, identityTargets);
    targets.push(target);
  }

  return targets;
}

export function collectWorkspaceDirtyCloseTargets(
  workspaces: readonly DirtyCloseWorkspaceMemberships[],
): DirtyCloseTarget[] {
  const memberships: DirtyCloseDocumentMembership[] = [];

  for (const workspace of workspaces) {
    for (const documentIdentity of workspace.documentIdentities) {
      const document = workspace.documents[documentIdentity];
      if (!document) {
        continue;
      }

      memberships.push({
        owner: workspace.owner,
        documentIdentity,
        document,
      });
    }
  }

  return collectDirtyCloseTargets(memberships);
}

export function closeCompletionForDecision(
  decision: DirtyCloseDecision,
): CloseCompletion | null {
  if (decision === "cancel") {
    return "cancelled";
  }

  if (decision === "discard") {
    return "closed";
  }

  return null;
}

function equivalentDocumentSnapshot(
  left: EditorDocument,
  right: EditorDocument,
): boolean {
  if (left === right) {
    return true;
  }

  return left.path === right.path &&
    left.name === right.name &&
    left.content === right.content &&
    left.savedContent === right.savedContent &&
    left.language === right.language &&
    (left.readOnly ?? false) === (right.readOnly ?? false) &&
    equivalentRevision(left.revision ?? null, right.revision ?? null);
}

function equivalentRevision(
  left: EditorDocument["revision"],
  right: EditorDocument["revision"],
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedSeconds === right.modifiedSeconds &&
    left.modifiedNanoseconds === right.modifiedNanoseconds &&
    left.contentHash === right.contentHash;
}
