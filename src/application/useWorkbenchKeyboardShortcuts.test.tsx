// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { __resetKeymapPlatformCacheForTests } from "../domain/keymap";
import { defaultAppSettings } from "../domain/settings";
import {
  CommandRegistry,
  executeCommand,
  type CommandContext,
  type CommandExecutionRunner,
} from "./commandRegistry";
import { useWorkbenchKeyboardShortcuts } from "./useWorkbenchKeyboardShortcuts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const commandContext: CommandContext = {
  hasWorkspace: true,
};
const NAVIGATOR_BY_KEYMAP_PLATFORM = {
  linux: { platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" },
  mac: { platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
  windows: { platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
} as const;
const SHIFTED_PLUS_BY_KEYMAP_PLATFORM = {
  linux: { ctrlKey: true, key: "+", shiftKey: true },
  mac: { key: "+", metaKey: true, shiftKey: true },
  windows: { ctrlKey: true, key: "+", shiftKey: true },
} as const;

describe("useWorkbenchKeyboardShortcuts", () => {
  it.each([["agent.openDiffSurface", "∂", "KeyD"]] as const)(
    "dispatches %s from an Option-transformed macOS key",
    (commandId, key, code) => {
      withKeymapPlatform("mac", () => {
        const run = vi.fn();
        const registry = registryWith(commandId, run);
        const harness = renderHook({ commandRegistry: registry });

        const event = dispatchKeyboardEvent({ altKey: true, code, key, metaKey: true });

        expect(event.defaultPrevented).toBe(true);
        expect(run).toHaveBeenCalledOnce();

        harness.unmount();
      });
    },
  );

  it.each(["mac", "linux", "windows"] as const)(
    "closes the active panel through workbench.closeActive on the %s primary+W",
    (platform) => {
      withKeymapPlatform(platform, () => {
        const run = vi.fn();
        const harness = renderHook({
          commandRegistry: registryWith("workbench.closeActive", run),
        });
        const primary = platform === "mac" ? { metaKey: true } : { ctrlKey: true };

        expect(dispatchKeyboardEvent({ key: "w", ...primary }).defaultPrevented).toBe(true);
        expect(run).toHaveBeenCalledOnce();

        harness.unmount();
      });
    },
  );

  it("dispatches a user-bound chord once from any focused field", () => {
    withKeymapPlatform("mac", () => {
      const run = vi.fn();
      const harness = renderHook({
        appSettings: settingsWithKeymap({ "agent.goToTurn": "Cmd+; C" }),
        commandRegistry: registryWith("agent.goToTurn", run),
      });
      const field = document.createElement("textarea");
      document.body.append(field);

      expect(dispatchKeyboardEventFrom(field, { key: ";", metaKey: true }).defaultPrevented).toBe(
        true,
      );
      expect(run).not.toHaveBeenCalled();
      expect(dispatchKeyboardEventFrom(field, { key: "c" }).defaultPrevented).toBe(true);
      expect(run).toHaveBeenCalledOnce();

      field.remove();
      harness.unmount();
    });
  });

  it("consumes a wrong second stroke without dispatching the chord", () => {
    withKeymapPlatform("mac", () => {
      const run = vi.fn();
      const harness = renderHook({
        appSettings: settingsWithKeymap({ "agent.goToTurn": "Cmd+; C" }),
        commandRegistry: registryWith("agent.goToTurn", run),
      });

      expect(dispatchKeyboardEvent({ key: ";", metaKey: true }).defaultPrevented).toBe(true);
      expect(dispatchKeyboardEvent({ key: "x" }).defaultPrevented).toBe(true);
      expect(dispatchKeyboardEvent({ key: "c" }).defaultPrevented).toBe(false);
      expect(run).not.toHaveBeenCalled();

      harness.unmount();
    });
  });

  it("honors a chord override and returns to the default binding", () => {
    withKeymapPlatform("mac", () => {
      const host = document.createElement("div");
      const root = createRoot(host);
      const run = vi.fn();
      const registry = registryWith("agent.goToTurn", run);
      const defaults = defaultAppSettings();
      const overridden = settingsWithKeymap({ "agent.goToTurn": "Cmd+; Cmd+T" });
      const closeFloatingSurface = vi.fn(() => false);
      const render = (appSettings: typeof defaults) => {
        act(() => {
          root.render(
            <HookHarness
              appSettings={appSettings}
              closeFloatingSurface={closeFloatingSurface}
              commandRegistry={registry}
              runCommand={(id, context = commandContext) => executeCommand(registry, id, context)}
            />,
          );
        });
      };

      render(overridden);
      expect(dispatchKeyboardEvent({ key: ";", metaKey: true }).defaultPrevented).toBe(true);
      expect(dispatchKeyboardEvent({ key: "t", metaKey: true }).defaultPrevented).toBe(true);
      expect(run).toHaveBeenCalledTimes(1);

      render(defaults);
      expect(dispatchKeyboardEvent({ key: ";", metaKey: true }).defaultPrevented).toBe(false);
      expect(
        dispatchKeyboardEvent({ key: "o", metaKey: true, shiftKey: true }).defaultPrevented,
      ).toBe(true);
      expect(run).toHaveBeenCalledTimes(2);

      act(() => root.unmount());
    });
  });

  it("revokes a pending chord on Escape and window blur", () => {
    withKeymapPlatform("mac", () => {
      const run = vi.fn();
      const harness = renderHook({
        appSettings: settingsWithKeymap({ "agent.goToTurn": "Cmd+; Cmd+C" }),
        commandRegistry: registryWith("agent.goToTurn", run),
      });

      dispatchKeyboardEvent({ key: ";", metaKey: true });
      dispatchKeyboardEvent({ key: "Escape" });
      dispatchKeyboardEvent({ key: "c", metaKey: true });
      dispatchKeyboardEvent({ key: ";", metaKey: true });
      window.dispatchEvent(new Event("blur"));
      dispatchKeyboardEvent({ key: "c", metaKey: true });

      expect(run).not.toHaveBeenCalled();

      harness.unmount();
    });
  });

  it("revokes a pending chord across a keymap A-B-A transition", () => {
    withKeymapPlatform("mac", () => {
      const host = document.createElement("div");
      const root = createRoot(host);
      const run = vi.fn();
      const registry = registryWith("agent.goToTurn", run);
      const settingsA = settingsWithKeymap({ "agent.goToTurn": "Cmd+; Cmd+C" });
      const settingsB = settingsWithKeymap({ "agent.goToTurn": "Cmd+J Cmd+C" });
      const closeFloatingSurface = vi.fn(() => false);
      const render = (appSettings: typeof settingsA) => {
        act(() => {
          root.render(
            <HookHarness
              appSettings={appSettings}
              closeFloatingSurface={closeFloatingSurface}
              commandRegistry={registry}
              runCommand={(id, context = commandContext) => executeCommand(registry, id, context)}
            />,
          );
        });
      };

      render(settingsA);
      dispatchKeyboardEvent({ key: ";", metaKey: true });
      render(settingsB);
      render(settingsA);
      dispatchKeyboardEvent({ key: "c", metaKey: true });

      expect(run).not.toHaveBeenCalled();

      act(() => root.unmount());
    });
  });

  it("dispatches registry shortcuts through the command registry", () => {
    withKeymapPlatform("mac", () => {
      const run = vi.fn();
      const harness = renderHook({ commandRegistry: registryWith("workbench.openSettings", run) });

      const event = dispatchKeyboardEvent({ key: ",", metaKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(run).toHaveBeenCalledTimes(1);

      harness.unmount();
    });
  });

  it("dispatches canonical shortcuts through the injected command runner", () => {
    withKeymapPlatform("mac", () => {
      const registry = registryWith("workbench.openSettings", vi.fn());
      const runCommand = vi.fn(() => "executed" as const);
      const harness = renderHook({ commandRegistry: registry, runCommand });

      const event = dispatchKeyboardEvent({ key: ",", metaKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(runCommand).toHaveBeenCalledWith("workbench.openSettings", commandContext);

      harness.unmount();
    });
  });

  it("consumes a disabled command's shortcut without running it", () => {
    withKeymapPlatform("mac", () => {
      const run = vi.fn();
      const harness = renderHook({
        commandRegistry: registryWith("workbench.closeActive", run, false),
      });

      const event = dispatchKeyboardEvent({ key: "w", metaKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(run).not.toHaveBeenCalled();

      harness.unmount();
    });
  });

  it("runs the quit command through the registry on Cmd+Q", () => {
    withKeymapPlatform("mac", () => {
      const run = vi.fn();
      const harness = renderHook({ commandRegistry: registryWith("app.quit", run) });

      const event = dispatchKeyboardEvent({ key: "q", metaKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(run).toHaveBeenCalledTimes(1);

      harness.unmount();
    });
  });

  it("no longer turns a double Shift tap into a command", () => {
    withKeymapPlatform("mac", () => {
      const runCommand = vi.fn(() => "executed" as const);
      const harness = renderHook({ runCommand });

      const first = dispatchKeyboardEvent({ key: "Shift", shiftKey: true });
      const second = dispatchKeyboardEvent({ key: "Shift", shiftKey: true });

      expect(first.defaultPrevented).toBe(false);
      expect(second.defaultPrevented).toBe(false);
      expect(runCommand).not.toHaveBeenCalled();

      harness.unmount();
    });
  });

  it("leaves F12 to the focused surface now that no command aliases it", () => {
    withKeymapPlatform("mac", () => {
      const runCommand = vi.fn(() => "executed" as const);
      const harness = renderHook({ runCommand });

      expect(dispatchKeyboardEvent({ key: "F12" }).defaultPrevented).toBe(false);
      expect(runCommand).not.toHaveBeenCalled();

      harness.unmount();
    });
  });

  it.each(["mac", "linux", "windows"] as const)(
    "increases the window zoom from the shifted + chord on %s from any focused field",
    (platform) => {
      withKeymapPlatform(platform, () => {
        const zoomIn = vi.fn();
        const harness = renderHook({ commandRegistry: windowZoomInRegistry(zoomIn) });
        const field = document.createElement("textarea");
        document.body.append(field);
        const shiftedPlus = SHIFTED_PLUS_BY_KEYMAP_PLATFORM[platform];

        expect(dispatchKeyboardEvent(shiftedPlus).defaultPrevented).toBe(true);
        expect(zoomIn).toHaveBeenCalledTimes(1);
        expect(dispatchKeyboardEventFrom(field, shiftedPlus).defaultPrevented).toBe(true);
        expect(zoomIn).toHaveBeenCalledTimes(2);
        expect(
          dispatchKeyboardEventFrom(field, { ...shiftedPlus, key: "=" }).defaultPrevented,
        ).toBe(true);
        expect(zoomIn).toHaveBeenCalledTimes(3);

        field.remove();
        harness.unmount();
      });
    },
  );

  it("keeps increasing the window zoom from Cmd+= and an unshifted + key", () => {
    withKeymapPlatform("mac", () => {
      const zoomIn = vi.fn();
      const harness = renderHook({ commandRegistry: windowZoomInRegistry(zoomIn) });

      expect(dispatchKeyboardEvent({ key: "=", metaKey: true }).defaultPrevented).toBe(true);
      expect(zoomIn).toHaveBeenCalledTimes(1);
      expect(dispatchKeyboardEvent({ key: "+", metaKey: true }).defaultPrevented).toBe(true);
      expect(zoomIn).toHaveBeenCalledTimes(2);

      harness.unmount();
    });
  });

  it("consumes the shifted + chord without running a disabled window zoom in command", () => {
    withKeymapPlatform("mac", () => {
      const zoomIn = vi.fn();
      const harness = renderHook({ commandRegistry: windowZoomInRegistry(zoomIn, false) });

      const event = dispatchKeyboardEvent(SHIFTED_PLUS_BY_KEYMAP_PLATFORM.mac);

      expect(event.defaultPrevented).toBe(true);
      expect(zoomIn).not.toHaveBeenCalled();

      harness.unmount();
    });
  });

  it("drops the shifted + alias once window zoom in is rebound", () => {
    withKeymapPlatform("mac", () => {
      const zoomIn = vi.fn();
      const harness = renderHook({
        appSettings: settingsWithKeymap({ "workbench.zoomIn": "Cmd+Alt+I" }),
        commandRegistry: windowZoomInRegistry(zoomIn),
      });

      expect(dispatchKeyboardEvent(SHIFTED_PLUS_BY_KEYMAP_PLATFORM.mac).defaultPrevented).toBe(
        false,
      );
      expect(dispatchKeyboardEvent({ key: "=", metaKey: true }).defaultPrevented).toBe(false);
      expect(zoomIn).not.toHaveBeenCalled();
      expect(
        dispatchKeyboardEvent({ altKey: true, code: "KeyI", key: "i", metaKey: true })
          .defaultPrevented,
      ).toBe(true);
      expect(zoomIn).toHaveBeenCalledTimes(1);

      harness.unmount();
    });
  });

  it("lets a command explicitly bound to the shifted + chord win over the alias", () => {
    withKeymapPlatform("mac", () => {
      const zoomIn = vi.fn();
      const goToTurn = vi.fn();
      const registry = windowZoomInRegistry(zoomIn);
      registry.register({
        category: "Agents",
        id: "agent.goToTurn",
        isEnabled: () => true,
        run: goToTurn,
        title: "Go to Turn",
      });
      const harness = renderHook({
        appSettings: settingsWithKeymap({ "agent.goToTurn": "Cmd+Shift+=" }),
        commandRegistry: registry,
      });

      const event = dispatchKeyboardEvent(SHIFTED_PLUS_BY_KEYMAP_PLATFORM.mac);

      expect(event.defaultPrevented).toBe(true);
      expect(goToTurn).toHaveBeenCalledTimes(1);
      expect(zoomIn).not.toHaveBeenCalled();

      harness.unmount();
    });
  });

  it("does not fire the shifted + alias while a chord awaits its second stroke", () => {
    withKeymapPlatform("mac", () => {
      const zoomIn = vi.fn();
      const goToTurn = vi.fn();
      const registry = windowZoomInRegistry(zoomIn);
      registry.register({
        category: "Agents",
        id: "agent.goToTurn",
        isEnabled: () => true,
        run: goToTurn,
        title: "Go to Turn",
      });
      const harness = renderHook({
        appSettings: settingsWithKeymap({ "agent.goToTurn": "Cmd+; Cmd+C" }),
        commandRegistry: registry,
      });

      expect(dispatchKeyboardEvent({ key: ";", metaKey: true }).defaultPrevented).toBe(true);
      expect(dispatchKeyboardEvent(SHIFTED_PLUS_BY_KEYMAP_PLATFORM.mac).defaultPrevented).toBe(
        true,
      );
      expect(zoomIn).not.toHaveBeenCalled();
      expect(goToTurn).not.toHaveBeenCalled();

      expect(dispatchKeyboardEvent(SHIFTED_PLUS_BY_KEYMAP_PLATFORM.mac).defaultPrevented).toBe(
        true,
      );
      expect(zoomIn).toHaveBeenCalledTimes(1);

      harness.unmount();
    });
  });

  it.each([
    ["workbench.zoomIn", { code: "Equal", key: "ž", metaKey: true }],
    ["workbench.zoomIn", { code: "Equal", key: "-", metaKey: true }],
    ["workbench.zoomIn", { code: "Equal", key: "1", metaKey: true, shiftKey: true }],
    ["workbench.zoomIn", { code: "NumpadAdd", key: "Add", metaKey: true }],
    ["workbench.zoomOut", { code: "Minus", key: "=", metaKey: true }],
    ["workbench.zoomOut", { code: "NumpadSubtract", key: "Subtract", metaKey: true }],
    ["workbench.zoomReset", { code: "Digit0", key: "é", metaKey: true }],
    ["workbench.zoomReset", { code: "Numpad0", key: "Insert", metaKey: true }],
  ] as const)("captures %s before focused surfaces consume it", (id, eventInit) => {
    withKeymapPlatform("mac", () => {
      const run = vi.fn();
      const harness = renderHook({ commandRegistry: registryWith(id, run) });
      for (const surface of ["xterm", "agent-composer", "dialog"]) {
        const container = document.createElement("div");
        container.className = surface;
        if (surface === "dialog") {
          container.setAttribute("role", "dialog");
          container.setAttribute("aria-modal", "true");
        }
        const input = document.createElement("textarea");
        container.append(input);
        document.body.append(container);
        const consume = vi.fn((event: KeyboardEvent) => {
          event.preventDefault();
          event.stopPropagation();
        });
        input.addEventListener("keydown", consume);
        input.focus();
        expect(dispatchKeyboardEventFrom(input, eventInit).defaultPrevented).toBe(true);
        expect(consume).not.toHaveBeenCalled();
        container.remove();
      }
      expect(dispatchKeyboardEvent(eventInit).defaultPrevented).toBe(true);
      expect(run).toHaveBeenCalledTimes(4);
      harness.unmount();
    });
  });

  it("captures a custom zoom chord before the agent composer consumes both strokes", () => {
    withKeymapPlatform("mac", () => {
      const run = vi.fn();
      const harness = renderHook({
        appSettings: settingsWithKeymap({ "workbench.zoomIn": "Cmd+J Cmd+=" }),
        commandRegistry: windowZoomInRegistry(run),
      });
      const input = document.createElement("textarea");
      document.body.append(input);
      const consume = vi.fn((event: KeyboardEvent) => event.stopPropagation());
      input.addEventListener("keydown", consume);
      input.focus();
      expect(dispatchKeyboardEventFrom(input, { key: "j", metaKey: true }).defaultPrevented).toBe(
        true,
      );
      expect(run).not.toHaveBeenCalled();
      expect(dispatchKeyboardEventFrom(input, { key: "=", metaKey: true }).defaultPrevented).toBe(
        true,
      );
      expect(run).toHaveBeenCalledOnce();
      expect(consume).not.toHaveBeenCalled();
      input.remove();
      harness.unmount();
    });
  });

  it.each([
    ["Cmd+=", [{ code: "Equal", key: "ž", metaKey: true }]],
    ["Cmd+I", [{ code: "KeyI", key: "i", metaKey: true }]],
    [
      "Cmd+J Cmd+=",
      [
        { code: "KeyJ", key: "j", metaKey: true },
        { code: "Equal", key: "=", metaKey: true },
      ],
    ],
  ] as const)("captures %s when a modal has already prevented the event", (shortcut, strokes) => {
    withKeymapPlatform("mac", () => {
      const run = vi.fn();
      const harness = renderHook({
        appSettings: settingsWithKeymap({ "workbench.zoomIn": shortcut }),
        commandRegistry: windowZoomInRegistry(run),
      });
      const modal = document.createElement("div");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      const input = document.createElement("textarea");
      modal.append(input);
      document.body.append(modal);
      const consume = vi.fn((event: KeyboardEvent) => event.stopPropagation());
      input.addEventListener("keydown", consume);
      input.focus();
      for (const stroke of strokes) {
        const event = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ...stroke,
        });
        event.preventDefault();
        input.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }
      expect(run).toHaveBeenCalledOnce();
      expect(consume).not.toHaveBeenCalled();
      modal.remove();
      harness.unmount();
    });
  });

  it("handles Escape through the floating surface action", () => {
    const closeFloatingSurface = vi.fn(() => true);
    const harness = renderHook({ closeFloatingSurface });

    const event = dispatchKeyboardEvent({ key: "Escape" });

    expect(event.defaultPrevented).toBe(true);
    expect(closeFloatingSurface).toHaveBeenCalledTimes(1);

    harness.unmount();
  });

  it("skips bare keys that cannot match a configured shortcut", () => {
    const runCommand = vi.fn(() => "executed" as const);
    const harness = renderHook({ runCommand });

    const event = dispatchKeyboardEvent({ key: "a" });

    expect(event.defaultPrevented).toBe(false);
    expect(runCommand).not.toHaveBeenCalled();

    harness.unmount();
  });
});

interface RenderHookOptions {
  appSettings?: ReturnType<typeof defaultAppSettings>;
  closeFloatingSurface?: () => boolean;
  commandRegistry?: CommandRegistry;
  runCommand?: CommandExecutionRunner;
}

function renderHook({
  appSettings = defaultAppSettings(),
  closeFloatingSurface = vi.fn(() => false),
  commandRegistry = new CommandRegistry(),
  runCommand = (commandId, context = commandContext) =>
    executeCommand(commandRegistry, commandId, context),
}: RenderHookOptions = {}) {
  const container = document.createElement("div");
  const root = createRoot(container);

  act(() => {
    root.render(
      <HookHarness
        appSettings={appSettings}
        closeFloatingSurface={closeFloatingSurface}
        commandRegistry={commandRegistry}
        runCommand={runCommand}
      />,
    );
  });

  return {
    unmount() {
      act(() => root.unmount());
    },
  };
}

function HookHarness({
  appSettings,
  closeFloatingSurface,
  commandRegistry,
  runCommand,
}: {
  appSettings: ReturnType<typeof defaultAppSettings>;
  closeFloatingSurface: () => boolean;
  commandRegistry: CommandRegistry;
  runCommand: CommandExecutionRunner;
}) {
  useWorkbenchKeyboardShortcuts({
    appSettingsRef: ref(appSettings),
    bareKeyShortcutsRef: ref({ keymap: null, keys: new Set<string>() }),
    closeFloatingSurface,
    commandContext,
    commandRegistry,
    keymap: appSettings.keymap,
    runCommand,
  });

  return null;
}

function settingsWithKeymap(
  overrides: Partial<ReturnType<typeof defaultAppSettings>["keymap"]>,
): ReturnType<typeof defaultAppSettings> {
  const appSettings = defaultAppSettings();
  return { ...appSettings, keymap: { ...appSettings.keymap, ...overrides } };
}

function registryWith(id: string, run: () => void, enabled = true): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register({ category: "Test", id, isEnabled: () => enabled, run, title: id });
  return registry;
}

function windowZoomInRegistry(run: () => void, enabled = true): CommandRegistry {
  return registryWith("workbench.zoomIn", run, enabled);
}

function withKeymapPlatform(
  platform: keyof typeof NAVIGATOR_BY_KEYMAP_PLATFORM,
  run: () => void,
): void {
  const patch = NAVIGATOR_BY_KEYMAP_PLATFORM[platform];
  const keys = ["platform", "userAgent"] as const;
  const saved = keys.map((key) => ({
    descriptor: Object.getOwnPropertyDescriptor(navigator, key),
    key,
  }));
  for (const key of keys) {
    Object.defineProperty(navigator, key, { configurable: true, value: patch[key] });
  }
  __resetKeymapPlatformCacheForTests();
  try {
    run();
  } finally {
    for (const { descriptor, key } of saved) {
      Reflect.deleteProperty(navigator, key);
      if (descriptor !== undefined) Object.defineProperty(navigator, key, descriptor);
    }
    __resetKeymapPlatformCacheForTests();
  }
}

function dispatchKeyboardEvent(init: KeyboardEventInit & { key: string }) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });

  window.dispatchEvent(event);
  return event;
}

function dispatchKeyboardEventFrom(
  target: Element,
  init: KeyboardEventInit & { key: string },
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function ref<T>(current: T) {
  return { current };
}
