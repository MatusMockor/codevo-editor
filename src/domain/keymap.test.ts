import { describe, expect, it } from "vitest";
import {
  defaultKeymapSettings,
  matchesShortcut,
  normalizeKeymapSettings,
  normalizeShortcutInput,
  parseShortcut,
} from "./keymap";

describe("keymap", () => {
  it("creates defaults for editable shortcuts", () => {
    expect(defaultKeymapSettings()).toMatchObject({
      "class.quickOpen": "Cmd+O",
      "editor.closeTab": "Cmd+W",
      "editor.fileStructure": "Cmd+R",
      "editor.extendSelection": "Alt+ArrowUp",
      "editor.goToDeclaration": "",
      "editor.goToDefinition": "Cmd+B",
      "editor.goToSourceDefinition": "",
      "editor.goToSymbol": "Cmd+T",
      "editor.goToTypeDefinition": "",
      "editor.nextProblem": "F8",
      "editor.previousProblem": "Shift+F8",
      "editor.quickFix": "Alt+Enter",
      "file.quickOpen": "Cmd+P",
      "navigation.back": "Cmd+[",
      "navigation.forward": "Cmd+]",
    });
  });

  it("normalizes persisted keymaps and keeps unknown values out", () => {
    expect(
      normalizeKeymapSettings({
        "editor.save": "command + s",
        "file.quickOpen": "",
        "navigation.back": "cmd+[",
        unknown: "Cmd+X",
      }),
    ).toMatchObject({
      "editor.save": "Cmd+S",
      "file.quickOpen": "",
      "navigation.back": "Cmd+[",
    });
  });

  it("parses shortcuts and matches keyboard events exactly", () => {
    expect(parseShortcut("Cmd+Shift+F")).toEqual({
      alt: false,
      ctrl: false,
      key: "f",
      meta: true,
      shift: true,
    });
    expect(normalizeShortcutInput("option + return")).toBe("Alt+Enter");
    expect(matchesShortcut(keyEvent({ key: "[", metaKey: true }), "Cmd+[")).toBe(
      true,
    );
    expect(
      matchesShortcut(keyEvent({ key: "f", metaKey: true, shiftKey: true }), "Cmd+Shift+F"),
    ).toBe(true);
    expect(matchesShortcut(keyEvent({ key: "f", metaKey: true }), "Cmd+Shift+F")).toBe(
      false,
    );
    expect(matchesShortcut(keyEvent({ key: "Enter", altKey: true }), "Alt+Enter")).toBe(
      true,
    );
    expect(matchesShortcut(keyEvent({ key: "Enter", altKey: true }), "")).toBe(
      false,
    );
  });

  it("matches the next and previous problem function keys", () => {
    expect(matchesShortcut(keyEvent({ key: "F8" }), "F8")).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "F8", shiftKey: true }), "Shift+F8"),
    ).toBe(true);
    expect(matchesShortcut(keyEvent({ key: "F8", shiftKey: true }), "F8")).toBe(
      false,
    );
    expect(matchesShortcut(keyEvent({ key: "F8" }), "Shift+F8")).toBe(false);
  });
});

function keyEvent(
  overrides: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">>,
): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}
