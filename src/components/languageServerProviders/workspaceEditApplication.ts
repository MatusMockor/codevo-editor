import type * as Monaco from "monaco-editor";
import type {
  LanguageServerTextEdit,
  LanguageServerWorkspaceEdit,
  LanguageServerWorkspaceEditEvent,
} from "../../domain/languageServerFeatures";
import { pathFromLanguageServerUri } from "../../domain/languageServerFeatures";
import {
  canonicalWorkspaceEditDocumentPath,
  canonicalWorkspaceEditPath,
  mergeAliasedWorkspaceEditDocumentChanges,
} from "../../domain/workspaceEditDocuments";
import { validateStagedWorkspaceEditModels } from "../../domain/workspaceEditModelValidation";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { PhpCodeActionWorkspaceEditApplier } from "../../application/phpCodeActionTypes";
import type {
  WorkspaceEditApplicationContext,
  WorkspaceEditApplicationDecision,
  WorkspaceEditOpenModelCommitResult,
} from "../../application/workspaceEditApplication";
import { modelMatchesWorkspacePath, modelPath } from "../phpMonacoDocumentContext";
import { toMonacoRange } from "../languageServerMonacoMappings";
import {
  isPathInWorkspaceRoot,
  isWorkspaceEditEventActive,
  type ProviderRequestLifecycleContext,
} from "./providerRequestLifecycle";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;

export interface WorkspaceEditProviderContext {
  applyWorkspaceEdit?(
    edit: LanguageServerWorkspaceEdit,
    context: WorkspaceEditApplicationContext,
  ): Promise<WorkspaceEditApplicationDecision | void> | WorkspaceEditApplicationDecision | void;
  getWorkspaceRoot?(): string | null;
  isProviderRegistrationActive?(): boolean;
}

interface StagedOpenModelEdit {
  content: string;
  edits: LanguageServerTextEdit[];
  model: MonacoModel;
  path: string;
  versionId: number;
}

function stageWorkspaceEditForOpenModels(
  monaco: MonacoApi,
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
): StagedOpenModelEdit[] {
  const modelsByPath = new Map(
    monaco.editor.getModels().flatMap((model) => {
      const path = modelPath(model);

      if (!path || !modelMatchesWorkspacePath(model, rootPath, path)) {
        return [];
      }

      return [[canonicalWorkspaceEditPath(path), model] as const];
    }),
  );

  return Object.entries(edit.changes).flatMap(([uri, edits]) => {
    const path = canonicalWorkspaceEditDocumentPath(uri);
    const model = path ? modelsByPath.get(path) : null;

    if (!path || !model || edits.length === 0) {
      return [];
    }

    return [
      {
        content: model.getValue(),
        edits,
        model,
        path,
        versionId: model.getVersionId(),
      },
    ];
  });
}

