import type { KeymapCommandId } from "./keymap";
import type { EditorSessionOwnerKey } from "./editorSessionOwnerKey";

export const editorSurfaceCommandIds = [
  "editor.quickDefinition",
  "editor.rename",
  "editor.quickFix",
  "editor.formatDocument",
  "editor.formatSelection",
  "editor.gotoLine",
  "editor.nextChange",
  "editor.previousChange",
] as const satisfies readonly KeymapCommandId[];

export type EditorSurfaceCommandId = (typeof editorSurfaceCommandIds)[number];

export interface EditorSurfaceCommandInvocationScope {
  readonly ownerKey: EditorSessionOwnerKey | null;
  readonly documentPath: string | null;
  readonly modelIdentity: object | null;
  readonly surfaceIdentity: object;
}

export function editorSurfaceCommandInvocationScopesEqual(
  left: EditorSurfaceCommandInvocationScope,
  right: EditorSurfaceCommandInvocationScope,
): boolean {
  return (
    left.ownerKey === right.ownerKey &&
    left.documentPath === right.documentPath &&
    left.modelIdentity === right.modelIdentity &&
    left.surfaceIdentity === right.surfaceIdentity
  );
}

export interface EditorSurfaceCommandRunner {
  (
    commandId: EditorSurfaceCommandId,
    scope?: EditorSurfaceCommandInvocationScope,
  ): void;
  captureScope?(): EditorSurfaceCommandInvocationScope | null;
  isEnabled?(
    commandId: EditorSurfaceCommandId,
    scope?: EditorSurfaceCommandInvocationScope,
  ): boolean;
  isScopeCurrent?(scope: EditorSurfaceCommandInvocationScope): boolean;
}
