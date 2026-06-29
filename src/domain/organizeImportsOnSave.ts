import {
  fileUriFromPath,
  isJavaScriptTypeScriptLanguageServerDocument,
} from "./languageServerDocumentSync";
import {
  canUseLanguageServerFeature,
  pathFromLanguageServerUri,
  type LanguageServerCodeAction,
  type LanguageServerCodeActionContext,
  type LanguageServerRange,
  type LanguageServerTextEdit,
} from "./languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "./languageServerRuntime";
import type { WorkspaceSettings } from "./settings";
import type { EditorDocument } from "./workspace";
import { workspaceRootKeysEqual } from "./workspaceRootKey";

/**
 * LSP code action kind used to request "organize imports" (sort + drop unused)
 * for a whole document. tsserver advertises this under `source.organizeImports`
 * and its `.ts`/`.js` sub-kinds; requesting the base kind is sufficient.
 */
export const organizeImportsCodeActionKind = "source.organizeImports";
export const removeUnusedCodeActionKind = "source.removeUnused.ts";

export type JavaScriptTypeScriptOnSaveSourceActionKind =
  | typeof organizeImportsCodeActionKind
  | typeof removeUnusedCodeActionKind;

export interface OrganizeImportsOnSaveRuntime {
  status: LanguageServerRuntimeStatus | null;
  statusRoot: string | null;
}

export interface OrganizeImportsOnSavePlanInput {
  document: EditorDocument;
  javaScriptTypeScript: OrganizeImportsOnSaveRuntime;
  sourceActionKinds: JavaScriptTypeScriptOnSaveSourceActionKind[];
  workspaceRoot: string;
}

export interface OrganizeImportsOnSavePlan {
  sourceActionKinds: JavaScriptTypeScriptOnSaveSourceActionKind[];
  sessionId: number;
}

export function javaScriptTypeScriptOnSaveSourceActionKinds(
  settings: Pick<
    WorkspaceSettings,
    | "javaScriptTypeScriptOrganizeImportsOnSave"
    | "javaScriptTypeScriptRemoveUnusedOnSave"
  >,
): JavaScriptTypeScriptOnSaveSourceActionKind[] {
  const kinds: JavaScriptTypeScriptOnSaveSourceActionKind[] = [];

  if (settings.javaScriptTypeScriptOrganizeImportsOnSave) {
    kinds.push(organizeImportsCodeActionKind);
  }

  if (settings.javaScriptTypeScriptRemoveUnusedOnSave) {
    kinds.push(removeUnusedCodeActionKind);
  }

  return kinds;
}

/**
 * Decides whether a save-time LSP "organize imports" pass should run for the
 * given document. Only JavaScript/TypeScript documents qualify (the PHP path
 * uses the synchronous `phpImportsOrganizer` instead); the language server must
 * be running for the requested workspace root and must advertise code action
 * support. Returns the active session id so the caller can re-check the session
 * after the (async) code action request before applying its edits. Returns null
 * when organize-on-save does not apply, in which case the save proceeds
 * untouched.
 */
export function planOrganizeImportsOnSave(
  input: OrganizeImportsOnSavePlanInput,
): OrganizeImportsOnSavePlan | null {
  if (input.sourceActionKinds.length === 0) {
    return null;
  }

  if (!isJavaScriptTypeScriptLanguageServerDocument(input.document)) {
    return null;
  }

  const status = runningStatusForWorkspace(
    input.javaScriptTypeScript.status,
    input.javaScriptTypeScript.statusRoot,
    input.workspaceRoot,
  );

  if (!status) {
    return null;
  }

  if (!canUseLanguageServerFeature(status.capabilities, "codeAction")) {
    return null;
  }

  return {
    sessionId: status.sessionId,
    sourceActionKinds: input.sourceActionKinds,
  };
}

/**
 * The full-document range covering `content`, used as the requested range for a
 * source-action code action request. `source.organizeImports` operates on the
 * whole file regardless of range, but a valid range is still required.
 */
export function fullDocumentRange(content: string): LanguageServerRange {
  const lines = content.split("\n");
  const lastLine = lines.length - 1;

  return {
    start: { line: 0, character: 0 },
    end: { line: lastLine, character: lines[lastLine]?.length ?? 0 },
  };
}

/**
 * The code action context that asks the server for organize-imports only, so
 * tsserver returns just the `source.organizeImports` action rather than the
 * full quick-fix/refactor set.
 */
export function organizeImportsCodeActionContext(
  kind: JavaScriptTypeScriptOnSaveSourceActionKind = organizeImportsCodeActionKind,
): LanguageServerCodeActionContext {
  return {
    diagnostics: [],
    only: [kind],
  };
}

/**
 * Picks the text edits for `path` out of the organize-imports code actions the
 * server returned. Conservative: ignores actions that only carry a command (we
 * do not execute commands on save), only matches `source.organizeImports`
 * (including sub-kinds like `source.organizeImports.ts`), and only reads edits
 * targeting the saved file's own URI - so it never mutates other documents on
 * save. Returns null when no usable inline edit exists.
 */
export function organizeImportsTextEditsForPath(
  actions: LanguageServerCodeAction[],
  path: string,
  kind: JavaScriptTypeScriptOnSaveSourceActionKind = organizeImportsCodeActionKind,
): LanguageServerTextEdit[] | null {
  const targetUri = fileUriFromPath(path);

  for (const action of actions) {
    if (!isRequestedSourceAction(action, kind)) {
      continue;
    }

    const changes = action.edit?.changes;

    if (!changes) {
      continue;
    }

    const edits = textEditsForTargetUri(changes, targetUri, path);

    if (edits && edits.length > 0) {
      return edits;
    }
  }

  return null;
}

export function organizeImportsCodeActionToResolve(
  actions: LanguageServerCodeAction[],
  kind: JavaScriptTypeScriptOnSaveSourceActionKind = organizeImportsCodeActionKind,
): LanguageServerCodeAction | null {
  for (const action of actions) {
    if (!isRequestedSourceAction(action, kind)) {
      continue;
    }

    if (action.command || action.edit || action.data == null) {
      continue;
    }

    return action;
  }

  return null;
}

function isRequestedSourceAction(
  action: LanguageServerCodeAction,
  kind: JavaScriptTypeScriptOnSaveSourceActionKind,
): boolean {
  return (
    typeof action.kind === "string" &&
    action.kind.startsWith(kind)
  );
}

function textEditsForTargetUri(
  changes: Record<string, LanguageServerTextEdit[]>,
  targetUri: string,
  targetPath: string,
): LanguageServerTextEdit[] | null {
  for (const [uri, edits] of Object.entries(changes)) {
    if (uri === targetUri) {
      return edits;
    }

    if (pathFromLanguageServerUri(uri) === targetPath) {
      return edits;
    }
  }

  return null;
}

function runningStatusForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string,
): Extract<LanguageServerRuntimeStatus, { kind: "running" }> | null {
  if (!status || status.kind !== "running") {
    return null;
  }

  const effectiveRoot = status.rootPath ?? statusRoot;

  if (!effectiveRoot) {
    return null;
  }

  if (!workspaceRootKeysEqual(effectiveRoot, workspaceRoot)) {
    return null;
  }

  return status;
}
