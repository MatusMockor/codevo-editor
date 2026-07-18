export interface AppliedWorkspaceEditOpenDocument {
  content: string;
  path: string;
  versionId: number;
}

export interface WorkspaceEditApplicationContext {
  applyOpenModels?: () => WorkspaceEditOpenModelCommitResult;
  expectedClosedFileHashes?: Readonly<Record<string, string | null>>;
  openPaths: string[];
  requiresAtomicFinalization?: boolean;
  rootPath: string;
}

export type WorkspaceEditOpenModelCommitResult =
  | {
      documents: AppliedWorkspaceEditOpenDocument[];
      finalize?: () => WorkspaceEditOpenModelCommitResult;
      kind: "applied";
      rollback?: () => void;
    }
  | {
      kind: "rejected";
      path: string;
      reason: "invalidOpenModelEdits";
    };

export type WorkspaceEditApplicationDecision =
  | {
      kind: "accepted";
    }
  | {
      kind: "rejected";
      path?: string;
      reason:
        | "atomicWorkspaceEditUnavailable"
        | "inactiveWorkspace"
        | "invalidOpenModelEdits"
        | "staleDocumentVersion";
    };

export function restoreUnchangedWorkspaceEditDocuments<
  Document extends { content: string },
>(
  current: Record<string, Document>,
  original: Record<string, Document>,
  applied: Record<string, Document>,
  touchedPaths: readonly string[],
): Record<string, Document> {
  let changed = false;
  const restored = { ...current };

  for (const path of touchedPaths) {
    const originalDocument = original[path];
    const appliedDocument = applied[path];
    const currentDocument = current[path];

    if (
      !originalDocument ||
      !appliedDocument ||
      !currentDocument ||
      currentDocument !== appliedDocument ||
      currentDocument.content !== appliedDocument.content
    ) {
      continue;
    }

    restored[path] = originalDocument;
    changed = true;
  }

  return changed ? restored : current;
}
