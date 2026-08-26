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
  it("dispatches a pre-resolved chord collision in index priority order", () => {
    const runCommand = vi
      .fn<CommandExecutionRunner>()
      .mockReturnValueOnce("disabled")
      .mockReturnValueOnce("executed");
    const event = keyboardEvent({ key: "c", metaKey: true });
    const commandRegistry = registry({
      "editor.save": command({ id: "editor.save", run: vi.fn() }),
      "testing.debugAtCursor": command({ id: "testing.debugAtCursor", run: vi.fn() }),
    });

    expect(
      dispatchResolvedWorkbenchShortcutCommands({
        commandContext,
        commandIds: ["testing.debugAtCursor", "editor.save", "testing.debugAtCursor"],
        commandRegistry,
        event,
        runCommand,
      }),
    ).toBe(true);
    expect(runCommand.mock.calls.map(([commandId]) => commandId)).toEqual([
      "testing.debugAtCursor",
      "editor.save",
    ]);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("does not consume macOS Enter when Set Value has no focused Variables capability", () => {
    const beginEdit = vi.fn();
    const event = keyboardEvent({ key: "Enter" });
    const commandRegistry = registry({
      "debug.setVariable": command({
        enabled: false,
        id: "debug.setVariable",
        run: beginEdit,
      }),
    });

    expect(
      dispatchWorkbenchShortcutCommand({
        commandContext,
        commandRegistry,
        event,
        keymap: defaultKeymapSettings("mac"),
        runCommand: registryRunner(commandRegistry),
      }),
    ).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(beginEdit).not.toHaveBeenCalled();
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

  it("routes F2 to focused Set Value first and otherwise falls through to Rename", () => {
    for (const setValueEnabled of [true, false]) {
      const setValue = vi.fn();
      const rename = vi.fn();
      const event = keyboardEvent({ key: "F2" });
      const commandRegistry = registry({
        "editor.rename": command({ id: "editor.rename", run: rename }),
        "debug.setVariable": command({
          enabled: setValueEnabled,
          id: "debug.setVariable",
          run: setValue,
        }),
      });

      expect(
        dispatchWorkbenchShortcutCommand({
          commandContext,
          commandRegistry,
          event,
          keymap: defaultKeymapSettings("windows"),
          runCommand: registryRunner(commandRegistry),
        }),
      ).toBe(true);
      expect(setValue).toHaveBeenCalledTimes(setValueEnabled ? 1 : 0);
      expect(rename).toHaveBeenCalledTimes(setValueEnabled ? 0 : 1);
    }
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

  it("lets the later F11 debug command win over the legacy bookmark binding", () => {
    const bookmark = vi.fn();
    const step = vi.fn();
    const event = keyboardEvent({ key: "F11" });
    const commandRegistry = registry({
      "bookmark.toggle": command({ id: "bookmark.toggle", run: bookmark }),
      "debug.stepInto": command({ id: "debug.stepInto", run: step }),
    });

    const handled = dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["bookmark.toggle", "debug.stepInto"],
      commandRegistry,
      event,
      keymap: {
        ...defaultKeymapSettings("mac"),
        "bookmark.toggle": "F11",
      },
      runCommand: registryRunner(commandRegistry),
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(step).toHaveBeenCalledOnce();
    expect(bookmark).not.toHaveBeenCalled();
  });

  it("falls back from a disabled F11 debug command to the legacy bookmark binding", () => {
    const bookmark = vi.fn();
    const step = vi.fn();
    const event = keyboardEvent({ key: "F11" });
    const commandRegistry = registry({
      "bookmark.toggle": command({ id: "bookmark.toggle", run: bookmark }),
      "debug.stepInto": command({ enabled: false, id: "debug.stepInto", run: step }),
    });

    const handled = dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["bookmark.toggle", "debug.stepInto"],
      commandRegistry,
      event,
      keymap: {
        ...defaultKeymapSettings("mac"),
        "bookmark.toggle": "F11",
      },
      runCommand: registryRunner(commandRegistry),
    });

    expect(handled).toBe(true);
    expect(step).not.toHaveBeenCalled();
    expect(bookmark).toHaveBeenCalledOnce();
  });

  it("resolves Shift+F11 independently from the unmodified F11 chain", () => {
    const showBookmarks = vi.fn();
    const step = vi.fn();
    const event = keyboardEvent({ key: "F11", shiftKey: true });
    const commandRegistry = registry({
      "bookmark.showPanel": command({ id: "bookmark.showPanel", run: showBookmarks }),
      "debug.stepOut": command({ id: "debug.stepOut", run: step }),
    });

    dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["bookmark.showPanel", "debug.stepOut"],
      commandRegistry,
      event,
      keymap: {
        ...defaultKeymapSettings("mac"),
        "bookmark.showPanel": "Shift+F11",
      },
      runCommand: registryRunner(commandRegistry),
    });

    expect(step).toHaveBeenCalledOnce();
    expect(showBookmarks).not.toHaveBeenCalled();
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

  it.each([
    ["attach", "workbench.action.debug.disconnect", ["workbench.action.debug.disconnect"]],
    ["launch", "debug.stop", ["workbench.action.debug.disconnect", "debug.stop"]],
    ["disabled", null, ["workbench.action.debug.disconnect", "debug.stop"]],
  ] as const)(
    "routes the intentional Shift+F5 collision for %s state",
    (_state, executed, calls) => {
      const event = keyboardEvent({ key: "F5", shiftKey: true });
      const commandRegistry = registry({
        "debug.stop": command({ id: "debug.stop", run: vi.fn() }),
        "workbench.action.debug.disconnect": command({
          id: "workbench.action.debug.disconnect",
          run: vi.fn(),
        }),
      });
      const runCommand = vi.fn<CommandExecutionRunner>((commandId) =>
        commandId === executed ? "executed" : "disabled",
      );

      expect(
        dispatchWorkbenchShortcutCommand({
          commandContext,
          commandRegistry,
          event,
          keymap: defaultKeymapSettings("mac"),
          runCommand,
        }),
      ).toBe(true);
      expect(runCommand.mock.calls.map(([commandId]) => commandId)).toEqual(calls);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    },
  );

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
