import { describe, expect, it, vi } from "vitest";
import { CommandRegistry, type CommandContext } from "./commandRegistry";
import { workbenchEditMenuCommands } from "./workbenchEditMenuCommands";

const noDocumentContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: true,
};

const activeDocumentContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: true,
  hasWorkspace: true,
};

describe("workbenchEditMenuCommands", () => {
  it("registers the edit menu commands with metadata and shortcuts", () => {
    const registry = new CommandRegistry();

    workbenchEditMenuCommands({
      editorMenuCommandRunner: vi.fn(),
      platform: "windows",
    }).forEach((command) => registry.register(command));

    expect(
      registry.list().map(({ id, title, category, shortcut }) => ({
        id,
        title,
        category,
        shortcut,
      })),
    ).toEqual([
      { id: "edit.copy", title: "Copy", category: "Editor", shortcut: "Ctrl+C" },
      { id: "edit.cut", title: "Cut", category: "Editor", shortcut: "Ctrl+X" },
      { id: "edit.paste", title: "Paste", category: "Editor", shortcut: "Ctrl+V" },
      { id: "edit.redo", title: "Redo", category: "Editor", shortcut: "Ctrl+Y" },
      {
        id: "edit.selectAll",
        title: "Select All",
        category: "Editor",
        shortcut: "Ctrl+A",
      },
      { id: "edit.undo", title: "Undo", category: "Editor", shortcut: "Ctrl+Z" },
    ]);
  });

  it("shows Cmd shortcuts on mac", () => {
    const registry = new CommandRegistry();

    workbenchEditMenuCommands({
      editorMenuCommandRunner: vi.fn(),
      platform: "mac",
    }).forEach((command) => registry.register(command));

    expect(
      registry.list().map(({ id, shortcut }) => ({ id, shortcut })),
    ).toEqual([
      { id: "edit.copy", shortcut: "Cmd+C" },
      { id: "edit.cut", shortcut: "Cmd+X" },
      { id: "edit.paste", shortcut: "Cmd+V" },
      { id: "edit.redo", shortcut: "Cmd+Y" },
      { id: "edit.selectAll", shortcut: "Cmd+A" },
      { id: "edit.undo", shortcut: "Cmd+Z" },
    ]);
  });

  it("runs the injected runner with the matching editor menu command", async () => {
    const runner = vi.fn();
    const registry = new CommandRegistry();

    workbenchEditMenuCommands({
      editorMenuCommandRunner: runner,
    }).forEach((command) => registry.register(command));

    await registry.get("edit.undo")?.run();
    await registry.get("edit.redo")?.run();
    await registry.get("edit.cut")?.run();
    await registry.get("edit.copy")?.run();
    await registry.get("edit.paste")?.run();
    await registry.get("edit.selectAll")?.run();

    expect(runner.mock.calls).toEqual([
      ["undo"],
      ["redo"],
      ["cut"],
      ["copy"],
      ["paste"],
      ["selectAll"],
    ]);
  });

  it("disables every command without an active document", () => {
    const commands = workbenchEditMenuCommands({
      editorMenuCommandRunner: vi.fn(),
    });

    expect(
      commands.map((command) => command.isEnabled(noDocumentContext)),
    ).toEqual([false, false, false, false, false, false]);
    expect(
      commands.map((command) => command.isEnabled(activeDocumentContext)),
    ).toEqual([true, true, true, true, true, true]);
  });

  it("disables every command without an editor menu runner", () => {
    const commands = workbenchEditMenuCommands({});

    expect(
      commands.map((command) => command.isEnabled(activeDocumentContext)),
    ).toEqual([false, false, false, false, false, false]);

    for (const command of commands) {
      expect(() => command.run()).not.toThrow();
    }
  });
});
