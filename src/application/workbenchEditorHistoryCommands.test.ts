import { describe, expect, it, vi } from "vitest";
import type { KeymapCommandId } from "../domain/keymap";
import type { CommandContext } from "./commandRegistry";
import { workbenchEditorHistoryCommands } from "./workbenchEditorHistoryCommands";

describe("workbenchEditorHistoryCommands", () => {
  it("returns editor history commands in registry order with metadata and shortcuts", () => {
    const shortcut = vi.fn(
      (commandId: KeymapCommandId) => `shortcut:${commandId}`,
    );
    const commands = workbenchEditorHistoryCommands({
      shortcut,
      toggleGitBlame: vi.fn(),
      openFileHistory: vi.fn(),
      openLocalHistory: vi.fn(),
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
        id: "editor.toggleGitBlame",
        title: "Annotate with Git Blame",
        category: "Editor",
        shortcut: "shortcut:editor.toggleGitBlame",
      },
      {
        id: "editor.showFileHistory",
        title: "Show File History",
        category: "Editor",
        shortcut: "shortcut:editor.showFileHistory",
      },
      {
        id: "editor.showLocalHistory",
        title: "Local History: Show History",
        category: "Editor",
        shortcut: "shortcut:editor.showLocalHistory",
      },
    ]);
    expect(shortcut).toHaveBeenNthCalledWith(1, "editor.toggleGitBlame");
    expect(shortcut).toHaveBeenNthCalledWith(2, "editor.showFileHistory");
    expect(shortcut).toHaveBeenNthCalledWith(3, "editor.showLocalHistory");
    expect(shortcut).toHaveBeenCalledTimes(3);
  });

  it("enables commands only with a workspace and active document", () => {
    const commands = createCommands();
    const contexts: CommandContext[] = [
      {
        activeDocumentDirty: false,
        hasActiveDocument: false,
        hasWorkspace: false,
      },
      {
        activeDocumentDirty: false,
        hasActiveDocument: true,
        hasWorkspace: false,
      },
      {
        activeDocumentDirty: false,
        hasActiveDocument: false,
        hasWorkspace: true,
      },
      {
        activeDocumentDirty: false,
        hasActiveDocument: true,
        hasWorkspace: true,
      },
    ];

    expect(
      contexts.map((context) =>
        commands.map((command) => command.isEnabled(context)),
      ),
    ).toEqual([
      [false, false, false],
      [false, false, false],
      [false, false, false],
      [true, true, true],
    ]);
  });

  it("invokes the injected callbacks", () => {
    const toggleGitBlame = vi.fn();
    const openFileHistory = vi.fn();
    const openLocalHistory = vi.fn();
    const commands = workbenchEditorHistoryCommands({
      shortcut: (commandId) => commandId,
      toggleGitBlame,
      openFileHistory,
      openLocalHistory,
    });

    for (const command of commands) {
      command.run();
    }

    expect(toggleGitBlame).toHaveBeenCalledTimes(1);
    expect(openFileHistory).toHaveBeenCalledTimes(1);
    expect(openLocalHistory).toHaveBeenCalledTimes(1);
  });

  it("returns undefined while async history callbacks have pending promises", () => {
    const commands = workbenchEditorHistoryCommands({
      shortcut: (commandId) => commandId,
      toggleGitBlame: vi.fn(),
      openFileHistory: vi.fn(() => new Promise<void>(() => {})),
      openLocalHistory: vi.fn(() => new Promise<void>(() => {})),
    });

    expect(commands[1].run()).toBeUndefined();
    expect(commands[2].run()).toBeUndefined();
  });
});

function createCommands() {
  return workbenchEditorHistoryCommands({
    shortcut: (commandId) => commandId,
    toggleGitBlame: vi.fn(),
    openFileHistory: vi.fn(),
    openLocalHistory: vi.fn(),
  });
}
