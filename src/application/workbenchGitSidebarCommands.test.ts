import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "./commandRegistry";
import { workbenchGitSidebarCommands } from "./workbenchGitSidebarCommands";

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

describe("workbenchGitSidebarCommands", () => {
  it("returns git sidebar commands in registry order with metadata", () => {
    const commands = workbenchGitSidebarCommands({
      showGitSidebar: vi.fn(),
      refreshGitStatus: vi.fn(),
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
        id: "git.show",
        title: "Show Git Changes",
        category: "Git",
        shortcut: undefined,
      },
      {
        id: "git.refresh",
        title: "Refresh Git Changes",
        category: "Git",
        shortcut: undefined,
      },
    ]);
  });

  it("disables commands without a workspace", () => {
    const commands = workbenchGitSidebarCommands({
      showGitSidebar: vi.fn(),
      refreshGitStatus: vi.fn(),
    });

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual(
      [false, false],
    );
  });

  it("enables commands with a workspace", () => {
    const commands = workbenchGitSidebarCommands({
      showGitSidebar: vi.fn(),
      refreshGitStatus: vi.fn(),
    });

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      true,
      true,
    ]);
  });

  it("invokes the injected callbacks", async () => {
    const showGitSidebar = vi.fn();
    const refreshGitStatus = vi.fn();
    const commands = workbenchGitSidebarCommands({
      showGitSidebar,
      refreshGitStatus,
    });

    for (const command of commands) {
      await command.run();
    }

    expect(showGitSidebar).toHaveBeenCalledTimes(1);
    expect(refreshGitStatus).toHaveBeenCalledTimes(1);
  });
});
