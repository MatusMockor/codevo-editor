import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "./commandRegistry";
import { workbenchAppLifecycleCommands } from "./workbenchAppLifecycleCommands";

const noWorkspaceContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: false,
};

const workspaceContext: CommandContext = {
  activeDocumentDirty: true,
  hasActiveDocument: true,
  hasWorkspace: true,
};

describe("workbenchAppLifecycleCommands", () => {
  it("registers the quit command with metadata and keymap shortcut", () => {
    const commands = workbenchAppLifecycleCommands({
      shortcut: (commandId) => `shortcut:${commandId}`,
      quitApplication: vi.fn(),
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
        id: "app.quit",
        title: "Quit Application",
        category: "Application",
        shortcut: "shortcut:app.quit",
      },
    ]);
  });

  it("keeps quit enabled even without a workspace", () => {
    const commands = workbenchAppLifecycleCommands({
      shortcut: () => "",
      quitApplication: vi.fn(),
    });

    expect(
      commands.map((command) => command.isEnabled(noWorkspaceContext)),
    ).toEqual([true]);
    expect(
      commands.map((command) => command.isEnabled(workspaceContext)),
    ).toEqual([true]);
  });

  it("invokes the quit callback", async () => {
    const quitApplication = vi.fn();
    const commands = workbenchAppLifecycleCommands({
      shortcut: () => "",
      quitApplication,
    });

    for (const command of commands) {
      await command.run();
    }

    expect(quitApplication).toHaveBeenCalledTimes(1);
  });
});
