import type { KeymapCommandId } from "./keymap";

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

export interface EditorSurfaceCommandRunner {
  (commandId: EditorSurfaceCommandId): void;
  isEnabled?(commandId: EditorSurfaceCommandId): boolean;
}
