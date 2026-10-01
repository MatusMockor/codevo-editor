import { describe, expect, it, vi } from "vitest";
import { defaultKeymapSettings } from "../domain/keymap";
import {
  CommandRegistry,
  executeCommand,
  executeCommandAndReport,
  type Command,
  type CommandContext,
  type CommandExecutionRunner,
} from "./commandRegistry";
import {
  dispatchResolvedWorkbenchShortcutCommands,
  dispatchWorkbenchShortcutCommand,
  type ShortcutScopedCommand,
} from "./workbenchShortcutCommandDispatcher";

const commandContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: true,
};

describe("dispatchWorkbenchShortcutCommand", () => {
  it("hands Cmd+B to Go to Definition while editor text owns focus and to Toggle Sidebar otherwise", () => {
    let editorFocused = true;
    const toggleSidebar = vi.fn();
    const goToDefinition = vi.fn();
    const sidebarCommand: ShortcutScopedCommand = {
      category: "Agents",
      id: "agent.toggleSidebar",
      isEnabled: () => true,
      isShortcutEnabled: () => !editorFocused,
      run: toggleSidebar,
      title: "Toggle Sidebar",
    };
    const commandRegistry = registry({
      "agent.toggleSidebar": sidebarCommand,
      "editor.goToDefinition": command({ id: "editor.goToDefinition", run: goToDefinition }),
    });
    const dispatch = () =>
      dispatchWorkbenchShortcutCommand({
        commandContext,
        commandRegistry,
        event: keyboardEvent({ key: "b", metaKey: true }),
        keymap: defaultKeymapSettings("mac"),
        runCommand: registryRunner(commandRegistry),
      });

    expect(dispatch()).toBe(true);
    expect(goToDefinition).toHaveBeenCalledTimes(1);
    expect(toggleSidebar).not.toHaveBeenCalled();

    editorFocused = false;

    expect(dispatch()).toBe(true);
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
    expect(goToDefinition).toHaveBeenCalledTimes(1);
  });

  it("dispatches a pre-resolved chord collision in index priority order", () => {
    const runCommand = vi
      .fn<CommandExecutionRunner>()
      .mockReturnValueOnce("disabled")
      .mockReturnValueOnce("executed");
    const event = keyboardEvent({ key: "c", metaKey: true });
    const commandRegistry = registry({
      "editor.save": command({ id: "editor.save", run: vi.fn() }),
      "testing.runAtCursor": command({ id: "testing.runAtCursor", run: vi.fn() }),
    });

    expect(
      dispatchResolvedWorkbenchShortcutCommands({
        commandContext,
        commandIds: ["testing.runAtCursor", "editor.save", "testing.runAtCursor"],
        commandRegistry,
        event,
        runCommand,
      }),
    ).toBe(true);
    expect(runCommand.mock.calls.map(([commandId]) => commandId)).toEqual([
      "testing.runAtCursor",
      "editor.save",
    ]);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("does not consume Cmd+F when the selected agent thread does not own focus", () => {
    const openFind = vi.fn();
    const event = keyboardEvent({ key: "f", metaKey: true });
    const findCommand: ShortcutScopedCommand = {
      category: "Agents",
      id: "agent.findInThread",
      isEnabled: () => true,
      isShortcutEnabled: () => false,
      run: openFind,
      title: "Find in Thread",
    };
    const commandRegistry = registry({
      "agent.findInThread": findCommand,
    });

    expect(
      dispatchWorkbenchShortcutCommand({
        commandContext,
        commandIds: ["agent.findInThread"],
        commandRegistry,
        event,
        keymap: defaultKeymapSettings("mac"),
        runCommand: registryRunner(commandRegistry),
      }),
    ).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(openFind).not.toHaveBeenCalled();
  });

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

  it("uses reverse catalog order for arbitrary custom shortcut collisions", () => {
    const first = vi.fn();
    const second = vi.fn();
    const runCommand = vi.fn<CommandExecutionRunner>((commandId) => {
      if (commandId === "panel.toggleTodo") {
        return "disabled";
      }
      return "executed";
    });
    const event = keyboardEvent({ key: "k", metaKey: true });
    const commandRegistry = registry({
      "panel.toggle": command({ id: "panel.toggle", run: first }),
      "panel.toggleTodo": command({ id: "panel.toggleTodo", run: second }),
    });

    dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["panel.toggle", "panel.toggleTodo"],
      commandRegistry,
      event,
      keymap: {
        ...defaultKeymapSettings("mac"),
        "panel.toggle": "Cmd+K",
        "panel.toggleTodo": "Cmd+K",
      },
      runCommand,
    });

    expect(runCommand.mock.calls.map(([commandId]) => commandId)).toEqual([
      "panel.toggleTodo",
      "panel.toggle",
    ]);
  });

  it("consumes an all-disabled collision after trying each candidate once", () => {
    const runCommand = vi.fn<CommandExecutionRunner>(() => "disabled");
    const event = keyboardEvent({ key: "k", metaKey: true });
    const commandRegistry = registry({
      "panel.toggle": command({ id: "panel.toggle", run: vi.fn() }),
      "panel.toggleTodo": command({ id: "panel.toggleTodo", run: vi.fn() }),
    });

    const handled = dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["panel.toggle", "panel.toggleTodo"],
      commandRegistry,
      event,
      keymap: {
        ...defaultKeymapSettings("mac"),
        "panel.toggle": "Cmd+K",
        "panel.toggleTodo": "Cmd+K",
      },
      runCommand,
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it("does not evaluate or execute duplicate command ids more than once", () => {
    const runCommand = vi.fn<CommandExecutionRunner>(() => "executed");
    const event = keyboardEvent({ key: ",", metaKey: true });
    const commandRegistry = registry({
      "workbench.openSettings": command({
        id: "workbench.openSettings",
        run: vi.fn(),
      }),
    });

    dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["workbench.openSettings", "workbench.openSettings"],
      commandRegistry,
      event,
      keymap: defaultKeymapSettings("mac"),
      runCommand,
    });

    expect(runCommand).toHaveBeenCalledOnce();
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
      expect(runCommand).toHaveBeenCalledWith("workbench.openSettings", commandContext);
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

  it("preserves asynchronous command rejection reporting without running a fallback", async () => {
    const reportError = vi.fn();
    const fallback = vi.fn();
    const event = keyboardEvent({ key: "k", metaKey: true });
    const commandRegistry = registry({
      "panel.toggle": command({ id: "panel.toggle", run: fallback }),
      "panel.toggleTodo": command({
        id: "panel.toggleTodo",
        run: () => Promise.reject(new Error("async command failed")),
      }),
    });
    const runCommand: CommandExecutionRunner = (commandId, context = commandContext) =>
      executeCommandAndReport(commandRegistry, commandId, context, reportError);

    dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["panel.toggle", "panel.toggleTodo"],
      commandRegistry,
      event,
      keymap: {
        ...defaultKeymapSettings("mac"),
        "panel.toggle": "Cmd+K",
        "panel.toggleTodo": "Cmd+K",
      },
      runCommand,
    });
    await Promise.resolve();

    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "async command failed" }),
    );
    expect(fallback).not.toHaveBeenCalled();
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
