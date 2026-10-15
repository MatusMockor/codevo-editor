// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../domain/command";
import { __resetKeymapPlatformCacheForTests } from "../domain/keymap";
import { defaultAppSettings, type AppSettings } from "../domain/settings";
import { CommandRegistry, executeCommand, type CommandContext } from "./commandRegistry";
import { useWorkbenchKeyboardShortcuts } from "./useWorkbenchKeyboardShortcuts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const context: CommandContext = {
  hasWorkspace: true,
};
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function command(id: string, run: () => void): Command {
  return { id, title: id, category: "Test", isEnabled: () => true, run };
}

function Harness({
  appSettings,
  registry,
}: {
  readonly appSettings: AppSettings;
  readonly registry: CommandRegistry;
}) {
  useWorkbenchKeyboardShortcuts({
    appSettingsRef: { current: appSettings },
    bareKeyShortcutsRef: { current: { keymap: null, keys: new Set<string>() } },
    closeFloatingSurface: () => false,
    commandContext: context,
    commandRegistry: registry,
    keymap: appSettings.keymap,
    runCommand: (commandId, commandContext = context) =>
      executeCommand(registry, commandId, commandContext),
  });
  return (
    <div>
      <input aria-label="composer" />
      <textarea aria-label="viewer search" />
    </div>
  );
}

function keydown(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    metaKey: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window.navigator, "platform", { configurable: true, value: "MacIntel" });
  __resetKeymapPlatformCacheForTests();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe("palette shortcuts from any focused field", () => {
  it("opens the palette and the cheatsheet from every field without chord delays", () => {
    const openPalette = vi.fn();
    const cheatsheet = vi.fn();
    const registry = new CommandRegistry();
    registry.register(command("palette.open", openPalette));
    registry.register(command("palette.shortcuts", cheatsheet));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const appSettings = defaultAppSettings();
    act(() => root?.render(<Harness appSettings={appSettings} registry={registry} />));
    const composer = document.querySelector('[aria-label="composer"]');
    const search = document.querySelector('[aria-label="viewer search"]');
    expect(composer).not.toBeNull();
    expect(search).not.toBeNull();

    expect(keydown(composer as Element, "k").defaultPrevented).toBe(true);
    expect(openPalette).toHaveBeenCalledTimes(1);
    expect(keydown(search as Element, "k").defaultPrevented).toBe(true);
    expect(openPalette).toHaveBeenCalledTimes(2);

    expect(keydown(search as Element, "/").defaultPrevented).toBe(true);
    keydown(composer as Element, "/");
    expect(cheatsheet).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(2_500));
    expect(openPalette).toHaveBeenCalledTimes(2);
  });
});

describe("shortcuts inside an open command surface", () => {
  function mountDialog(registry: CommandRegistry) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const appSettings = defaultAppSettings();
    act(() => root?.render(<Harness appSettings={appSettings} registry={registry} />));
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const field = document.createElement("input");
    dialog.append(field);
    host.append(dialog);
    return { dialog, field };
  }

  it("ignores a shortcut the open command surface already handled", () => {
    const quickOpenFile = vi.fn();
    const registry = new CommandRegistry();
    registry.register(command("file.quickOpen", quickOpenFile));
    const { dialog, field } = mountDialog(registry);
    const handle = (event: Event) => event.preventDefault();
    dialog.addEventListener("keydown", handle);
    keydown(field, "p");
    dialog.removeEventListener("keydown", handle);
    expect(quickOpenFile).not.toHaveBeenCalled();
  });

  it("still runs a shortcut the open command surface left unhandled", () => {
    const quickOpenFile = vi.fn();
    const registry = new CommandRegistry();
    registry.register(command("file.quickOpen", quickOpenFile));
    const { field } = mountDialog(registry);
    keydown(field, "p");
    expect(quickOpenFile).toHaveBeenCalledTimes(1);
  });

  it("keeps running shortcuts a field already prevented outside a command surface", () => {
    const quickOpenFile = vi.fn();
    const registry = new CommandRegistry();
    registry.register(command("file.quickOpen", quickOpenFile));
    mountDialog(registry);
    const composer = document.querySelector('[aria-label="composer"]') as Element;
    const handle = (event: Event) => event.preventDefault();
    composer.addEventListener("keydown", handle);
    keydown(composer, "p");
    composer.removeEventListener("keydown", handle);
    expect(quickOpenFile).toHaveBeenCalledTimes(1);
  });
});
