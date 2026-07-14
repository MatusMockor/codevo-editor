import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchAppLifecycleCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  quitApplication: Command["run"];
}

export function workbenchAppLifecycleCommands({
  shortcut,
  quitApplication,
}: WorkbenchAppLifecycleCommandsOptions): Command[] {
  return [
    {
      id: "app.quit",
      title: "Quit Application",
      category: "Application",
      shortcut: shortcut("app.quit"),
      isEnabled: () => true,
      run: quitApplication,
    },
  ];
}
