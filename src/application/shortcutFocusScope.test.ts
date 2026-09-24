import { describe, expect, it } from "vitest";
import { commandActiveForEditorFocus, keymapCommandIdsForEditorFocus } from "./shortcutFocusScope";

describe("shortcut focus scope", () => {
  it("activates palette commands only outside editor text and chords only inside", () => {
    expect(commandActiveForEditorFocus("palette.open", false)).toBe(true);
    expect(commandActiveForEditorFocus("palette.open", true)).toBe(false);
    expect(commandActiveForEditorFocus("editor.splitDown", true)).toBe(true);
    expect(commandActiveForEditorFocus("editor.splitDown", false)).toBe(false);
    expect(commandActiveForEditorFocus("editor.save", true)).toBe(true);
  });

  it("returns stable filtered id lists per focus state", () => {
    const inside = keymapCommandIdsForEditorFocus(true);
    const outside = keymapCommandIdsForEditorFocus(false);
    expect(inside).toBe(keymapCommandIdsForEditorFocus(true));
    expect(inside).not.toContain("palette.shortcuts");
    expect(outside).toContain("palette.shortcuts");
    expect(outside).not.toContain("editor.closeGroup");
  });
});
