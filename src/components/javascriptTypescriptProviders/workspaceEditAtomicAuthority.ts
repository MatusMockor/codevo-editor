import type { LanguageServerWorkspaceEdit } from "../../domain/languageServerFeatures";
import type {
  WorkspaceEditApplicationContext,
  WorkspaceEditApplicationDecision,
} from "../../application/workspaceEditApplication";

type WorkspaceEditApplier = (
  edit: LanguageServerWorkspaceEdit,
  context: WorkspaceEditApplicationContext,
) => Promise<WorkspaceEditApplicationDecision | void> | WorkspaceEditApplicationDecision | void;

export function withJavaScriptTypeScriptAtomicWorkspaceEditAuthority(
  applyWorkspaceEdit: WorkspaceEditApplier | undefined,
  isStillActive: () => boolean,
): WorkspaceEditApplier | undefined {
  if (!applyWorkspaceEdit) {
    return undefined;
  }
  return (edit, context) => {
    const applyOpenModels = context.applyOpenModels;
    return applyWorkspaceEdit(edit, {
      ...context,
      ...(applyOpenModels
        ? {
            applyOpenModels: () => {
              const applied = applyOpenModels();
              if (applied.kind !== "applied") {
                return applied;
              }
              return {
                ...applied,
                finalize: () => {
                  if (!isStillActive()) {
                    applied.rollback?.();
                    return rejectedCommit(context.rootPath);
                  }
                  const finalized = applied.finalize?.() ?? applied;
                  if (!isStillActive() && finalized.kind === "applied") {
                    finalized.rollback?.();
                    return rejectedCommit(context.rootPath);
                  }
                  return finalized;
                },
              };
            },
          }
        : {}),
      requiresAtomicFinalization: true,
    });
  };
}

function rejectedCommit(path: string) {
  return {
    kind: "rejected" as const,
    path,
    reason: "invalidOpenModelEdits" as const,
  };
}
