import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetKeymapPlatformCacheForTests, defaultKeymapSettings } from "../domain/keymap";
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
  dispatchWorkbenchDefaultAliasCommand,
  dispatchWorkbenchShortcutCommand,
  type ShortcutScopedCommand,
} from "./workbenchShortcutCommandDispatcher";

const commandContext: CommandContext = {
  hasWorkspace: true,
};

beforeEach(() => {
  vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh)" });
  __resetKeymapPlatformCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetKeymapPlatformCacheForTests();
});

describe("dispatchWorkbenchShortcutCommand", () => {
  it("runs Toggle Sidebar on Cmd+B only while its shortcut scope allows it", () => {
    let sidebarShortcutEnabled = false;
    const toggleSidebar = vi.fn();
    const sidebarCommand: ShortcutScopedCommand = {
      category: "Agents",
      id: "agent.toggleSidebar",
      isEnabled: () => true,
      isShortcutEnabled: () => sidebarShortcutEnabled,
      run: toggleSidebar,
      title: "Toggle Sidebar",
    };
    const commandRegistry = registry({ "agent.toggleSidebar": sidebarCommand });
    const event = keyboardEvent({ key: "b", metaKey: true });
    const dispatch = () =>
      dispatchWorkbenchShortcutCommand({
        commandContext,
        commandRegistry,
        event,
        keymap: defaultKeymapSettings("mac"),
        runCommand: registryRunner(commandRegistry),
      });

    expect(dispatch()).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(toggleSidebar).not.toHaveBeenCalled();

    sidebarShortcutEnabled = true;

    expect(dispatch()).toBe(true);
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it("dispatches a pre-resolved chord collision in index priority order", () => {
    const runCommand = vi
      .fn<CommandExecutionRunner>()
      .mockReturnValueOnce("disabled")
      .mockReturnValueOnce("executed");
    const event = keyboardEvent({ key: "c", metaKey: true });
    const commandRegistry = registry({
      "app.quit": command({ id: "app.quit", run: vi.fn() }),
      "agent.goToTurn": command({ id: "agent.goToTurn", run: vi.fn() }),
    });

    expect(
      dispatchResolvedWorkbenchShortcutCommands({
        commandContext,
        commandIds: ["agent.goToTurn", "app.quit", "agent.goToTurn"],
        commandRegistry,
        event,
        runCommand,
      }),
    ).toBe(true);
    expect(runCommand.mock.calls.map(([commandId]) => commandId)).toEqual([
      "agent.goToTurn",
      "app.quit",
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
        "panel.toggleMaximized": "Cmd+J",
      },
      runCommand: registryRunner(commandRegistry),
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("consumes a matching disabled command without running it", () => {
    const run = vi.fn();
    const event = keyboardEvent({ key: "w", metaKey: true });
    const commandRegistry = registry({
      "workbench.closeActive": command({
        enabled: false,
        id: "workbench.closeActive",
        run,
      }),
    });

    const handled = dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["workbench.closeActive"],
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
      if (commandId === "panel.toggleMaximized") {
        return "disabled";
      }
      return "executed";
    });
    const event = keyboardEvent({ key: "k", metaKey: true });
    const commandRegistry = registry({
      "panel.toggle": command({ id: "panel.toggle", run: first }),
      "panel.toggleMaximized": command({ id: "panel.toggleMaximized", run: second }),
    });

    dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["panel.toggle", "panel.toggleMaximized"],
      commandRegistry,
      event,
      keymap: {
        ...defaultKeymapSettings("mac"),
        "panel.toggle": "Cmd+K",
        "panel.toggleMaximized": "Cmd+K",
      },
      runCommand,
    });

    expect(runCommand.mock.calls.map(([commandId]) => commandId)).toEqual([
      "panel.toggleMaximized",
      "panel.toggle",
    ]);
  });

  it("consumes an all-disabled collision after trying each candidate once", () => {
    const runCommand = vi.fn<CommandExecutionRunner>(() => "disabled");
    const event = keyboardEvent({ key: "k", metaKey: true });
    const commandRegistry = registry({
      "panel.toggle": command({ id: "panel.toggle", run: vi.fn() }),
      "panel.toggleMaximized": command({ id: "panel.toggleMaximized", run: vi.fn() }),
    });

    const handled = dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["panel.toggle", "panel.toggleMaximized"],
      commandRegistry,
      event,
      keymap: {
        ...defaultKeymapSettings("mac"),
        "panel.toggle": "Cmd+K",
        "panel.toggleMaximized": "Cmd+K",
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
      "panel.toggleMaximized": command({
        id: "panel.toggleMaximized",
        run: () => Promise.reject(new Error("async command failed")),
      }),
    });
    const runCommand: CommandExecutionRunner = (commandId, context = commandContext) =>
      executeCommandAndReport(commandRegistry, commandId, context, reportError);

    dispatchWorkbenchShortcutCommand({
      commandContext,
      commandIds: ["panel.toggle", "panel.toggleMaximized"],
      commandRegistry,
      event,
      keymap: {
        ...defaultKeymapSettings("mac"),
        "panel.toggle": "Cmd+K",
        "panel.toggleMaximized": "Cmd+K",
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

  it("leaves an unregistered keymap shortcut untouched", () => {
    const event = keyboardEvent({ key: "w", metaKey: true });
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

describe("dispatchWorkbenchDefaultAliasCommand", () => {
  it.each([
    ["mac", { key: "+", metaKey: true, shiftKey: true }],
    ["linux", { ctrlKey: true, key: "+", shiftKey: true }],
    ["windows", { ctrlKey: true, key: "+", shiftKey: true }],
  ] as const)("runs Zoom In for the shifted + chord on %s", (platform, init) => {
    const zoomIn = vi.fn();
    const event = keyboardEvent(init);
    const commandRegistry = registry({
      "workbench.zoomIn": command({ id: "workbench.zoomIn", run: zoomIn }),
    });

    const handled = dispatchWorkbenchDefaultAliasCommand({
      commandContext,
      commandRegistry,
      event,
      keymap: defaultKeymapSettings(platform),
      platform,
      runCommand: registryRunner(commandRegistry),
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(zoomIn).toHaveBeenCalledTimes(1);
  });

  it("consumes the alias chord without running a disabled command", () => {
    const zoomIn = vi.fn();
    const event = keyboardEvent({ key: "+", metaKey: true, shiftKey: true });
    const commandRegistry = registry({
      "workbench.zoomIn": command({ enabled: false, id: "workbench.zoomIn", run: zoomIn }),
    });

    const handled = dispatchWorkbenchDefaultAliasCommand({
      commandContext,
      commandRegistry,
      event,
      keymap: defaultKeymapSettings("mac"),
      platform: "mac",
      runCommand: registryRunner(commandRegistry),
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(zoomIn).not.toHaveBeenCalled();
  });

  it.each([
    ["the command is rebound", { "workbench.zoomIn": "Cmd+Alt+I" }],
    ["another command owns the chord", { "agent.goToTurn": "Cmd+Shift+=" }],
  ] as const)("leaves the shifted + chord untouched when %s", (_reason, overrides) => {
    const zoomIn = vi.fn();
    const event = keyboardEvent({ key: "+", metaKey: true, shiftKey: true });
    const commandRegistry = registry({
      "workbench.zoomIn": command({ id: "workbench.zoomIn", run: zoomIn }),
    });

    const handled = dispatchWorkbenchDefaultAliasCommand({
      commandContext,
      commandRegistry,
      event,
      keymap: { ...defaultKeymapSettings("mac"), ...overrides },
      platform: "mac",
      runCommand: registryRunner(commandRegistry),
    });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(zoomIn).not.toHaveBeenCalled();
  });

  it.each([
    ["an unrelated chord", { key: "x", metaKey: true, shiftKey: true }],
    ["the unshifted + chord", { key: "+", metaKey: true }],
    ["the other platform's primary modifier", { ctrlKey: true, key: "+", shiftKey: true }],
  ] as const)("does not consume %s", (_label, init) => {
    const zoomIn = vi.fn();
    const event = keyboardEvent(init);
    const commandRegistry = registry({
      "workbench.zoomIn": command({ id: "workbench.zoomIn", run: zoomIn }),
    });

    const handled = dispatchWorkbenchDefaultAliasCommand({
      commandContext,
      commandRegistry,
      event,
      keymap: defaultKeymapSettings("mac"),
      platform: "mac",
      runCommand: registryRunner(commandRegistry),
    });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(zoomIn).not.toHaveBeenCalled();
  });

  it("leaves the alias chord untouched when the command is not registered", () => {
    const event = keyboardEvent({ key: "+", metaKey: true, shiftKey: true });
    const runCommand = vi.fn();

    const handled = dispatchWorkbenchDefaultAliasCommand({
      commandContext,
      commandRegistry: registry({}),
      event,
      keymap: defaultKeymapSettings("mac"),
      platform: "mac",
      runCommand,
    });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });
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
