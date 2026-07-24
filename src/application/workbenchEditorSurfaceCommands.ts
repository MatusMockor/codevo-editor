import type { KeymapCommandId } from "../domain/keymap";
import type {
  EditorSurfaceCommandId,
  EditorSurfaceCommandRunner,
} from "../domain/editorSurfaceCommand";
import type { Command, CommandContext } from "./commandRegistry";

interface WorkbenchEditorSurfaceCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  canCloseActiveSurface: boolean;
  canReopenClosedDocument: boolean;
  canRunJavaScriptTypeScriptImportActions?: boolean;
  canRunJavaScriptTypeScriptRefactors?: boolean;
  javaScriptTypeScriptImportLanguage?: "javascript" | "typescript" | null;
  saveActiveDocument: Command["run"];
  closeActiveSurface: Command["run"];
  reopenClosedDocument: Command["run"];
  editorSurfaceCommandRunner?: EditorSurfaceCommandRunner | null;
}

export function workbenchEditorSurfaceCommands({
  shortcut,
  canCloseActiveSurface,
  canReopenClosedDocument,
  canRunJavaScriptTypeScriptImportActions = false,
  canRunJavaScriptTypeScriptRefactors = false,
  javaScriptTypeScriptImportLanguage = null,
  saveActiveDocument,
  closeActiveSurface,
  reopenClosedDocument,
  editorSurfaceCommandRunner = null,
}: WorkbenchEditorSurfaceCommandsOptions): Command[] {
  return [
    {
      id: "editor.save",
      title: "Save File",
      category: "Editor",
      shortcut: shortcut("editor.save"),
      isEnabled: (context) => context.hasActiveDocument && context.activeDocumentDirty,
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
    {
      id: "editor.reopenClosedTab",
      title: "Reopen Closed Tab",
      category: "Editor",
      shortcut: shortcut("editor.reopenClosedTab"),
      isEnabled: () => canReopenClosedDocument,
      run: reopenClosedDocument,
    },
    ...editorSurfaceRunnerCommands.map(
      ({
        category,
        id,
        importLanguage,
        javaScriptTypeScriptImportAction,
        javaScriptTypeScriptRefactor,
        title,
      }) => ({
        id,
        title,
        category,
        shortcut: shortcut(id),
        isEnabled: (context: CommandContext) => {
          if (
            !context.hasActiveDocument ||
            !editorSurfaceCommandRunner ||
            (javaScriptTypeScriptImportAction && !canRunJavaScriptTypeScriptImportActions) ||
            (javaScriptTypeScriptRefactor && !canRunJavaScriptTypeScriptRefactors) ||
            (importLanguage !== undefined && importLanguage !== javaScriptTypeScriptImportLanguage)
          ) {
            return false;
          }

          if (!context.editorSurfaceScope) {
            return editorSurfaceCommandRunner.isEnabled?.(id) ?? true;
          }

          return editorSurfaceCommandRunner.isEnabled?.(id, context.editorSurfaceScope) ?? true;
        },
        run: (context?: CommandContext) => {
          if (!context?.editorSurfaceScope) {
            editorSurfaceCommandRunner?.(id);
            return;
          }

          editorSurfaceCommandRunner?.(id, context.editorSurfaceScope);
        },
      }),
    ),
  ];
}

const editorSurfaceRunnerCommands: ReadonlyArray<{
  category: string;
  id: EditorSurfaceCommandId;
  importLanguage?: "javascript" | "typescript";
  javaScriptTypeScriptImportAction?: boolean;
  javaScriptTypeScriptRefactor?: boolean;
  title: string;
}> = [
  {
    category: "Editor",
    id: "editor.quickDefinition",
    title: "Quick Definition",
  },
  {
    category: "Editor",
    id: "editor.rename",
    title: "Rename Symbol",
  },
  {
    category: "Editor",
    id: "editor.gotoLine",
    title: "Go to Line/Column",
  },
  {
    category: "Editor",
    id: "editor.formatDocument",
    title: "Format Document",
  },
  {
    category: "Editor",
    id: "editor.formatSelection",
    title: "Format Selection",
  },
  {
    category: "Editor",
    id: "editor.action.organizeImports",
    javaScriptTypeScriptImportAction: true,
    title: "Organize Imports",
  },
  {
    category: "TypeScript",
    id: "typescript.sortImports",
    importLanguage: "typescript",
    javaScriptTypeScriptImportAction: true,
    title: "Sort Imports",
  },
  {
    category: "JavaScript",
    id: "javascript.sortImports",
    importLanguage: "javascript",
    javaScriptTypeScriptImportAction: true,
    title: "Sort Imports",
  },
  {
    category: "TypeScript",
    id: "typescript.removeUnusedImports",
    importLanguage: "typescript",
    javaScriptTypeScriptImportAction: true,
    title: "Remove Unused Imports",
  },
  {
    category: "JavaScript",
    id: "javascript.removeUnusedImports",
    importLanguage: "javascript",
    javaScriptTypeScriptImportAction: true,
    title: "Remove Unused Imports",
  },
  {
    category: "Editor",
    id: "editor.quickFix",
    title: "Context Actions",
  },
  {
    category: "Editor",
    id: "editor.action.refactor",
    javaScriptTypeScriptRefactor: true,
    title: "Refactor",
  },
  {
    category: "Editor",
    id: "editor.nextChange",
    title: "Go to Next Change",
  },
  {
    category: "Editor",
    id: "editor.previousChange",
    title: "Go to Previous Change",
  },
];
