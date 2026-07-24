import type * as Monaco from "monaco-editor";
import { modelMatchesWorkspacePath, modelPath } from "./phpMonacoDocumentContext";
import type { EditorDocument } from "../domain/workspace";
import type { WorkspaceIdentityDescriptor } from "./phpMonacoDocumentContext";

export type IncompleteWorkspaceIdentityDescriptor =
  | { canonicalRoot?: string; workspaceId?: undefined }
  | { canonicalRoot?: undefined; workspaceId?: string };

export function resolveCompleteWorkspaceIdentityDescriptor(
  descriptor: WorkspaceIdentityDescriptor | IncompleteWorkspaceIdentityDescriptor | null,
): WorkspaceIdentityDescriptor | null {
  return typeof descriptor?.workspaceId === "string" && typeof descriptor.canonicalRoot === "string"
    ? descriptor
    : null;
}

export function modelForPath(
  monaco: typeof Monaco,
  workspaceRoot: string | null,
  path: string,
): Monaco.editor.ITextModel | null {
  return (
    monaco.editor.getModels().find((model) => modelMatchesProject(model, workspaceRoot, path)) ??
    null
  );
}

export function modelMatchesProject(
  model: Monaco.editor.ITextModel,
  workspaceRoot: string | null,
  path: string,
): boolean {
  return workspaceRoot
    ? modelMatchesWorkspacePath(model, workspaceRoot, path)
    : modelPath(model) === path;
}

export function synchronizeActiveDocumentModel(
  editor: Monaco.editor.IStandaloneCodeEditor,
  workspaceRoot: string | null,
  document: EditorDocument,
): Monaco.editor.ITextModel | null {
  const model = editor.getModel();

  if (!model || model.isDisposed?.() || !modelMatchesProject(model, workspaceRoot, document.path)) {
    return null;
  }
  if (model.getValue() !== document.content) model.setValue(document.content);
  return model.isDisposed?.() || editor.getModel() !== model ? null : model;
}
