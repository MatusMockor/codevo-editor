import type { Command } from "./commandRegistry";
import type { AgentWorkbenchLayoutCommandPort } from "./workbenchAgentCommands";

interface WorkbenchGitSidebarCommandsOptions {
  agentLayout: AgentWorkbenchLayoutCommandPort;
  refreshGitStatus: Command["run"];
}

export function workbenchGitSidebarCommands({
  agentLayout,
  refreshGitStatus,
}: WorkbenchGitSidebarCommandsOptions): Command[] {
  return [
    {
      id: "git.show",
      title: "Show Git Changes",
      category: "Git",
      isEnabled: (context) => context.hasWorkspace,
      run: () => agentLayout.dispatch({ kind: "openSurface", surface: "git" }),
    },
    {
      id: "git.refresh",
      title: "Refresh Git Changes",
      category: "Git",
      isEnabled: (context) => context.hasWorkspace,
      run: refreshGitStatus,
    },
  ];
}
