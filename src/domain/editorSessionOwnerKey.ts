import { normalizedWorkspaceRootKey } from "./workspaceRootKey";

declare const editorSessionOwnerKeyBrand: unique symbol;

export type EditorSessionOwnerKey = string & {
  readonly [editorSessionOwnerKeyBrand]: "EditorSessionOwnerKey";
};

export function createEditorSessionOwnerKey(
  workspaceId: string,
  canonicalRoot: string,
): EditorSessionOwnerKey {
  requireValue(workspaceId, "Editor session workspace ID");
  requireValue(canonicalRoot, "Editor session canonical root");

  return `editor-session:${JSON.stringify([
    workspaceId,
    normalizedWorkspaceRootKey(canonicalRoot),
  ])}` as EditorSessionOwnerKey;
}

export function createLegacyEditorSessionOwnerKey(
  rootPath: string,
): EditorSessionOwnerKey {
  requireValue(rootPath, "Editor session root");

  return normalizedWorkspaceRootKey(rootPath) as EditorSessionOwnerKey;
}

function requireValue(value: string, name: string): void {
  if (value.trim()) {
    return;
  }

  throw new TypeError(`${name} must be non-empty`);
}
