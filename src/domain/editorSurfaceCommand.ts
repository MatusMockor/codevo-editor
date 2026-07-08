import type { KeymapCommandId } from "./keymap";

export const editorSurfaceCommandIds = [
  "editor.rename",
  "editor.quickFix",
  "editor.formatDocument",
  "editor.formatSelection",
  "editor.gotoLine",
] as const satisfies readonly KeymapCommandId[];

export type EditorSurfaceCommandId = (typeof editorSurfaceCommandIds)[number];

export type EditorSurfaceCommandRunner = (
  commandId: EditorSurfaceCommandId,
) => void;
