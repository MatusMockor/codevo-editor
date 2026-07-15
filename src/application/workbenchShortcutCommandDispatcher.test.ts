import { describe, expect, it, vi } from "vitest";
import { defaultKeymapSettings } from "../domain/keymap";
import {
  CommandRegistry,
  executeCommand,
  type Command,
  type CommandContext,
  type CommandExecutionRunner,
} from "./commandRegistry";
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
    const commandRegistry = registry({
      "workbench.openSettings": command({
        id: "workbench.openSettings",
        run,
      }),
    });

    const handled = dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["workbench.openSettings"],
      commandRegistry,
      event,
      keymap: {
        ...defaultKeymapSettings("mac"),
        "panel.toggleTodo": "Cmd+J",
      },
      runCommand: registryRunner(commandRegistry),
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("consumes a matching disabled command without running it", () => {
    const run = vi.fn();
    const event = keyboardEvent({ key: "t", metaKey: true, shiftKey: true });
    const commandRegistry = registry({
      "panel.toggleTodo": command({
        enabled: false,
        id: "panel.toggleTodo",
        run,
      }),
    });

    const handled = dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["panel.toggleTodo"],
      commandRegistry,
      event,
      keymap: defaultKeymapSettings("mac"),
      runCommand: registryRunner(commandRegistry),
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["disabled", "missing"] as const)(
    "consumes a registered shortcut when the runner reports %s",
    (outcome) => {
      const event = keyboardEvent({ key: ",", metaKey: true });
      const run = vi.fn();
      const runCommand = vi.fn(() => outcome);

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
        runCommand,
      });

      expect(handled).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(runCommand).toHaveBeenCalledWith(
        "workbench.openSettings",
        commandContext,
      );
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("consumes a registered shortcut before a runner failure propagates", () => {
    const event = keyboardEvent({ key: ",", metaKey: true });
    const runCommand = vi.fn(() => {
      throw new Error("command failed");
    });

    expect(() =>
      dispatchWorkbenchShortcutCommand({
        commandContext,
        commandIds: ["workbench.openSettings"],
        commandRegistry: registry({
          "workbench.openSettings": command({
            id: "workbench.openSettings",
            run: vi.fn(),
          }),
        }),
        event,
        keymap: defaultKeymapSettings("mac"),
        runCommand,
      }),
    ).toThrow("command failed");
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("does not consume unmatched shortcuts", () => {
    const run = vi.fn();
    const event = keyboardEvent({ key: "x", metaKey: true });
    const commandRegistry = registry({
      "workbench.openSettings": command({
        id: "workbench.openSettings",
        run,
      }),
    });

    const handled = dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["workbench.openSettings"],
      commandRegistry,
      event,
      keymap: defaultKeymapSettings("mac"),
      runCommand: registryRunner(commandRegistry),
    });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves an unregistered Monaco-only keymap shortcut untouched", () => {
    const event = keyboardEvent({ altKey: true, key: "F5" });
    const runCommand = vi.fn();

    const handled = dispatchWorkbenchShortcutCommand({
      commandContext,
      commandRegistry: registry({}),
      event,
      keymap: defaultKeymapSettings("mac"),
      runCommand,
    });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
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
    "routes registered $commandId from the canonical keymap",
    ({ commandId, event: eventOptions }) => {
      const run = vi.fn();
      const event = keyboardEvent(eventOptions);
      const commandRegistry = registry({
        [commandId]: command({ id: commandId, run }),
      });

      const handled = dispatchWorkbenchShortcutCommand({
        commandContext,
        commandRegistry,
        event,
        keymap: defaultKeymapSettings("mac"),
        runCommand: registryRunner(commandRegistry),
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
  const commandRegistry = new CommandRegistry();
  Object.values(commands).forEach((registeredCommand) => {
    commandRegistry.register(registeredCommand);
  });
  return commandRegistry;
}

function registryRunner(commandRegistry: CommandRegistry): CommandExecutionRunner {
  return (commandId, context = commandContext) =>
    executeCommand(commandRegistry, commandId, context);
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
