import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchNavigationHistoryCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  canNavigateBackward: boolean;
  canNavigateForward: boolean;
  navigateBackward: Command["run"];
  navigateForward: Command["run"];
}

export function workbenchNavigationHistoryCommands({
  shortcut,
  canNavigateBackward,
  canNavigateForward,
  navigateBackward,
  navigateForward,
}: WorkbenchNavigationHistoryCommandsOptions): Command[] {
  return [
    {
      id: "navigation.back",
      title: "Go Back",
      category: "Navigation",
      shortcut: shortcut("navigation.back"),
      isEnabled: () => canNavigateBackward,
      run: navigateBackward,
    },
    {
      id: "navigation.forward",
      title: "Go Forward",
      category: "Navigation",
      shortcut: shortcut("navigation.forward"),
      isEnabled: () => canNavigateForward,
      run: navigateForward,
    },
  ];
}