function applyStagedOpenModelEdits(
  monaco: MonacoApi,
  stagedEdits: StagedOpenModelEdit[],
): WorkspaceEditOpenModelCommitResult {
  const validation = validateStagedWorkspaceEditModels(
    stagedEdits,
    monaco.editor.getModels(),
    (model) => ({ content: model.getValue(), versionId: model.getVersionId() }),
  );

  if (validation.kind === "invalid") {
    return {
      kind: "rejected",
      path: validation.path,
      reason: "invalidOpenModelEdits",
    };
  }

  const applied: Array<{
    appliedContent: string;
    stagedEdit: StagedOpenModelEdit;
  }> = [];
  const rollback = () => {
    for (const { appliedContent, stagedEdit } of [...applied].reverse()) {
      if (stagedEdit.model.getValue() === appliedContent) {
        stagedEdit.model.setValue(stagedEdit.content);
      }
    }
  };
  try {
    for (const stagedEdit of stagedEdits) {
      stagedEdit.model.pushEditOperations(
        [],
        stagedEdit.edits.map((textEdit) => ({
          range: toMonacoRange(monaco, textEdit.range),
          text: textEdit.newText,
        })),
        () => null,
      );
      applied.push({
        appliedContent: stagedEdit.model.getValue(),
        stagedEdit,
      });
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

export async function applyWorkspaceEditWithOpenModels(
  monaco: MonacoApi,
  context: WorkspaceEditProviderContext,
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
  options: {
    expectedClosedFileHashes?: Readonly<Record<string, string>>;
    expectedOpenPaths?: readonly string[];
    isStillActive?: () => boolean;
    requireWorkspaceApplier?: boolean;
  } = {},
): Promise<WorkspaceEditApplicationDecision> {
  const scopedEdit = workspaceEditForRoot(edit, rootPath);
  const stagedEdits = stageWorkspaceEditForOpenModels(monaco, scopedEdit, rootPath);
  if (
    options.expectedOpenPaths &&
    stagedEdits.some(({ path }) => !options.expectedOpenPaths?.includes(path))
  ) {
    return { kind: "rejected", reason: "staleDocumentVersion" };
  }
  if (options.requireWorkspaceApplier && !context.applyWorkspaceEdit) {
    return { kind: "rejected", reason: "atomicWorkspaceEditUnavailable" };
  }
  let commitResult: WorkspaceEditOpenModelCommitResult | undefined;
  const requiresActiveFinalization = Boolean(
    options.isStillActive || context.isProviderRegistrationActive,
  );
  const isStillActive = () =>
    context.isProviderRegistrationActive?.() !== false &&
    options.isStillActive?.() !== false &&
    workspaceRootKeysEqual(context.getWorkspaceRoot?.() ?? rootPath, rootPath);
  const rollbackCommit = () => {
    if (commitResult?.kind === "applied") {
      commitResult.rollback?.();
    }
  };
  const applyOpenModels = () => {
    if (commitResult) {
      return commitResult;
    }

    if (!isStillActive()) {
      return {
        kind: "rejected" as const,
        path: stagedEdits[0]?.path ?? rootPath,
        reason: "invalidOpenModelEdits" as const,
      };
    }

    const applied = applyStagedOpenModelEdits(monaco, stagedEdits);
    commitResult =
      applied.kind === "applied" && requiresActiveFinalization
        ? {
            ...applied,
            rollback: applied.rollback,
            finalize: () =>
              isStillActive()
                ? applied
                : {
                    kind: "rejected",
                    path: stagedEdits[0]?.path ?? rootPath,
                    reason: "invalidOpenModelEdits",
                  },
          }
        : applied;
    return commitResult;
  };

  const decision = await context.applyWorkspaceEdit?.(scopedEdit, {
    applyOpenModels,
    expectedClosedFileHashes: options.expectedClosedFileHashes,
    openPaths: stagedEdits.map(({ path }) => path),
    ...(requiresActiveFinalization ? { requiresAtomicFinalization: true } : {}),
    rootPath,
  });

  if (decision?.kind === "rejected") {
    rollbackCommit();
    return decision;
  }

  if (!isStillActive()) {
    rollbackCommit();
    return { kind: "rejected", reason: "inactiveWorkspace" };
  }

  applyOpenModels();
  if (!isStillActive()) {
    rollbackCommit();
    return { kind: "rejected", reason: "inactiveWorkspace" };
  }
  return { kind: "accepted" };
}

export function createOpenModelWorkspaceEditApplier(
  monaco: MonacoApi,
  context: WorkspaceEditProviderContext,
): PhpCodeActionWorkspaceEditApplier {
  return (edit, rootPath, openPaths, expectedClosedFileHashes) =>
    applyWorkspaceEditWithOpenModels(monaco, context, edit, rootPath, {
      expectedClosedFileHashes,
      expectedOpenPaths: openPaths,
      requireWorkspaceApplier: true,
    });
}

export async function applyWorkspaceEditEvent(
  monaco: MonacoApi,
  context: WorkspaceEditProviderContext & ProviderRequestLifecycleContext,
  event: LanguageServerWorkspaceEditEvent,
): Promise<void> {
  if (!isWorkspaceEditEventActive(context, event)) {
    return;
  }

  await applyWorkspaceEditWithOpenModels(monaco, context, event.edit, event.rootPath, {
    isStillActive: () => isWorkspaceEditEventActive(context, event),
  });
}

function workspaceEditForRoot(
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
): LanguageServerWorkspaceEdit {
  const changes = Object.fromEntries(
    Object.entries(edit.changes).filter(([uri]) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? isPathInWorkspaceRoot(rootPath, path) : false;
    }),
  );
  const documentVersions = Object.fromEntries(
    Object.entries(edit.documentVersions ?? {}).filter(([uri]) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? isPathInWorkspaceRoot(rootPath, path) : false;
    }),
  );
  const fileOperations = (edit.fileOperations ?? []).filter((operation) => {
    const uris =
      operation.kind === "rename" ? [operation.oldUri, operation.newUri] : [operation.uri];

    return uris.every((uri) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? isPathInWorkspaceRoot(rootPath, path) : false;
    });
  });

  return mergeAliasedWorkspaceEditDocumentChanges({
    ...(fileOperations.length > 0 ? { fileOperations } : {}),
    ...(Object.keys(documentVersions).length > 0 ? { documentVersions } : {}),
    changes,
  });
}
