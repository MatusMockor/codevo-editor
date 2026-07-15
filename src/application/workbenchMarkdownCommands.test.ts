import { describe, expect, it, vi } from "vitest";
import { defaultKeymapSettings } from "../domain/keymap";
import {
  CommandRegistry,
  executeCommand,
  type CommandContext,
  type CommandExecutionRunner,
} from "./commandRegistry";
import { workbenchMarkdownCommands } from "./workbenchMarkdownCommands";
import { dispatchWorkbenchShortcutCommand } from "./workbenchShortcutCommandDispatcher";

const commandContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: true,
  hasWorkspace: true,
};

describe("workbenchMarkdownCommands", () => {
  it("exposes the Markdown preview command only for an active Markdown document", () => {
    const openMarkdownPreview = vi.fn();
    const [command] = workbenchMarkdownCommands({
      isActiveDocumentMarkdown: true,
      openMarkdownPreview,
      shortcut: (commandId) => `shortcut:${commandId}`,
    });

    expect(command).toMatchObject({
      category: "Markdown",
      id: "markdown.openPreview",
      shortcut: "shortcut:markdown.openPreview",
      title: "Markdown: Open Preview",
    });
    expect(
      command?.isEnabled({
        activeDocumentDirty: false,
        hasActiveDocument: true,
        hasWorkspace: true,
      }),
    ).toBe(true);

    command?.run();
    expect(openMarkdownPreview).toHaveBeenCalledOnce();
  });

  it("disables the command for non-Markdown documents", () => {
    const [command] = workbenchMarkdownCommands({
      isActiveDocumentMarkdown: false,
      openMarkdownPreview: vi.fn(),
      shortcut: () => "Cmd+Shift+V",
    });

    expect(
      command?.isEnabled({
        activeDocumentDirty: false,
        hasActiveDocument: true,
        hasWorkspace: true,
      }),
    ).toBe(false);
  });

  it("opens the preview through the keymap dispatch path", () => {
    const openMarkdownPreview = vi.fn();
    const [command] = workbenchMarkdownCommands({
      isActiveDocumentMarkdown: true,
      openMarkdownPreview,
      shortcut: () => "Cmd+Shift+V",
    });
    if (!command) {
      throw new Error("Expected Markdown preview command");
    }

    const commandRegistry = new CommandRegistry();
    commandRegistry.register(command);
    const runCommand: CommandExecutionRunner = (
      commandId,
      context = commandContext,
    ) => executeCommand(commandRegistry, commandId, context);
    const event = {
      altKey: false,
      ctrlKey: false,
      key: "v",
      metaKey: true,
      preventDefault: vi.fn(),
      shiftKey: true,
    } as unknown as KeyboardEvent;

    const handled = dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["markdown.openPreview"],
      commandRegistry,
      event,
      keymap: defaultKeymapSettings("mac"),
      runCommand,
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(openMarkdownPreview).toHaveBeenCalledOnce();
  });
});
