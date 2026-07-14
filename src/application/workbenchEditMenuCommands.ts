import type {
  EditorMenuCommand,
  EditorMenuCommandRunner,
} from "../domain/editorMenuCommand";
import { detectKeymapPlatform, type KeymapPlatform } from "../domain/keymap";
import type { Command, CommandContext } from "./commandRegistry";

interface WorkbenchEditMenuCommandsOptions {
  editorMenuCommandRunner?: EditorMenuCommandRunner | null;
  platform?: KeymapPlatform;
}

export function workbenchEditMenuCommands({
  editorMenuCommandRunner = null,
  platform = detectKeymapPlatform(),
}: WorkbenchEditMenuCommandsOptions): Command[] {
  return editMenuCommandDefinitions.map(
    ({ id, menuCommand, shortcut, title }) => ({
      id,
      title,
      category: "Editor",
      shortcut: editMenuShortcutForPlatform(shortcut, platform),
      isEnabled: (context: CommandContext) =>
        context.hasActiveDocument && Boolean(editorMenuCommandRunner),
      run: () => {
        editorMenuCommandRunner?.(menuCommand);
      },
    }),
  );
}

function editMenuShortcutForPlatform(
  shortcut: string,
  platform: KeymapPlatform,
): string {
  if (platform === "mac") {
    return shortcut;
  }

  return shortcut
    .split("+")
    .map((part) => (part === "Cmd" ? "Ctrl" : part))
    .join("+");
}

const editMenuCommandDefinitions: ReadonlyArray<{
  id: string;
  menuCommand: EditorMenuCommand;
  shortcut: string;
  title: string;
}> = [
  { id: "edit.undo", menuCommand: "undo", shortcut: "Cmd+Z", title: "Undo" },
  { id: "edit.redo", menuCommand: "redo", shortcut: "Cmd+Y", title: "Redo" },
  { id: "edit.cut", menuCommand: "cut", shortcut: "Cmd+X", title: "Cut" },
  { id: "edit.copy", menuCommand: "copy", shortcut: "Cmd+C", title: "Copy" },
  {
    id: "edit.paste",
    menuCommand: "paste",
    shortcut: "Cmd+V",
    title: "Paste",
  },
  {
    id: "edit.selectAll",
    menuCommand: "selectAll",
    shortcut: "Cmd+A",
    title: "Select All",
  },
];
