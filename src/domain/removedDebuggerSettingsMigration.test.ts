import { describe, expect, it } from "vitest";
import { defaultKeymapSettings, isKeymapCommandId, normalizeKeymapSettings } from "./keymap";
import { normalizeAppSettings, normalizeWorkspaceSession } from "./settings";

const REMOVED_DEBUGGER_KEYMAP_OVERRIDES = {
  "debug.start": "F6",
  "debug.runWithoutDebugging": "Ctrl+F6",
  "debug.stop": "Shift+F6",
  "debug.toggleBreakpoint": "F9",
  "debug.stepOver": "F10",
  "debug.setVariable": "Enter",
  "editor.debug.action.toggleInlineBreakpoint": "Shift+F9",
  "workbench.action.debug.disconnect": "Shift+F5",
  "testing.debugAtCursor": "Cmd+; Cmd+C",
} as const;

describe("removed debugger settings migration", () => {
  it("no longer knows any debugger command id", () => {
    for (const id of Object.keys(REMOVED_DEBUGGER_KEYMAP_OVERRIDES)) {
      expect(isKeymapCommandId(id)).toBe(false);
    }
  });

  it("ignores stored overrides for removed debugger ids and keeps kept overrides", () => {
    const keymap = normalizeKeymapSettings(
      { ...REMOVED_DEBUGGER_KEYMAP_OVERRIDES, "editor.save": "Cmd+Alt+S" },
      "mac",
    );

    expect(keymap).toEqual({ ...defaultKeymapSettings("mac"), "editor.save": "Cmd+Alt+S" });
    for (const id of Object.keys(REMOVED_DEBUGGER_KEYMAP_OVERRIDES)) {
      expect(Object.prototype.hasOwnProperty.call(keymap, id)).toBe(false);
    }
  });

  it("loads an old settings blob that still carries debugger keymap overrides", () => {
    const settings = normalizeAppSettings({
      editorFontSize: 15,
      keymap: { ...REMOVED_DEBUGGER_KEYMAP_OVERRIDES, "editor.save": "Cmd+Alt+S" },
    });

    expect(settings.editorFontSize).toBe(15);
    expect(settings.keymap).toEqual({ ...defaultKeymapSettings(), "editor.save": "Cmd+Alt+S" });
  });

  it("restores a stale debug bottom panel session view as Problems", () => {
    expect(
      normalizeWorkspaceSession({ bottomPanelView: "debug", sidebarView: "git", version: 1 })
        .bottomPanelView,
    ).toBe("problems");
  });
});
