import { applyLanguageServerTextEdits } from "../application/languageServerTextEdits";
import {
  createWorkspaceRootFromPath,
  parseWorkspacePath,
  type WorkspacePathKey,
  type WorkspacePathPolicy,
  type WorkspaceRootDescriptor,
} from "../domain/workspacePath";
import type {
  LanguageServerCodeAction,
  LanguageServerFeaturesGateway,
  LanguageServerTextEdit,
} from "../domain/languageServerFeatures";
import {
  fullDocumentRange,
  organizeImportsCodeActionContext,
  organizeImportsCodeActionToResolve,
  organizeImportsCodeActionKind,
  removeUnusedImportsCodeActionKind,
  sortImportsCodeActionKind,
  type JavaScriptTypeScriptOnSaveSourceActionKind,
} from "../domain/organizeImportsOnSave";
import type { EditorSurfaceCommandId } from "../domain/editorSurfaceCommand";

export interface EditorSurfaceImportActionRequest {
  readonly content: string;
  readonly gateway: LanguageServerFeaturesGateway;
  readonly kind: JavaScriptTypeScriptOnSaveSourceActionKind;
  readonly path: string;
  readonly rootPath: string;
  readonly version: () => number | null;
  readonly workspacePathPolicy?: WorkspacePathPolicy;
  apply(edits: readonly LanguageServerTextEdit[]): boolean;
  flush(): Promise<void>;
  isCurrent(): boolean;
  reportError(): void;
}

export function editorSurfaceImportActionKind(
  commandId: EditorSurfaceCommandId,
  languageId: string,
): JavaScriptTypeScriptOnSaveSourceActionKind | null {
  if (commandId === "editor.action.organizeImports") {
    return isJavaScriptTypeScriptLanguage(languageId) ? organizeImportsCodeActionKind : null;
  }
  if (commandId === "typescript.sortImports") {
    return TYPESCRIPT_LANGUAGE_IDS.has(languageId) ? sortImportsCodeActionKind : null;
  }
  if (commandId === "javascript.sortImports") {
    return JAVASCRIPT_LANGUAGE_IDS.has(languageId) ? sortImportsCodeActionKind : null;
  }
  if (commandId === "typescript.removeUnusedImports") {
    return TYPESCRIPT_LANGUAGE_IDS.has(languageId) ? removeUnusedImportsCodeActionKind : null;
  }
  if (commandId === "javascript.removeUnusedImports") {
    return JAVASCRIPT_LANGUAGE_IDS.has(languageId) ? removeUnusedImportsCodeActionKind : null;
  }
  return null;
}

/**
 * Runs one LSP source action against an immutable editor capture. Every async
 * boundary is fenced, and only exact same-file text edits can reach `apply`.
 */
export async function executeEditorSurfaceImportAction(
  request: EditorSurfaceImportActionRequest,
): Promise<boolean> {
  try {
    await request.flush();
    if (!request.isCurrent()) return false;
    const version = request.version();
    if (version === null) return false;
    const actions = await request.gateway.codeActions(
      request.rootPath,
      request.path,
      fullDocumentRange(request.content),
      organizeImportsCodeActionContext(request.kind),
    );
    if (!request.isCurrent() || request.version() !== version) return false;

    let selection = selectValidatedSameFileEdits(
      actions,
      request.rootPath,
      request.path,
      request.kind,
      version,
      request.content,
      request.workspacePathPolicy,
    );
    let edits = selection.edits;
    let invalidRanges = selection.invalidRanges;
    if (!edits) {
      for (const unresolved of unresolvedActions(actions, request.kind)) {
        const resolved = await request.gateway.resolveCodeAction(request.rootPath, unresolved);
        if (!request.isCurrent() || request.version() !== version) return false;
        selection = selectValidatedSameFileEdits(
          [resolved],
          request.rootPath,
          request.path,
          request.kind,
          version,
          request.content,
          request.workspacePathPolicy,
        );
        edits = selection.edits;
        invalidRanges ||= selection.invalidRanges;
        if (edits) break;
      }
    }
    if (!edits) {
      if (invalidRanges) throw new Error("Import action returned invalid edit ranges.");
      return false;
    }
    if (!request.isCurrent() || request.version() !== version) return false;
    const applied = request.apply(edits);
    if (!applied) reportCurrentError(request);
    return applied;
  } catch {
    reportCurrentError(request);
    return false;
  }
}

