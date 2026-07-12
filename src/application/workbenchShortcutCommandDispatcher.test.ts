import { describe, expect, it, vi } from "vitest";
import { defaultKeymapSettings } from "../domain/keymap";
import type { Command, CommandContext } from "./commandRegistry";
import { dispatchWorkbenchShortcutCommand } from "./workbenchShortcutCommandDispatcher";

const commandContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: true,
};

describe("dispatchWorkbenchShortcutCommand", () => {
  it("runs the enabled command whose shortcut matches first", () => {
    const run = vi.fn();
    const event = keyboardEvent({ key: ",", metaKey: true });

    const handled = dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["workbench.openSettings"],
      commandRegistry: registry({
        "workbench.openSettings": command({
          id: "workbench.openSettings",
          run,
        }),
      }),
      event,
      keymap: {
        ...defaultKeymapSettings("mac"),
        "panel.toggleTodo": "Cmd+J",
      },
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("consumes a matching disabled command without running it", () => {
    const run = vi.fn();
    const event = keyboardEvent({ key: "t", metaKey: true, shiftKey: true });

    const handled = dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["panel.toggleTodo"],
      commandRegistry: registry({
        "panel.toggleTodo": command({
          enabled: false,
          id: "panel.toggleTodo",
          run,
        }),
      }),
      event,
      keymap: defaultKeymapSettings("mac"),
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not consume unmatched shortcuts", () => {
    const run = vi.fn();
    const event = keyboardEvent({ key: "x", metaKey: true });

    const handled = dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["workbench.openSettings"],
      commandRegistry: registry({
        "workbench.openSettings": command({
          id: "workbench.openSettings",
          run,
        }),
      }),
      event,
      keymap: defaultKeymapSettings("mac"),
    });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("still consumes a known shortcut when the command is absent", () => {
    const event = keyboardEvent({ key: ",", metaKey: true });

    const handled = dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["workbench.openSettings"],
      commandRegistry: registry({}),
      event,
      keymap: defaultKeymapSettings("mac"),
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      commandId: "workspace.nextTab" as const,
      event: { altKey: true, key: "ArrowRight", metaKey: true },
    },
    {
      commandId: "workspace.previousTab" as const,
      event: { altKey: true, key: "ArrowLeft", metaKey: true },
    },
  ])(
    "routes $commandId without requiring it in the caller command list",
    ({ commandId, event: eventOptions }) => {
      const run = vi.fn();
      const event = keyboardEvent(eventOptions);

      const handled = dispatchWorkbenchShortcutCommand({
        commandContext,
        commandIds: [],
        commandRegistry: registry({
          [commandId]: command({ id: commandId, run }),
        }),
        event,
        keymap: defaultKeymapSettings("mac"),
      });

      expect(handled).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledTimes(1);
    },
  );
});

function command({
  enabled = true,
  id,
  run,
}: {
  enabled?: boolean;
  id: string;
  run: Command["run"];
}): Command {
  return {
    category: "Test",
    id,
    isEnabled: () => enabled,
    run,
    title: id,
  };
}

function registry(commands: Record<string, Command>) {
  return {
    get: (id: string) => commands[id],
  };
}

function keyboardEvent({
  altKey = false,
  ctrlKey = false,
  key,
  metaKey = false,
  shiftKey = false,
}: {
  altKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  return {
    altKey,
    ctrlKey,
    key,
    metaKey,
    preventDefault: vi.fn(),
    shiftKey,
  } as unknown as KeyboardEvent;
}
