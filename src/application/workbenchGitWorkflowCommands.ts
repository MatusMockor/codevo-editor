import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchGitWorkflowCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  openGitBranchPanel: Command["run"];
  createGitBranch: Command["run"];
  commitGitChanges: Command["run"];
}

export function workbenchGitWorkflowCommands({
  shortcut,
  openGitBranchPanel,
  createGitBranch,
  commitGitChanges,
}: WorkbenchGitWorkflowCommandsOptions): Command[] {
  return [
    {
      id: "git.switchBranch",
      title: "Git: Switch Branch",
      category: "Git",
      shortcut: shortcut("git.switchBranch"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void openGitBranchPanel();
      },
    },
    {
      id: "git.newBranch",
      title: "Git: Open Branches",
      category: "Git",
      shortcut: shortcut("git.newBranch"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void createGitBranch();
      },
    },
    {
      id: "git.commit",
      title: "Git: Open Commit",
      category: "Git",
      shortcut: shortcut("git.commit"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void commitGitChanges();
      },
    },
  ];
}
