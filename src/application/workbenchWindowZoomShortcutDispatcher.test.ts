import { describe, expect, it, vi } from "vitest";
import { defaultKeymapSettings, type KeymapCommandId } from "../domain/keymap";
import { CommandRegistry, executeCommand, type CommandContext } from "./commandRegistry";
import {
  dispatchWorkbenchWindowZoomPhysicalShortcut,
  windowZoomShortcutNeedsCapture,
} from "./workbenchWindowZoomShortcutDispatcher";

const commandContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: false,
};

function keyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    altKey: false,
    code: "Equal",
    ctrlKey: false,
    isComposing: false,
    key: "ž",
    metaKey: true,
    preventDefault: vi.fn(),
    shiftKey: false,
    stopImmediatePropagation: vi.fn(),
    ...overrides,
  } as KeyboardEvent;
}

function zoomRegistry(commandId: KeymapCommandId, enabled = true) {
  const run = vi.fn();
  const registry = new CommandRegistry();
  registry.register({
    category: "Workbench",
    id: commandId,
    isEnabled: () => enabled,
    run,
    title: commandId,
  });
  return { registry, run };
}

describe("dispatchWorkbenchWindowZoomPhysicalShortcut", () => {
  it.each([
    ["workbench.zoomIn", { code: "Equal", key: "ž" }],
    ["workbench.zoomIn", { code: "Equal", key: "-" }],
    ["workbench.zoomIn", { code: "Equal", key: "1", shiftKey: true }],
    ["workbench.zoomIn", { code: "NumpadAdd", key: "Add" }],
    ["workbench.zoomIn", { code: "Digit1", key: "+" }],
    ["workbench.zoomIn", { code: "Digit1", key: "+", shiftKey: true }],
    ["workbench.zoomOut", { code: "Minus", key: "=" }],
    ["workbench.zoomOut", { code: "NumpadSubtract", key: "Subtract" }],
    ["workbench.zoomOut", { code: "Slash", key: "-" }],
    ["workbench.zoomReset", { code: "Digit0", key: "é" }],
    ["workbench.zoomReset", { code: "Numpad0", key: "Insert" }],
  ] as const)("dispatches %s using physical keys and layout symbols", (commandId, overrides) => {
    const { registry, run } = zoomRegistry(commandId);
    const event = keyEvent(overrides);
    expect(
      dispatchWorkbenchWindowZoomPhysicalShortcut({
        commandContext,
        commandRegistry: registry,
        event,
        keymap: defaultKeymapSettings("mac"),
        platform: "mac",
        runCommand: (id, context = commandContext) => executeCommand(registry, id, context),
      }),
    ).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it.each([
    { altKey: true },
    { ctrlKey: true },
    { metaKey: false },
    { isComposing: true },
    { code: "Minus", key: "_", shiftKey: true },
    { code: "Minus", key: "=", shiftKey: true },
    { code: "Digit0", key: ")", shiftKey: true },
    { code: "Digit0", key: "+", shiftKey: true },
    { getModifierState: () => true },
  ])("rejects an event with disallowed state %j", (overrides) => {
    const { registry, run } = zoomRegistry("workbench.zoomIn");
    const event = keyEvent(overrides);
    expect(
      dispatchWorkbenchWindowZoomPhysicalShortcut({
        commandContext,
        commandRegistry: registry,
        event,
        keymap: defaultKeymapSettings("mac"),
        platform: "mac",
        runCommand: (id, context = commandContext) => executeCommand(registry, id, context),
      }),
    ).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    { "workbench.zoomIn": "" },
    { "workbench.zoomIn": "Cmd+I" },
    { "workbench.zoomIn": "Cmd+K Cmd+=" },
    { "editor.save": "Cmd+ž" },
    { "editor.save": "Cmd+=" },
    { "editor.save": "Cmd+= Cmd+S" },
  ])("leaves removals, rebinding, collisions and chord prefixes intact: %j", (overrides) => {
    const { registry, run } = zoomRegistry("workbench.zoomIn");
    const event = keyEvent();
    expect(
      dispatchWorkbenchWindowZoomPhysicalShortcut({
        commandContext,
        commandRegistry: registry,
        event,
        keymap: { ...defaultKeymapSettings("mac"), ...overrides },
        platform: "mac",
        runCommand: (id, context = commandContext) => executeCommand(registry, id, context),
      }),
    ).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not take the shifted plus alias from another binding or chord prefix", () => {
    const { registry, run } = zoomRegistry("workbench.zoomIn");
    for (const shortcut of ["Cmd+Shift+=", "Cmd+Shift+= Cmd+S"]) {
      expect(
        dispatchWorkbenchWindowZoomPhysicalShortcut({
          commandContext,
          commandRegistry: registry,
          event: keyEvent({ shiftKey: true }),
          keymap: { ...defaultKeymapSettings("mac"), "editor.save": shortcut },
          platform: "mac",
          runCommand: (id, context = commandContext) => executeCommand(registry, id, context),
        }),
      ).toBe(false);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("uses Control on non-Mac platforms", () => {
    const { registry, run } = zoomRegistry("workbench.zoomIn");
    expect(
      dispatchWorkbenchWindowZoomPhysicalShortcut({
        commandContext,
        commandRegistry: registry,
        event: keyEvent({ ctrlKey: true, metaKey: false }),
        keymap: defaultKeymapSettings("linux"),
        platform: "linux",
        runCommand: (id, context = commandContext) => executeCommand(registry, id, context),
      }),
    ).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("consumes a disabled registered zoom command", () => {
    const { registry, run } = zoomRegistry("workbench.zoomIn", false);
    const event = keyEvent();
    expect(
      dispatchWorkbenchWindowZoomPhysicalShortcut({
        commandContext,
        commandRegistry: registry,
        event,
        keymap: defaultKeymapSettings("mac"),
        platform: "mac",
        runCommand: (id, context = commandContext) => executeCommand(registry, id, context),
      }),
    ).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("leaves the event alone when the zoom command is missing", () => {
    const event = keyEvent();
    expect(
      dispatchWorkbenchWindowZoomPhysicalShortcut({
        commandContext,
        commandRegistry: new CommandRegistry(),
        event,
        keymap: defaultKeymapSettings("mac"),
        platform: "mac",
        runCommand: () => "missing",
      }),
    ).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe("windowZoomShortcutNeedsCapture", () => {
  it("does not scan unrelated command bindings while typing", () => {
    const readSaveShortcut = vi.fn(() => "Cmd+S");
    const keymap = {
      ...defaultKeymapSettings("mac"),
      get "editor.save"() {
        return readSaveShortcut();
      },
    };
    expect(
      windowZoomShortcutNeedsCapture(
        keymap,
        keyEvent({ code: "KeyX", key: "x", metaKey: false }),
        "mac",
      ),
    ).toBe(false);
    expect(readSaveShortcut).not.toHaveBeenCalled();
  });

  it("captures a rebound single stroke and a zoom chord prefix", () => {
    expect(
      windowZoomShortcutNeedsCapture(
        { ...defaultKeymapSettings("mac"), "workbench.zoomIn": "Cmd+I" },
        keyEvent({ code: "KeyI", key: "i" }),
        "mac",
      ),
    ).toBe(true);
    expect(
      windowZoomShortcutNeedsCapture(
        { ...defaultKeymapSettings("mac"), "workbench.zoomIn": "Cmd+K Cmd+=" },
        keyEvent({ code: "KeyK", key: "k" }),
        "mac",
      ),
    ).toBe(true);
  });

  it("preserves later command priority and unrelated chord prefixes", () => {
    expect(
      windowZoomShortcutNeedsCapture(
        { ...defaultKeymapSettings("mac"), "workbench.openSettings": "Cmd+=" },
        keyEvent({ key: "=" }),
        "mac",
      ),
    ).toBe(false);
    expect(
      windowZoomShortcutNeedsCapture(
        { ...defaultKeymapSettings("mac"), "editor.save": "Cmd+= Cmd+S" },
        keyEvent({ key: "=" }),
        "mac",
      ),
    ).toBe(false);
  });

  it("ignores composing keyboard input", () => {
    expect(
      windowZoomShortcutNeedsCapture(
        defaultKeymapSettings("mac"),
        keyEvent({ isComposing: true, key: "=" }),
        "mac",
      ),
    ).toBe(false);
  });
});
