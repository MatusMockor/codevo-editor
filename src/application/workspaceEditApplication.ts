export interface AppliedWorkspaceEditOpenDocument {
  content: string;
  path: string;
  versionId: number;
}

export interface WorkspaceEditApplicationContext {
  applyOpenModels?: () => WorkspaceEditOpenModelCommitResult;
  openPaths: string[];
  rootPath: string;
}

export type WorkspaceEditOpenModelCommitResult =
  | {
      documents: AppliedWorkspaceEditOpenDocument[];
      kind: "applied";
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
        | "inactiveWorkspace"
        | "invalidOpenModelEdits"
        | "staleDocumentVersion";
    };
