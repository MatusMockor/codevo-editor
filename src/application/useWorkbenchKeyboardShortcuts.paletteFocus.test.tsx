// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../domain/command";
import type { DoubleShiftDetector } from "../domain/doubleShiftDetector";
import { __resetKeymapPlatformCacheForTests } from "../domain/keymap";
import { defaultAppSettings, type AppSettings } from "../domain/settings";
import { CommandRegistry, executeCommand, type CommandContext } from "./commandRegistry";
import { useWorkbenchKeyboardShortcuts } from "./useWorkbenchKeyboardShortcuts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const context: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: true,
  hasWorkspace: true,
};
const EDITOR_SURFACE_IDENTITY = {};
const DOUBLE_SHIFT_DETECTOR: DoubleShiftDetector = {
  handleKeyDown: () => false,
  reset: () => undefined,
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
    actions: { closeFloatingSurface: () => false, openSearchEverywhere: () => undefined },
    appSettingsRef: { current: appSettings },
    bareKeyShortcutsRef: { current: { keymap: null, keys: new Set<string>() } },
    commandContext: context,
    commandRegistry: registry,
    doubleShiftDetectorRef: { current: DOUBLE_SHIFT_DETECTOR },
    editorSurfaceIdentity: EDITOR_SURFACE_IDENTITY,
    keymap: appSettings.keymap,
    runCommand: (commandId, commandContext = context) =>
      executeCommand(registry, commandId, commandContext),
  });
  return (
    <div>
      <input aria-label="composer" />
      <div className="monaco-editor">
        <textarea aria-label="editor" className="inputarea" />
      </div>
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

describe("palette shortcuts respect editor text focus", () => {
  it("opens the palette immediately outside the editor and keeps Cmd+K chords inside it", () => {
    const openPalette = vi.fn();
    const splitDown = vi.fn();
    const cheatsheet = vi.fn();
    const registry = new CommandRegistry();
    registry.register(command("palette.open", openPalette));
    registry.register(command("palette.shortcuts", cheatsheet));
    registry.register(command("editor.splitDown", splitDown));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const appSettings = defaultAppSettings();
    act(() => root?.render(<Harness appSettings={appSettings} registry={registry} />));
    const composer = document.querySelector('[aria-label="composer"]');
    const editor = document.querySelector('[aria-label="editor"]');
    expect(composer).not.toBeNull();
    expect(editor).not.toBeNull();

    keydown(composer as Element, "k");
    expect(openPalette).toHaveBeenCalledTimes(1);

    keydown(editor as Element, "k");
    keydown(editor as Element, "\\");
    act(() => vi.advanceTimersByTime(2_500));
    expect(splitDown).toHaveBeenCalledTimes(1);
    expect(openPalette).toHaveBeenCalledTimes(1);

    const slash = keydown(editor as Element, "/");
    expect(cheatsheet).not.toHaveBeenCalled();
    expect(slash.defaultPrevented).toBe(false);
    keydown(composer as Element, "/");
    expect(cheatsheet).toHaveBeenCalledTimes(1);
  });
});
