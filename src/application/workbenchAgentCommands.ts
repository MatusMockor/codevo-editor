import type { Command } from "./commandRegistry";

interface WorkbenchAgentCommandsOptions {
  showAgentsPanel: Command["run"];
}

export function workbenchAgentCommands({
  showAgentsPanel,
}: WorkbenchAgentCommandsOptions): Command[] {
  return [
    {
      id: "panel.showAgents",
      title: "Show Agents",
      category: "Agents",
      isEnabled: (context) => context.hasWorkspace,
      run: showAgentsPanel,
    },
  ];
}
