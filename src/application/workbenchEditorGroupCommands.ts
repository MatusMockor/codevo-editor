import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchEditorGroupCommandsOptions {
  canCloseGroup: boolean;
  canMoveBetweenGroups: boolean;
  closeActiveGroup: Command["run"];
  focusNextGroup: Command["run"];
  focusPreviousGroup: Command["run"];
  moveActiveTabToNextGroup: Command["run"];
  moveActiveTabToPreviousGroup: Command["run"];
  shortcut(commandId: KeymapCommandId): string;
  splitDown: Command["run"];
  splitRight: Command["run"];
}

export function workbenchEditorGroupCommands(
  options: WorkbenchEditorGroupCommandsOptions,
): Command[] {
  const command = (
    id: KeymapCommandId,
    title: string,
    run: Command["run"],
    isEnabled: () => boolean = () => true,
  ): Command => ({
    category: "Editor Groups",
    id,
    isEnabled,
    run,
    shortcut: options.shortcut(id),
    title,
  });

  return [
    command("editor.splitRight", "Split Editor Right", options.splitRight),
    command("editor.splitDown", "Split Editor Down", options.splitDown),
    command(
      "editor.focusNextGroup",
      "Focus Next Editor Group",
      options.focusNextGroup,
      () => options.canMoveBetweenGroups,
    ),
    command(
      "editor.focusPreviousGroup",
      "Focus Previous Editor Group",
      options.focusPreviousGroup,
      () => options.canMoveBetweenGroups,
    ),
    command(
      "editor.moveTabToNextGroup",
      "Move Tab to Next Group",
      options.moveActiveTabToNextGroup,
      () => options.canMoveBetweenGroups,
    ),
    command(
      "editor.moveTabToPreviousGroup",
      "Move Tab to Previous Group",
      options.moveActiveTabToPreviousGroup,
      () => options.canMoveBetweenGroups,
    ),
    command(
      "editor.closeGroup",
      "Close Editor Group",
      options.closeActiveGroup,
      () => options.canCloseGroup,
    ),
  ];
}
