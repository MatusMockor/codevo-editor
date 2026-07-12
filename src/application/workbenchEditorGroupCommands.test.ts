import { describe, expect, it, vi } from "vitest";
import { workbenchEditorGroupCommands } from "./workbenchEditorGroupCommands";

describe("workbenchEditorGroupCommands", () => {
  it("routes split, focus, move and close commands through the group boundary", () => {
    const splitRight = vi.fn();
    const splitDown = vi.fn();
    const focusNextGroup = vi.fn();
    const moveActiveTabToNextGroup = vi.fn();
    const commands = workbenchEditorGroupCommands({
      canCloseGroup: true,
      canMoveBetweenGroups: true,
      closeActiveGroup: vi.fn(),
      focusNextGroup,
      focusPreviousGroup: vi.fn(),
      moveActiveTabToNextGroup,
      moveActiveTabToPreviousGroup: vi.fn(),
      shortcut: (id) => `shortcut:${id}`,
      splitDown,
      splitRight,
    });

    commands.find((command) => command.id === "editor.splitRight")?.run();
    commands.find((command) => command.id === "editor.splitDown")?.run();
    commands.find((command) => command.id === "editor.focusNextGroup")?.run();
    commands.find((command) => command.id === "editor.moveTabToNextGroup")?.run();

    expect(splitRight).toHaveBeenCalledOnce();
    expect(splitDown).toHaveBeenCalledOnce();
    expect(focusNextGroup).toHaveBeenCalledOnce();
    expect(moveActiveTabToNextGroup).toHaveBeenCalledOnce();
    expect(commands.every((command) => command.shortcut === `shortcut:${command.id}`)).toBe(true);
  });

  it("disables group-only actions until a second group exists", () => {
    const commands = workbenchEditorGroupCommands({
      canCloseGroup: false,
      canMoveBetweenGroups: false,
      closeActiveGroup: vi.fn(),
      focusNextGroup: vi.fn(),
      focusPreviousGroup: vi.fn(),
      moveActiveTabToNextGroup: vi.fn(),
      moveActiveTabToPreviousGroup: vi.fn(),
      shortcut: () => "",
      splitDown: vi.fn(),
      splitRight: vi.fn(),
    });

    expect(commands.find((command) => command.id === "editor.splitRight")?.isEnabled?.({} as never)).toBe(true);
    expect(commands.find((command) => command.id === "editor.focusNextGroup")?.isEnabled?.({} as never)).toBe(false);
    expect(commands.find((command) => command.id === "editor.closeGroup")?.isEnabled?.({} as never)).toBe(false);
  });
});
