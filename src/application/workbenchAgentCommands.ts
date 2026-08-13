import type { Command } from "./commandRegistry";

interface WorkbenchAgentCommandsOptions {
  toggleAgentMode: Command["run"];
}

export function workbenchAgentCommands({
  toggleAgentMode,
}: WorkbenchAgentCommandsOptions): Command[] {
  return [
    {
      id: "panel.showAgents",
      title: "Toggle Agent Mode",
      category: "Agents",
      isEnabled: (context) => context.hasWorkspace,
      run: toggleAgentMode,
    },
  ];
}
