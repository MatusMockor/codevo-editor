import { describe, expect, it, vi } from "vitest";
import type { KeymapCommandId } from "../domain/keymap";
import type { CommandContext } from "./commandRegistry";
import { workbenchGitWorkflowCommands } from "./workbenchGitWorkflowCommands";

const disabledContext: CommandContext = {
  hasWorkspace: false,
};

const enabledContext: CommandContext = {
  hasWorkspace: true,
};

describe("workbenchGitWorkflowCommands", () => {
  it("returns git workflow commands in registry order with metadata and shortcuts", () => {
    const shortcut = (commandId: KeymapCommandId) => `shortcut:${commandId}`;
    const commands = workbenchGitWorkflowCommands({
      shortcut,
      openGitBranchPanel: vi.fn(),
      createGitBranch: vi.fn(),
      commitGitChanges: vi.fn(),
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
        id: "git.switchBranch",
        title: "Git: Switch Branch",
        category: "Git",
        shortcut: "shortcut:git.switchBranch",
      },
      {
        id: "git.newBranch",
        title: "Git: Open Branches",
        category: "Git",
        shortcut: "shortcut:git.newBranch",
      },
      {
        id: "git.commit",
        title: "Git: Open Commit",
        category: "Git",
        shortcut: "shortcut:git.commit",
      },
    ]);
  });

  it("disables commands without a workspace", () => {
    const commands = createCommands();

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual(
      [false, false, false],
    );
  });

  it("enables commands with a workspace", () => {
    const commands = createCommands();

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([true, true, true]);
  });

  it("invokes the injected callbacks", () => {
    const openGitBranchPanel = vi.fn();
    const createGitBranch = vi.fn();
    const commitGitChanges = vi.fn();
    const commands = workbenchGitWorkflowCommands({
      shortcut: (commandId) => commandId,
      openGitBranchPanel,
      createGitBranch,
      commitGitChanges,
    });

    for (const command of commands) {
      command.run();
    }

    expect(openGitBranchPanel).toHaveBeenCalledTimes(1);
    expect(createGitBranch).toHaveBeenCalledTimes(1);
    expect(commitGitChanges).toHaveBeenCalledTimes(1);
  });

  it("returns undefined while callbacks have pending promises", () => {
    const commands = workbenchGitWorkflowCommands({
      shortcut: (commandId) => commandId,
      openGitBranchPanel: vi.fn(() => new Promise<void>(() => {})),
      createGitBranch: vi.fn(() => new Promise<void>(() => {})),
      commitGitChanges: vi.fn(() => new Promise<void>(() => {})),
    });

    expect(commands.map((command) => command.run())).toEqual([undefined, undefined, undefined]);
  });
});

function createCommands() {
  return workbenchGitWorkflowCommands({
    shortcut: (commandId) => commandId,
    openGitBranchPanel: vi.fn(),
    createGitBranch: vi.fn(),
    commitGitChanges: vi.fn(),
  });
}
