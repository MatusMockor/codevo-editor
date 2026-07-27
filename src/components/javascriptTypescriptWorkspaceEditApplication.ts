import type * as Monaco from "monaco-editor";
import type { LanguageServerWorkspaceEdit } from "../domain/languageServerFeatures";
import {
  canonicalWorkspaceEditDocumentPath,
  canonicalWorkspaceEditPath,
} from "../domain/workspaceEditDocuments";
import type {
  WorkspaceEditApplicationDecision,
  WorkspaceEditOpenModelCommitResult,
} from "../application/workspaceEditApplication";
import { validateStagedWorkspaceEditModels } from "../domain/workspaceEditModelValidation";
import { modelMatchesWorkspacePath, modelPath } from "./phpMonacoDocumentContext";

interface StagedOpenModelEdit {
  content: string;
  edits: LanguageServerWorkspaceEdit["changes"][string];
  model: Monaco.editor.ITextModel;
  path: string;
  versionId: number;
}

export type AppliedJavaScriptTypeScriptWorkspaceEditCommit = Extract<
  WorkspaceEditOpenModelCommitResult,
  { kind: "applied" }
>;

export async function applyJavaScriptTypeScriptWorkspaceEditWithOpenModels(
  monaco: typeof Monaco,
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
  applyWorkspaceEdit:
    | ((
        edit: LanguageServerWorkspaceEdit,
        context: {
          applyOpenModels(): WorkspaceEditOpenModelCommitResult;
          openPaths: string[];
          rootPath: string;
        },
      ) =>
        Promise<WorkspaceEditApplicationDecision | void> | WorkspaceEditApplicationDecision | void)
    | undefined,
  isStillActive: () => boolean,
  onApplied?: (commit: AppliedJavaScriptTypeScriptWorkspaceEditCommit) => void,
): Promise<boolean> {
  if (!isStillActive()) return false;
  const stagedEdits = stageOpenModelEdits(monaco, edit, rootPath);
  let commit: WorkspaceEditOpenModelCommitResult | undefined;
  const applyOpenModels = () => {
    if (commit) return commit;
    if (!isStillActive()) {
      return {
        kind: "rejected",
        path: rootPath,
        reason: "invalidOpenModelEdits",
      } satisfies WorkspaceEditOpenModelCommitResult;
    }
    commit = applyStagedEdits(monaco, stagedEdits);
    if (commit.kind === "applied") {
      onApplied?.(commit);
    }
    return commit;
  };

  if (!isStillActive()) return false;
  const decision = await applyWorkspaceEdit?.(edit, {
    applyOpenModels,
    openPaths: stagedEdits.map(({ path }) => path),
    rootPath,
  });
  if (decision?.kind === "rejected" || !isStillActive()) {
    if (commit?.kind === "applied") commit.rollback?.();
    return false;
  }

  const applied = applyOpenModels();
  if (!isStillActive() && applied.kind === "applied") {
    applied.rollback?.();
    return false;
  }
  return applied.kind === "applied";
}

function stageOpenModelEdits(
  monaco: typeof Monaco,
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
): StagedOpenModelEdit[] {
  const models = new Map(
    monaco.editor.getModels().flatMap((model) => {
      const path = modelPath(model);
      return path && modelMatchesWorkspacePath(model, rootPath, path)
        ? [[canonicalWorkspaceEditPath(path), model] as const]
        : [];
    }),
  );
  return Object.entries(edit.changes).flatMap(([uri, edits]) => {
    const path = canonicalWorkspaceEditDocumentPath(uri);
    const model = path ? models.get(path) : null;
    return path && model && edits.length
      ? [{ content: model.getValue(), edits, model, path, versionId: model.getVersionId() }]
      : [];
  });
}

function applyStagedEdits(
  monaco: typeof Monaco,
  stagedEdits: StagedOpenModelEdit[],
): WorkspaceEditOpenModelCommitResult {
  const validation = validateStagedWorkspaceEditModels(
    stagedEdits,
    monaco.editor.getModels(),
    (model) => ({ content: model.getValue(), versionId: model.getVersionId() }),
  );
  if (validation.kind === "invalid") {
    return { kind: "rejected", path: validation.path, reason: "invalidOpenModelEdits" };
  }

  const applied: Array<{ appliedContent: string; staged: StagedOpenModelEdit }> = [];
  const rollback = () => {
    for (const { appliedContent, staged } of [...applied].reverse()) {
      if (staged.model.getValue() === appliedContent) staged.model.setValue(staged.content);
    }
  };
  try {
    for (const staged of stagedEdits) {
      staged.model.pushEditOperations(
        [],
        staged.edits.map(({ newText, range }) => ({
          range: {
            endColumn: range.end.character + 1,
            endLineNumber: range.end.line + 1,
            startColumn: range.start.character + 1,
            startLineNumber: range.start.line + 1,
          },
          text: newText,
        })),
        () => null,
      );
      applied.push({ appliedContent: staged.model.getValue(), staged });
    }
  } catch (error) {
    rollback();
    throw error;
  }

  const result: WorkspaceEditOpenModelCommitResult = {
    documents: stagedEdits.map(({ model, path }) => ({
      content: model.getValue(),
      path,
      versionId: model.getVersionId(),
    })),
    kind: "applied",
  };
  Object.defineProperty(result, "rollback", { value: rollback });
  return result;
}
