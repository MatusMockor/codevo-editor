import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchGitWorkflowCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  openGitStashPanel: Command["run"];
  openGitBranchPanel: Command["run"];
  createGitBranch: Command["run"];
  commitGitChanges: Command["run"];
  revertSelectedGitCommit: Command["run"];
  cherryPickSelectedGitCommit: Command["run"];
  rewordSelectedGitCommit: Command["run"];
  canRewordSelectedGitCommit(): boolean;
}

export function workbenchGitWorkflowCommands({
  shortcut,
  openGitStashPanel,
  openGitBranchPanel,
  createGitBranch,
  commitGitChanges,
  revertSelectedGitCommit,
  cherryPickSelectedGitCommit,
  rewordSelectedGitCommit,
  canRewordSelectedGitCommit,
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
      id: "git.revertCommit",
      title: "Git: Revert Selected Commit",
      category: "Git",
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void revertSelectedGitCommit();
      },
    },
    {
      id: "git.cherryPickCommit",
      title: "Git: Cherry-Pick Selected Commit",
      category: "Git",
      isEnabled: (context) => context.hasWorkspace,
      run: () => {
        void cherryPickSelectedGitCommit();
      },
    },
    {
      id: "git.rewordCommit",
      title: "Git: Reword Selected Commit",
      category: "Git",
      shortcut: shortcut("git.rewordCommit"),
      isEnabled: (context) =>
        context.hasWorkspace && canRewordSelectedGitCommit(),
      run: () => {
        void rewordSelectedGitCommit();
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
