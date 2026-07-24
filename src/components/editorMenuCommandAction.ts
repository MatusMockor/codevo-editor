import type { EditorMenuCommand } from "../domain/editorMenuCommand";

export function editorActionForMenuCommand(command: EditorMenuCommand): string {
  switch (command) {
    case "copy":
      return "editor.action.clipboardCopyAction";
    case "cut":
      return "editor.action.clipboardCutAction";
    case "gotoLine":
      return "editor.action.gotoLine";
    case "paste":
      return "editor.action.clipboardPasteAction";
    case "redo":
      return "redo";
    case "selectAll":
      return "editor.action.selectAll";
    case "undo":
      return "undo";
  }
}
