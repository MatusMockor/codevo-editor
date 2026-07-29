import type * as Monaco from "monaco-editor";
import type { EditorDocument } from "../domain/workspace";
import type { EditorRuntimeContextValue } from "./editorRuntimeContext";
import { workspaceModelUri } from "./phpMonacoDocumentContext";
import {
  activeDocumentModel,
  modelMatchesProject,
  synchronizeActiveDocumentModel,
} from "./editorSurfaceModelIdentity";

export function exactLiveModelOwnsContent(
  runtime: EditorRuntimeContextValue | null,
  groupId: string,
  path: string | null | undefined,
  model: Monaco.editor.ITextModel | null,
): boolean {
  return Boolean(
    path && model && runtime?.ownsExactLiveModelContent?.(groupId, path, model) === true,
  );
}

export function exactLiveEditorOwnsContent(
  runtime: EditorRuntimeContextValue | null,
  groupId: string,
  path: string | null | undefined,
  editor: Monaco.editor.IStandaloneCodeEditor | null,
): boolean {
  return exactLiveModelOwnsContent(runtime, groupId, path, editor?.getModel() ?? null);
}

export function editorSurfaceControlledValue(
  runtime: EditorRuntimeContextValue | null,
  groupId: string,
  editor: Monaco.editor.IStandaloneCodeEditor | null,
  document: EditorDocument | null,
  ready: boolean,
  opening: boolean,
): string | undefined {
  return document &&
    ready &&
    !opening &&
    !exactLiveEditorOwnsContent(runtime, groupId, document.path, editor)
    ? document.content
    : undefined;
}

export function currentEditorModelForPath(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
  workspaceRoot: string | null,
  path: string | null | undefined,
): Monaco.editor.ITextModel | null {
  const model = editor?.getModel() ?? null;
  return model && path && modelMatchesProject(model, workspaceRoot, path) ? model : null;
}

export function editorSurfaceModelPath(
  workspaceRoot: string | null,
  document: EditorDocument | null,
  placeholder: string,
): string {
  return document && workspaceRoot
    ? (workspaceModelUri(workspaceRoot, document.path) ?? document.path)
    : placeholder;
}

export function reconcileActiveDocumentModelContent(
  runtime: EditorRuntimeContextValue | null,
  groupId: string,
  editor: Monaco.editor.IStandaloneCodeEditor,
  workspaceRoot: string | null,
  document: EditorDocument,
): void {
  if (!exactLiveEditorOwnsContent(runtime, groupId, document.path, editor)) {
    const model = synchronizeActiveDocumentModel(editor, workspaceRoot, document);
    if (model) runtime?.acknowledgeExactLiveModelContent?.(groupId, document.path, model);
  }
}

export function activeDocumentModelForReveal(
  runtime: EditorRuntimeContextValue | null,
  groupId: string,
  editor: Monaco.editor.IStandaloneCodeEditor,
  workspaceRoot: string | null,
  document: EditorDocument,
): Monaco.editor.ITextModel | null {
  if (exactLiveEditorOwnsContent(runtime, groupId, document.path, editor)) {
    return activeDocumentModel(editor, workspaceRoot, document.path);
  }
  const model = synchronizeActiveDocumentModel(editor, workspaceRoot, document);
  if (model) runtime?.acknowledgeExactLiveModelContent?.(groupId, document.path, model);
  return model;
}
