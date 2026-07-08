import type { Command } from "./commandRegistry";

interface WorkbenchGitSidebarCommandsOptions {
  showGitSidebar: Command["run"];
  refreshGitStatus: Command["run"];
}

export function workbenchGitSidebarCommands({
  showGitSidebar,
  refreshGitStatus,
}: WorkbenchGitSidebarCommandsOptions): Command[] {
  return [
    {
      id: "git.show",
      title: "Show Git Changes",
      category: "Git",
      isEnabled: (context) => context.hasWorkspace,
      run: showGitSidebar,
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