function selectValidatedSameFileEdits(
  actions: readonly LanguageServerCodeAction[],
  rootPath: string,
  path: string,
  kind: JavaScriptTypeScriptOnSaveSourceActionKind,
  version: number,
  content: string,
  workspacePathPolicy?: WorkspacePathPolicy,
): {
  readonly edits: readonly LanguageServerTextEdit[] | null;
  readonly invalidRanges: boolean;
} {
  let invalidRanges = false;
  for (const action of preferredFirst(actions)) {
    if (!isUsableAction(action, kind)) continue;
    const edits = exactSameFileEdits(action, rootPath, path, version, workspacePathPolicy);
    if (!edits?.length) continue;
    try {
      applyLanguageServerTextEdits(content, [...edits]);
      return { edits, invalidRanges };
    } catch {
      invalidRanges = true;
    }
  }
  return { edits: null, invalidRanges };
}

function reportCurrentError(request: EditorSurfaceImportActionRequest): void {
  try {
    if (request.isCurrent()) request.reportError();
  } catch {
    // Reporting is best-effort and must never turn a failed command into an
    // unhandled rejection when the editor/model is being disposed.
  }
}

function exactSameFileEdits(
  action: LanguageServerCodeAction,
  rootPath: string,
  path: string,
  version: number,
  workspacePathPolicy?: WorkspacePathPolicy,
): readonly LanguageServerTextEdit[] | null {
  const edit = action.edit;
  if (!edit || edit.fileOperations?.length) return null;
  const root = createWorkspaceRootFromPath(rootPath, workspacePathPolicy);
  if (!root.ok) return null;
  const target = parseWorkspacePath(root.value, path);
  if (!target.ok) return null;
  const entries = Object.entries(edit.changes);
  if (entries.length !== 1) return null;
  const [editUri, edits] = entries[0]!;
  if (workspacePathKey(root.value, editUri) !== target.value.key) return null;
  const versionEntries = Object.entries(edit.documentVersions ?? {});
  if (versionEntries.length !== 1) return null;
  const [versionUri, editVersion] = versionEntries[0]!;
  if (workspacePathKey(root.value, versionUri) !== target.value.key || editVersion !== version) {
    return null;
  }
  return edits;
}

function workspacePathKey(
  root: WorkspaceRootDescriptor,
  pathOrUri: string,
): WorkspacePathKey | null {
  const path = parseWorkspacePath(root, pathOrUri);
  return path.ok ? path.value.key : null;
}

function isUsableAction(
  action: LanguageServerCodeAction,
  kind: JavaScriptTypeScriptOnSaveSourceActionKind,
): boolean {
  return (
    action.disabled == null &&
    !action.command &&
    (action.kind === kind || action.kind?.startsWith(`${kind}.`) === true)
  );
}

function preferredFirst(
  actions: readonly LanguageServerCodeAction[],
): readonly LanguageServerCodeAction[] {
  return actions
    .map((action, index) => ({ action, index }))
    .sort(
      (left, right) =>
        Number(right.action.isPreferred) - Number(left.action.isPreferred) ||
        left.index - right.index,
    )
    .map(({ action }) => action);
}

function unresolvedActions(
  actions: readonly LanguageServerCodeAction[],
  kind: JavaScriptTypeScriptOnSaveSourceActionKind,
): readonly LanguageServerCodeAction[] {
  return preferredFirst(actions).filter(
    (action) =>
      action.disabled == null && organizeImportsCodeActionToResolve([action], kind) === action,
  );
}

const JAVASCRIPT_LANGUAGE_IDS = new Set(["javascript", "javascriptreact"]);
const TYPESCRIPT_LANGUAGE_IDS = new Set(["typescript", "typescriptreact"]);

function isJavaScriptTypeScriptLanguage(languageId: string): boolean {
  return JAVASCRIPT_LANGUAGE_IDS.has(languageId) || TYPESCRIPT_LANGUAGE_IDS.has(languageId);
}
