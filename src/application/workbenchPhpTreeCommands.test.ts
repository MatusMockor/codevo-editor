import { describe, expect, it, vi } from "vitest";
import type { IntelligenceMode } from "../domain/workspace";
import type { CommandContext } from "./commandRegistry";
import { workbenchPhpTreeCommands } from "./workbenchPhpTreeCommands";

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

describe("workbenchPhpTreeCommands", () => {
  it("returns php tree commands in registry order with metadata", () => {
    const commands = commandsForMode("fullSmart");

    expect(
      commands.map(({ id, title, category, shortcut }) => ({
        id,
        title,
        category,
        shortcut,
      })),
    ).toEqual([
      {
        id: "phpTree.show",
        title: "Show PHP Tree",
        category: "PHP",
        shortcut: undefined,
      },
      {
        id: "phpTree.refresh",
        title: "Refresh PHP Tree",
        category: "PHP",
        shortcut: undefined,
      },
    ]);
  });

  it("disables commands without a workspace", () => {
    const commands = commandsForMode("fullSmart");

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual(
      [false, false],
    );
  });

  it("disables commands when intelligence mode is basic", () => {
    const commands = commandsForMode("basic");

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      false,
      false,
    ]);
  });

  it.each(["lightSmart", "fullSmart"] satisfies IntelligenceMode[])(
    "enables commands for %s when workspace is present",
    (intelligenceMode) => {
      const commands = commandsForMode(intelligenceMode);

      expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual(
        [true, true],
      );
    },
  );

  it("invokes the injected callbacks", async () => {
    const showPhpTree = vi.fn();
    const refreshPhpTree = vi.fn();
    const commands = workbenchPhpTreeCommands({
      intelligenceMode: "fullSmart",
      showPhpTree,
      refreshPhpTree,
    });

    for (const command of commands) {
      await command.run();
    }

    expect(showPhpTree).toHaveBeenCalledTimes(1);
    expect(refreshPhpTree).toHaveBeenCalledTimes(1);
  });
});

function commandsForMode(intelligenceMode: IntelligenceMode) {
  return workbenchPhpTreeCommands({
    intelligenceMode,
    showPhpTree: vi.fn(),
    refreshPhpTree: vi.fn(),
  });
}
