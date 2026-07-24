import type { WorkspaceEditOpenModelCommitResult } from "./workspaceEditApplication";

export interface TemplateWorkspaceRenameDocumentSnapshot {
  readonly content: string;
  readonly versionId: number;
}

export interface TemplateWorkspaceRenameOpenModel {
  read(): TemplateWorkspaceRenameDocumentSnapshot | null;
  replace(
    expected: TemplateWorkspaceRenameDocumentSnapshot,
    content: string,
  ): TemplateWorkspaceRenameDocumentSnapshot | null;
  finalize?(
    original: TemplateWorkspaceRenameDocumentSnapshot,
    applied: TemplateWorkspaceRenameDocumentSnapshot,
  ): TemplateWorkspaceRenameDocumentSnapshot | null;
}

export interface TemplateWorkspaceRenameStagedDocument {
  readonly model: TemplateWorkspaceRenameOpenModel;
  readonly nextContent: string;
  readonly original: TemplateWorkspaceRenameDocumentSnapshot;
  readonly path: string;
}

interface AppliedDocument {
  applied: TemplateWorkspaceRenameDocumentSnapshot;
  readonly entry: TemplateWorkspaceRenameStagedDocument;
}

/**
 * Stages a multi-model rename with exact compare-and-swap semantics. Rollback
 * skips a model once user content/version has moved beyond our applied state.
 */
export function commitTemplateWorkspaceRenameOpenModels(
  entries: readonly TemplateWorkspaceRenameStagedDocument[],
): WorkspaceEditOpenModelCommitResult {
  for (const entry of entries) {
    if (
      typeof entry.path !== "string" ||
      !entry.path ||
      typeof entry.nextContent !== "string" ||
      !validSnapshot(entry.original) ||
      !safeSnapshotsEqual(entry.model, entry.original)
    ) {
      return rejected(entry.path);
    }
  }

  const applied: AppliedDocument[] = [];
  let state: "finalized" | "pending" | "rolledBack" = "pending";
  const rollback = () => {
    if (state === "rolledBack") return;
    state = "rolledBack";
    for (const item of [...applied].reverse()) {
      try {
        if (!snapshotsEqual(item.entry.model.read(), item.applied)) continue;
        item.entry.model.replace(item.applied, item.entry.original.content);
      } catch {
        // A concurrent model mutation wins over rollback.
      }
    }
  };

  try {
    for (const entry of entries) {
      const next = entry.model.replace(entry.original, entry.nextContent);
      if (
        !validSnapshot(next) ||
        next.content !== entry.nextContent ||
        next.versionId === entry.original.versionId
      ) {
        rollback();
        return rejected(entry.path);
      }
      applied.push({ applied: next, entry });
      if (!safeSnapshotsEqual(entry.model, next)) {
        rollback();
        return rejected(entry.path);
      }
    }
  } catch {
    rollback();
    return rejected(entries[applied.length]?.path ?? entries[0]?.path ?? "");
  }

  const documents = () =>
    applied.map(({ applied: snapshot, entry }) => ({
      content: snapshot.content,
      path: entry.path,
      versionId: snapshot.versionId,
    }));
  const finalize = (): WorkspaceEditOpenModelCommitResult => {
    if (state === "finalized") {
      return { documents: documents(), kind: "applied", rollback };
    }
    if (state !== "pending") return rejected(applied[0]?.entry.path ?? "");
    for (const item of applied) {
      if (!safeSnapshotsEqual(item.entry.model, item.applied)) {
        rollback();
        return rejected(item.entry.path);
      }
    }
    for (const item of applied) {
      if (!item.entry.model.finalize) continue;
      let finalized: TemplateWorkspaceRenameDocumentSnapshot | null;
      try {
        finalized = item.entry.model.finalize(item.entry.original, item.applied);
      } catch {
        rollback();
        return rejected(item.entry.path);
      }
      if (
        !validSnapshot(finalized) ||
        finalized.content !== item.applied.content ||
        !safeSnapshotsEqual(item.entry.model, finalized)
      ) {
        rollback();
        return rejected(item.entry.path);
      }
      item.applied = finalized;
    }
    state = "finalized";
    return { documents: documents(), kind: "applied", rollback };
  };
  const result: WorkspaceEditOpenModelCommitResult = {
    documents: documents(),
    finalize,
    kind: "applied",
  };
  Object.defineProperty(result, "rollback", { value: rollback });
  return result;
}

function rejected(path: string): WorkspaceEditOpenModelCommitResult {
  return { kind: "rejected", path, reason: "invalidOpenModelEdits" };
}

function snapshotsEqual(
  left: TemplateWorkspaceRenameDocumentSnapshot | null,
  right: TemplateWorkspaceRenameDocumentSnapshot,
): boolean {
  return left?.content === right.content && left.versionId === right.versionId;
}

function safeSnapshotsEqual(
  model: TemplateWorkspaceRenameOpenModel,
  expected: TemplateWorkspaceRenameDocumentSnapshot,
): boolean {
  try {
    return snapshotsEqual(model.read(), expected);
  } catch {
    return false;
  }
}

function validSnapshot(
  snapshot: TemplateWorkspaceRenameDocumentSnapshot | null,
): snapshot is TemplateWorkspaceRenameDocumentSnapshot {
  return (
    snapshot !== null &&
    typeof snapshot.content === "string" &&
    Number.isSafeInteger(snapshot.versionId) &&
    snapshot.versionId >= 0
  );
}
