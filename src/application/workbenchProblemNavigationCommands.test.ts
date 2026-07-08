import { describe, expect, it, vi } from "vitest";
import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";
import { workbenchProblemNavigationCommands } from "./workbenchProblemNavigationCommands";

describe("workbenchProblemNavigationCommands", () => {
  it("returns problem navigation commands in registry order with metadata and shortcuts", () => {
    const shortcut = vi.fn(
      (commandId: KeymapCommandId) => `shortcut:${commandId}`,
    );
    const commands = createCommands({ shortcut });

    expect(
      commands.map(({ id, title, category, shortcut }) => ({
        id,
        title,
        category,
        shortcut,
      })),
    ).toEqual([
      {
        id: "editor.nextProblem",
        title: "Go to Next Problem",
        category: "Editor",
        shortcut: "shortcut:editor.nextProblem",
      },
      {
        id: "editor.previousProblem",
        title: "Go to Previous Problem",
        category: "Editor",
        shortcut: "shortcut:editor.previousProblem",
      },
    ]);
    expect(shortcut).toHaveBeenNthCalledWith(1, "editor.nextProblem");
    expect(shortcut).toHaveBeenNthCalledWith(2, "editor.previousProblem");
    expect(shortcut).toHaveBeenCalledTimes(2);
  });

  it("keeps both commands always available like their keyboard shortcuts", () => {
    expect(createCommands().map(enabled)).toEqual([true, true]);
  });

  it("invokes callbacks without returning navigation internals", () => {
    const nextResult = Promise.resolve(true);
    const previousResult = Promise.resolve(false);
    const goToNextProblem = vi.fn(() => nextResult);
    const goToPreviousProblem = vi.fn(() => previousResult);
    const commands = workbenchProblemNavigationCommands({
      shortcut: (commandId) => commandId,
      goToNextProblem,
      goToPreviousProblem,
    });

    expect(commands[0].run()).toBeUndefined();
    expect(commands[1].run()).toBeUndefined();
    expect(goToNextProblem).toHaveBeenCalledTimes(1);
    expect(goToPreviousProblem).toHaveBeenCalledTimes(1);
  });
});

function createCommands(
  overrides: Partial<Parameters<typeof workbenchProblemNavigationCommands>[0]> = {},
): Command[] {
  return workbenchProblemNavigationCommands({
    shortcut: (commandId) => commandId,
    goToNextProblem: vi.fn(),
    goToPreviousProblem: vi.fn(),
    ...overrides,
  });
}

function enabled(command: Command): boolean {
  return command.isEnabled({
    activeDocumentDirty: false,
    hasActiveDocument: false,
    hasWorkspace: false,
  });
}
