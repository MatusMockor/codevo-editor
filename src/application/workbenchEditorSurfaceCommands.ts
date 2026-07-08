import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchEditorSurfaceCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  canCloseActiveSurface: boolean;
  saveActiveDocument: Command["run"];
  closeActiveSurface: Command["run"];
}

export function workbenchEditorSurfaceCommands({
  shortcut,
  canCloseActiveSurface,
  saveActiveDocument,
  closeActiveSurface,
}: WorkbenchEditorSurfaceCommandsOptions): Command[] {
  return [
    {
      id: "editor.save",
      title: "Save File",
      category: "Editor",
      shortcut: shortcut("editor.save"),
      isEnabled: (context) =>
        context.hasActiveDocument && context.activeDocumentDirty,
      run: saveActiveDocument,
    },
    {
      id: "editor.closeTab",
      title: "Close",
      category: "Editor",
      shortcut: shortcut("editor.closeTab"),
      isEnabled: () => canCloseActiveSurface,
      run: closeActiveSurface,
    },
  ];
}
