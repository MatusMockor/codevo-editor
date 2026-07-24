import type { EditorSurfaceCommandId } from "../domain/editorSurfaceCommand";

/** Maps the workbench's bounded surface commands to Monaco's built-in actions. */
export function editorActionForSurfaceCommand(commandId: EditorSurfaceCommandId): string | null {
  switch (commandId) {
    case "editor.action.organizeImports":
    case "javascript.removeUnusedImports":
    case "javascript.sortImports":
    case "typescript.removeUnusedImports":
    case "typescript.sortImports":
    case "editor.nextChange":
    case "editor.previousChange":
      return null;
    case "editor.formatDocument":
      return "editor.action.formatDocument";
    case "editor.formatSelection":
      return "editor.action.formatSelection";
    case "editor.gotoLine":
      return "editor.action.gotoLine";
    case "editor.quickDefinition":
      return "editor.action.peekDefinition";
    case "editor.quickFix":
      return "editor.action.quickFix";
    case "editor.action.refactor":
      return "editor.action.refactor";
    case "editor.rename":
      return "editor.action.rename";
  }
}
