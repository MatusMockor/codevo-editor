import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchGitWorkflowCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  openGitStashPanel: Command["run"];
  openGitBranchPanel: Command["run"];
  createGitBranch: Command["run"];
  commitGitChanges: Command["run"];
}

export function workbenchGitWorkflowCommands({
  shortcut,
  openGitStashPanel,
  openGitBranchPanel,
  createGitBranch,
  commitGitChanges,
}: WorkbenchGitWorkflowCommandsOptions): Command[] {
  return [
    {
      id: "git.stashChanges",
      title: "Git: Stash Changes",
      category: "Git",
      shortcut: shortcut("git.stashChanges"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void openGitStashPanel();
      },
    },
    {
      id: "git.showStashes",
      title: "Git: Show Stashes",
      category: "Git",
      shortcut: shortcut("git.showStashes"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void openGitStashPanel();
      },
    },
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
      title: "Git: New Branch",
      category: "Git",
      shortcut: shortcut("git.newBranch"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void createGitBranch();
      },
    },
    {
      id: "git.commit",
      title: "Git: Commit",
      category: "Git",
      shortcut: shortcut("git.commit"),
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void commitGitChanges();
      },
    },
  ];
}
