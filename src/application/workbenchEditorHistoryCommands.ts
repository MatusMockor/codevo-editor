import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchEditorHistoryCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  toggleGitBlame: Command["run"];
  openFileHistory: () => Promise<void>;
  openLocalHistory: () => Promise<void>;
}

export function workbenchEditorHistoryCommands({
  shortcut,
  toggleGitBlame,
  openFileHistory,
  openLocalHistory,
}: WorkbenchEditorHistoryCommandsOptions): Command[] {
  return [
    {
      id: "editor.toggleGitBlame",
      title: "Annotate with Git Blame",
      category: "Editor",
      shortcut: shortcut("editor.toggleGitBlame"),
      isEnabled: (context) =>
        context.hasWorkspace && context.hasActiveDocument,
      run: toggleGitBlame,
    },
    {
      id: "editor.showFileHistory",
      title: "Show File History",
      category: "Editor",
      shortcut: shortcut("editor.showFileHistory"),
      isEnabled: (context) =>
        context.hasWorkspace && context.hasActiveDocument,
      run: () => {
        void openFileHistory();
      },
    },
    {
      id: "editor.showLocalHistory",
      title: "Local History: Show History",
      category: "Editor",
      shortcut: shortcut("editor.showLocalHistory"),
      isEnabled: (context) =>
        context.hasWorkspace && context.hasActiveDocument,
      run: () => {
        void openLocalHistory();
      },
    },
  ];
}
