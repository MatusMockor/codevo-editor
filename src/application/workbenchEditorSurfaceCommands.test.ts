import { describe, expect, it, vi } from "vitest";
import {
  editorSurfaceCommandIds,
  type EditorSurfaceCommandRunner,
} from "../domain/editorSurfaceCommand";
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
        id: "editor.reopenClosedTab",
        title: "Reopen Closed Tab",
        category: "Editor",
        shortcut: "shortcut:editor.reopenClosedTab",
      },
      {
        id: "editor.quickDefinition",
        title: "Quick Definition",
        category: "Editor",
        shortcut: "shortcut:editor.quickDefinition",
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
      {
        id: "editor.nextChange",
        title: "Go to Next Change",
        category: "Editor",
        shortcut: "shortcut:editor.nextChange",
      },
      {
        id: "editor.previousChange",
        title: "Go to Previous Change",
        category: "Editor",
        shortcut: "shortcut:editor.previousChange",
      },
    ]);
    expect(shortcut.mock.calls.map(([commandId]) => commandId)).toEqual(
      commands.map(({ id }) => id),
    );
  });

  it("keeps every editor surface command in the production registry", () => {
    const registeredIds = new Set(createCommands().map(({ id }) => id));

    expect(
      editorSurfaceCommandIds.filter((id) => !registeredIds.has(id)),
    ).toEqual([]);
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

  it("enables reopen only when the active workspace stack has an entry", () => {
    expect(
      commandById(
        "editor.reopenClosedTab",
        createCommands({ canReopenClosedDocument: false }),
      ).isEnabled(context({})),
    ).toBe(false);
    expect(
      commandById(
        "editor.reopenClosedTab",
        createCommands({ canReopenClosedDocument: true }),
      ).isEnabled(context({})),
    ).toBe(true);
  });

  it.each(editorSurfaceCommandIds)(
    "enables %s only with an active document and live runner",
    (commandId) => {
      const withoutRunner = commandById(
        commandId,
        createCommands({ editorSurfaceCommandRunner: null }),
      );
      const withRunner = commandById(
        commandId,
        createCommands({
          editorSurfaceCommandRunner: vi.fn() as EditorSurfaceCommandRunner,
        }),
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
    },
  );

  it("uses the live runner capability without bypassing the registry", () => {
    const editorSurfaceCommandRunner = vi.fn() as EditorSurfaceCommandRunner;
    editorSurfaceCommandRunner.isEnabled = vi.fn(
      (commandId) => commandId !== "editor.nextChange",
    );
    const commands = createCommands({ editorSurfaceCommandRunner });

    expect(
      commandById("editor.nextChange", commands).isEnabled(
        context({ hasActiveDocument: true }),
      ),
    ).toBe(false);
    expect(
      commandById("editor.previousChange", commands).isEnabled(
        context({ hasActiveDocument: true }),
      ),
    ).toBe(true);
    expect(editorSurfaceCommandRunner.isEnabled).toHaveBeenCalledWith(
      "editor.nextChange",
    );
    expect(editorSurfaceCommandRunner.isEnabled).toHaveBeenCalledWith(
      "editor.previousChange",
    );
  });

  it("invokes the exact injected callbacks and returns their values directly", () => {
    const saveResult = Promise.resolve();
    const closeResult = Promise.resolve();
    const saveActiveDocument = vi.fn(() => saveResult);
    const closeActiveSurface = vi.fn(() => closeResult);
    const reopenClosedDocument = vi.fn(() => closeResult);
    const editorSurfaceCommandRunner = vi.fn();
    const commands = workbenchEditorSurfaceCommands({
      shortcut: (commandId) => commandId,
      canCloseActiveSurface: true,
      saveActiveDocument,
      closeActiveSurface,
      canReopenClosedDocument: true,
      reopenClosedDocument,
      editorSurfaceCommandRunner,
    });

    expect(commands[0].run()).toBe(saveResult);
    expect(commands[1].run()).toBe(closeResult);
    expect(commands[2].run()).toBe(closeResult);
    expect(commandById("editor.quickFix", commands).run()).toBeUndefined();
    expect(saveActiveDocument).toHaveBeenCalledTimes(1);
    expect(closeActiveSurface).toHaveBeenCalledTimes(1);
    expect(reopenClosedDocument).toHaveBeenCalledTimes(1);
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
    canReopenClosedDocument: false,
    reopenClosedDocument: vi.fn(),
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
