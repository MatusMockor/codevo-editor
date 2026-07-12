import { describe, expect, it, vi } from "vitest";
import type { KeymapCommandId } from "../domain/keymap";
import type { CommandContext } from "./commandRegistry";
import { workbenchGitWorkflowCommands } from "./workbenchGitWorkflowCommands";

const disabledContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: false,
};

const enabledContext: CommandContext = {
  activeDocumentDirty: true,
  hasActiveDocument: true,
  hasWorkspace: true,
};

describe("workbenchGitWorkflowCommands", () => {
  it("returns git workflow commands in registry order with metadata and shortcuts", () => {
    const shortcut = (commandId: KeymapCommandId) => `shortcut:${commandId}`;
    const commands = workbenchGitWorkflowCommands({
      shortcut,
      openGitStashPanel: vi.fn(),
      openGitBranchPanel: vi.fn(),
      createGitBranch: vi.fn(),
      commitGitChanges: vi.fn(),
      revertSelectedGitCommit: vi.fn(),
    });

    expect(
      commands.map(({ id, title, category, shortcut }) => ({
        id,
        title,
        category,
        shortcut,
      })),
    ).toEqual([
      {
        id: "git.stashChanges",
        title: "Git: Stash Changes",
        category: "Git",
        shortcut: "shortcut:git.stashChanges",
      },
      {
        id: "git.showStashes",
        title: "Git: Show Stashes",
        category: "Git",
        shortcut: "shortcut:git.showStashes",
      },
      {
        id: "git.switchBranch",
        title: "Git: Switch Branch",
        category: "Git",
        shortcut: "shortcut:git.switchBranch",
      },
      {
        id: "git.newBranch",
        title: "Git: New Branch",
        category: "Git",
        shortcut: "shortcut:git.newBranch",
      },
      {
        id: "git.revertCommit",
        title: "Git: Revert Selected Commit",
        category: "Git",
        shortcut: undefined,
      },
      {
        id: "git.commit",
        title: "Git: Commit",
        category: "Git",
        shortcut: "shortcut:git.commit",
      },
    ]);
  });

  it("disables commands without a workspace", () => {
    const commands = createCommands();

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual(
      [false, false, false, false, false, false],
    );
  });

  it("enables commands with a workspace", () => {
    const commands = createCommands();

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("invokes the injected callbacks", () => {
    const openGitStashPanel = vi.fn();
    const openGitBranchPanel = vi.fn();
    const createGitBranch = vi.fn();
    const commitGitChanges = vi.fn();
    const revertSelectedGitCommit = vi.fn();
    const commands = workbenchGitWorkflowCommands({
      shortcut: (commandId) => commandId,
      openGitStashPanel,
      openGitBranchPanel,
      createGitBranch,
      commitGitChanges,
      revertSelectedGitCommit,
    });

    for (const command of commands) {
      command.run();
    }

    expect(openGitStashPanel).toHaveBeenCalledTimes(2);
    expect(openGitBranchPanel).toHaveBeenCalledTimes(1);
    expect(createGitBranch).toHaveBeenCalledTimes(1);
    expect(commitGitChanges).toHaveBeenCalledTimes(1);
    expect(revertSelectedGitCommit).toHaveBeenCalledTimes(1);
  });

  it("returns undefined while callbacks have pending promises", () => {
    const commands = workbenchGitWorkflowCommands({
      shortcut: (commandId) => commandId,
      openGitStashPanel: vi.fn(() => new Promise<void>(() => {})),
      openGitBranchPanel: vi.fn(() => new Promise<void>(() => {})),
      createGitBranch: vi.fn(() => new Promise<void>(() => {})),
      commitGitChanges: vi.fn(() => new Promise<void>(() => {})),
      revertSelectedGitCommit: vi.fn(() => new Promise<void>(() => {})),
    });

    expect(commands.map((command) => command.run())).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

function createCommands() {
  return workbenchGitWorkflowCommands({
    shortcut: (commandId) => commandId,
    openGitStashPanel: vi.fn(),
    openGitBranchPanel: vi.fn(),
    createGitBranch: vi.fn(),
    commitGitChanges: vi.fn(),
    revertSelectedGitCommit: vi.fn(),
  });
}
