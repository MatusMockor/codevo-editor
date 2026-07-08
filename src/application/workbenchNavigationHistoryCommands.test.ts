import { describe, expect, it, vi } from "vitest";
import type { KeymapCommandId } from "../domain/keymap";
import type { Command, CommandContext } from "./commandRegistry";
import { workbenchNavigationHistoryCommands } from "./workbenchNavigationHistoryCommands";

describe("workbenchNavigationHistoryCommands", () => {
  it("returns navigation commands in registry order with metadata and shortcuts", () => {
    const shortcut = vi.fn(
      (commandId: KeymapCommandId) => `shortcut:${commandId}`,
    );
    const commands = workbenchNavigationHistoryCommands({
      shortcut,
      canNavigateBackward: true,
      canNavigateForward: true,
      navigateBackward: vi.fn(),
      navigateForward: vi.fn(),
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
        id: "navigation.back",
        title: "Go Back",
        category: "Navigation",
        shortcut: "shortcut:navigation.back",
      },
      {
        id: "navigation.forward",
        title: "Go Forward",
        category: "Navigation",
        shortcut: "shortcut:navigation.forward",
      },
    ]);
    expect(shortcut).toHaveBeenNthCalledWith(1, "navigation.back");
    expect(shortcut).toHaveBeenNthCalledWith(2, "navigation.forward");
    expect(shortcut).toHaveBeenCalledTimes(2);
  });

  it("enables each command from the injected navigation state", () => {
    expect(enabledStates({ canNavigateBackward: false, canNavigateForward: false }))
      .toEqual([false, false]);
    expect(enabledStates({ canNavigateBackward: true, canNavigateForward: false }))
      .toEqual([true, false]);
    expect(enabledStates({ canNavigateBackward: false, canNavigateForward: true }))
      .toEqual([false, true]);
    expect(enabledStates({ canNavigateBackward: true, canNavigateForward: true }))
      .toEqual([true, true]);
  });

  it("invokes the exact injected callbacks and returns their values directly", () => {
    const backResult = Promise.resolve();
    const forwardResult = Promise.resolve();
    const navigateBackward = vi.fn(() => backResult);
    const navigateForward = vi.fn(() => forwardResult);
    const commands = workbenchNavigationHistoryCommands({
      shortcut: (commandId) => commandId,
      canNavigateBackward: true,
      canNavigateForward: true,
      navigateBackward,
      navigateForward,
    });

    expect(commands[0].run()).toBe(backResult);
    expect(commands[1].run()).toBe(forwardResult);
    expect(navigateBackward).toHaveBeenCalledTimes(1);
    expect(navigateForward).toHaveBeenCalledTimes(1);
  });
});

function enabledStates({
  canNavigateBackward,
  canNavigateForward,
}: {
  canNavigateBackward: boolean;
  canNavigateForward: boolean;
}): boolean[] {
  return createCommands({
    canNavigateBackward,
    canNavigateForward,
  }).map((command) => command.isEnabled(commandContext));
}

function createCommands({
  canNavigateBackward,
  canNavigateForward,
}: {
  canNavigateBackward: boolean;
  canNavigateForward: boolean;
}): Command[] {
  return workbenchNavigationHistoryCommands({
    shortcut: (commandId) => commandId,
    canNavigateBackward,
    canNavigateForward,
    navigateBackward: vi.fn(),
    navigateForward: vi.fn(),
  });
}

const commandContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: false,
};
