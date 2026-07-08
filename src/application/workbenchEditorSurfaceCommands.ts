import type { KeymapCommandId } from "../domain/keymap";
import type {
  EditorSurfaceCommandId,
  EditorSurfaceCommandRunner,
} from "../domain/editorSurfaceCommand";
import type { Command, CommandContext } from "./commandRegistry";

interface WorkbenchEditorSurfaceCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  canCloseActiveSurface: boolean;
  saveActiveDocument: Command["run"];
  closeActiveSurface: Command["run"];
  editorSurfaceCommandRunner?: EditorSurfaceCommandRunner | null;
}

export function workbenchEditorSurfaceCommands({
  shortcut,
  canCloseActiveSurface,
  saveActiveDocument,
  closeActiveSurface,
  editorSurfaceCommandRunner = null,
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
    ...editorSurfaceRunnerCommands.map(({ id, title }) => ({
      id,
      title,
      category: "Editor",
      shortcut: shortcut(id),
      isEnabled: (context: CommandContext) =>
        context.hasActiveDocument && Boolean(editorSurfaceCommandRunner),
      run: () => {
        editorSurfaceCommandRunner?.(id);
      },
    })),
  ];
}

const editorSurfaceRunnerCommands: ReadonlyArray<{
  id: EditorSurfaceCommandId;
  title: string;
}> = [
  {
    id: "editor.rename",
    title: "Rename Symbol",
  },
  {
    id: "editor.gotoLine",
    title: "Go to Line/Column",
  },
  {
    id: "editor.formatDocument",
    title: "Format Document",
  },
  {
    id: "editor.formatSelection",
    title: "Format Selection",
  },
  {
    id: "editor.quickFix",
    title: "Context Actions",
  },
];
