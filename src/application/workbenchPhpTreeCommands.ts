import { shouldIndexWorkspace } from "../domain/intelligence";
import type { IntelligenceMode } from "../domain/workspace";
import type { Command } from "./commandRegistry";

interface WorkbenchPhpTreeCommandsOptions {
  intelligenceMode: IntelligenceMode;
  showPhpTree: Command["run"];
  refreshPhpTree: Command["run"];
}

export function workbenchPhpTreeCommands({
  intelligenceMode,
  showPhpTree,
  refreshPhpTree,
}: WorkbenchPhpTreeCommandsOptions): Command[] {
  return [
    {
      id: "phpTree.show",
      title: "Show PHP Tree",
      category: "PHP",
      isEnabled: (context) =>
        context.hasWorkspace && shouldIndexWorkspace(intelligenceMode),
      run: showPhpTree,
    },
    {
      id: "phpTree.refresh",
      title: "Refresh PHP Tree",
      category: "PHP",
      isEnabled: (context) =>
        context.hasWorkspace && shouldIndexWorkspace(intelligenceMode),
      run: refreshPhpTree,
    },
  ];
}
