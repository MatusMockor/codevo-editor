import { describe, expect, it, vi } from "vitest";
import type { KeymapCommandId } from "../domain/keymap";
import type { Command, CommandContext } from "./commandRegistry";
import { workbenchEditorSurfaceCommands } from "./workbenchEditorSurfaceCommands";

describe("workbenchEditorSurfaceCommands", () => {
  it("returns editor surface commands in registry order with metadata and shortcuts", () => {
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
        id: "editor.save",
        title: "Save File",
        category: "Editor",
        shortcut: "shortcut:editor.save",
      },
      {
        id: "editor.closeTab",
        title: "Close",
        category: "Editor",
        shortcut: "shortcut:editor.closeTab",
      },
      {
        id: "editor.rename",
        title: "Rename Symbol",
        category: "Editor",
        shortcut: "shortcut:editor.rename",
      },
      {
        id: "editor.gotoLine",
        title: "Go to Line/Column",
        category: "Editor",
        shortcut: "shortcut:editor.gotoLine",
      },
      {
        id: "editor.formatDocument",
        title: "Format Document",
        category: "Editor",
        shortcut: "shortcut:editor.formatDocument",
      },
      {
        id: "editor.formatSelection",
        title: "Format Selection",
        category: "Editor",
        shortcut: "shortcut:editor.formatSelection",
      },
      {
        id: "editor.quickFix",
        title: "Context Actions",
        category: "Editor",
        shortcut: "shortcut:editor.quickFix",
      },
    ]);
    expect(shortcut).toHaveBeenNthCalledWith(1, "editor.save");
    expect(shortcut).toHaveBeenNthCalledWith(2, "editor.closeTab");
    expect(shortcut).toHaveBeenNthCalledWith(3, "editor.rename");
    expect(shortcut).toHaveBeenNthCalledWith(4, "editor.gotoLine");
    expect(shortcut).toHaveBeenNthCalledWith(5, "editor.formatDocument");
    expect(shortcut).toHaveBeenNthCalledWith(6, "editor.formatSelection");
    expect(shortcut).toHaveBeenNthCalledWith(7, "editor.quickFix");
    expect(shortcut).toHaveBeenCalledTimes(7);
  });

  it("enables save only for dirty active documents", () => {
    const save = commandById("editor.save", createCommands());

    expect(save.isEnabled(context({ hasActiveDocument: false }))).toBe(false);
    expect(
      save.isEnabled(
        context({ hasActiveDocument: true, activeDocumentDirty: false }),
      ),
    ).toBe(false);
    expect(
      save.isEnabled(
        context({ hasActiveDocument: true, activeDocumentDirty: true }),
      ),
    ).toBe(true);
  });

  it("enables close from the injected active-surface state", () => {
    expect(
      commandById(
        "editor.closeTab",
        createCommands({ canCloseActiveSurface: false }),
      ).isEnabled(context({})),
    ).toBe(false);
    expect(
      commandById(
        "editor.closeTab",
        createCommands({ canCloseActiveSurface: true }),
      ).isEnabled(context({})),
    ).toBe(true);
  });

  it("enables editor surface runner commands only with an active document and live runner", () => {
    const withoutRunner = commandById(
      "editor.rename",
      createCommands({ editorSurfaceCommandRunner: null }),
    );
    const withRunner = commandById(
      "editor.rename",
      createCommands({ editorSurfaceCommandRunner: vi.fn() }),
    );

    expect(
      withoutRunner.isEnabled(context({ hasActiveDocument: true })),
    ).toBe(false);
    expect(withRunner.isEnabled(context({ hasActiveDocument: false }))).toBe(
      false,
    );
    expect(withRunner.isEnabled(context({ hasActiveDocument: true }))).toBe(
      true,
    );
  });

  it("invokes the exact injected callbacks and returns their values directly", () => {
    const saveResult = Promise.resolve();
    const closeResult = Promise.resolve();
    const saveActiveDocument = vi.fn(() => saveResult);
    const closeActiveSurface = vi.fn(() => closeResult);
    const editorSurfaceCommandRunner = vi.fn();
    const commands = workbenchEditorSurfaceCommands({
      shortcut: (commandId) => commandId,
      canCloseActiveSurface: true,
      saveActiveDocument,
      closeActiveSurface,
      editorSurfaceCommandRunner,
    });

    expect(commands[0].run()).toBe(saveResult);
    expect(commands[1].run()).toBe(closeResult);
    expect(commandById("editor.quickFix", commands).run()).toBeUndefined();
    expect(saveActiveDocument).toHaveBeenCalledTimes(1);
    expect(closeActiveSurface).toHaveBeenCalledTimes(1);
    expect(editorSurfaceCommandRunner).toHaveBeenCalledWith("editor.quickFix");
  });
});

function createCommands(
  overrides: Partial<Parameters<typeof workbenchEditorSurfaceCommands>[0]> = {},
): Command[] {
  return workbenchEditorSurfaceCommands({
    shortcut: (commandId) => commandId,
    canCloseActiveSurface: true,
    saveActiveDocument: vi.fn(),
    closeActiveSurface: vi.fn(),
    ...overrides,
  });
}

function commandById(id: string, commands: Command[]): Command {
  const match = commands.find((command) => command.id === id);

  if (!match) {
    throw new Error(`Missing command: ${id}`);
  }

  return match;
}

function context({
  hasActiveDocument = false,
  activeDocumentDirty = false,
}: Partial<CommandContext>): CommandContext {
  return {
    activeDocumentDirty,
    hasActiveDocument,
    hasWorkspace: false,
  };
}
