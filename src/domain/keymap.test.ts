import { describe, expect, it } from "vitest";
import {
  defaultKeymapSettings,
  defaultShortcutForCommand,
  detectKeymapPlatform,
  matchesShortcut,
  normalizeKeymapSettings,
  normalizeShortcutInput,
  parseShortcut,
} from "./keymap";

describe("keymap", () => {
  it("creates defaults for editable shortcuts", () => {
    expect(defaultKeymapSettings("mac")).toMatchObject({
      "class.quickOpen": "Cmd+O",
      "editor.closeTab": "Cmd+W",
      "editor.fileStructure": "Cmd+R",
      "editor.extendSelection": "Alt+ArrowUp",
      "editor.moveStatementUp": "Cmd+Shift+ArrowUp",
      "editor.moveStatementDown": "Cmd+Shift+ArrowDown",
      "editor.moveLineUp": "Shift+Alt+ArrowUp",
      "editor.moveLineDown": "Shift+Alt+ArrowDown",
      "editor.duplicateLine": "Cmd+Shift+D",
      "editor.addSelectionToNextMatch": "Cmd+D",
      "editor.deleteLine": "Cmd+Shift+K",
      "editor.surroundWith": "Cmd+Alt+T",
      "editor.fontZoomIn": "Cmd+=",
      "editor.fontZoomOut": "Cmd+-",
      "editor.fontZoomReset": "Cmd+0",
      "editor.toggleFontLigatures": "",
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
      "workbench.openAppearanceSettings": "",
    });
  });

  it("defaults the recent files switcher to Cmd+E on mac and Ctrl+E elsewhere", () => {
    expect(defaultShortcutForCommand("editor.recentFiles", "mac")).toBe("Cmd+E");
    expect(defaultShortcutForCommand("editor.recentFiles", "linux")).toBe(
      "Ctrl+E",
    );
    expect(defaultKeymapSettings("mac")["editor.recentFiles"]).toBe("Cmd+E");
  });

  it("defaults the TODO panel toggle to the platform primary modifier", () => {
    expect(defaultShortcutForCommand("panel.toggleTodo", "mac")).toBe(
      "Cmd+Shift+T",
    );
    expect(defaultShortcutForCommand("panel.toggleTodo", "linux")).toBe(
      "Ctrl+Shift+T",
    );
    expect(defaultKeymapSettings("mac")["panel.toggleTodo"]).toBe(
      "Cmd+Shift+T",
    );
  });

  it("leaves Go to Test unbound to avoid the Cmd+Shift+T TODO panel collision", () => {
    expect(defaultShortcutForCommand("php.goToTest", "mac")).toBe("");
    expect(defaultShortcutForCommand("php.goToTest", "linux")).toBe("");
    expect(defaultKeymapSettings("mac")["php.goToTest"]).toBe("");
  });

  it("leaves Run All Tests in File unbound by default (palette only)", () => {
    expect(defaultShortcutForCommand("php.runTestFile", "mac")).toBe("");
    expect(defaultShortcutForCommand("php.runTestFile", "linux")).toBe("");
    expect(defaultKeymapSettings("mac")["php.runTestFile"]).toBe("");
  });

  it("defaults complete current statement to Cmd+Shift+Enter on mac and Ctrl+Shift+Enter elsewhere", () => {
    expect(defaultShortcutForCommand("editor.completeStatement", "mac")).toBe(
      "Cmd+Shift+Enter",
    );
    expect(defaultShortcutForCommand("editor.completeStatement", "linux")).toBe(
      "Ctrl+Shift+Enter",
    );
    expect(defaultKeymapSettings("mac")["editor.completeStatement"]).toBe(
      "Cmd+Shift+Enter",
    );
  });

  it("defaults toggle bookmark to F11 on every platform (PhpStorm parity)", () => {
    expect(defaultShortcutForCommand("bookmark.toggle", "mac")).toBe("F11");
    expect(defaultShortcutForCommand("bookmark.toggle", "linux")).toBe("F11");
    expect(defaultShortcutForCommand("bookmark.toggle", "windows")).toBe("F11");
    expect(defaultKeymapSettings("mac")["bookmark.toggle"]).toBe("F11");
  });

  it("defaults show bookmarks panel to Shift+F11 on every platform", () => {
    expect(defaultShortcutForCommand("bookmark.showPanel", "mac")).toBe(
      "Shift+F11",
    );
    expect(defaultShortcutForCommand("bookmark.showPanel", "linux")).toBe(
      "Shift+F11",
    );
    expect(defaultKeymapSettings("mac")["bookmark.showPanel"]).toBe("Shift+F11");
  });

  it("leaves bookmark navigation unbound by default (palette only)", () => {
    expect(defaultShortcutForCommand("bookmark.next", "mac")).toBe("");
    expect(defaultShortcutForCommand("bookmark.previous", "mac")).toBe("");
    expect(defaultKeymapSettings("mac")["bookmark.next"]).toBe("");
    expect(defaultKeymapSettings("mac")["bookmark.previous"]).toBe("");
  });

  it("never assigns the same default shortcut to two commands", () => {
    const defaults = defaultKeymapSettings("mac");
    const assigned = Object.values(defaults).filter(Boolean);

    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("defaults find all references to Shift+F12 on every platform", () => {
    expect(defaultShortcutForCommand("editor.findReferences", "mac")).toBe(
      "Shift+F12",
    );
    expect(defaultShortcutForCommand("editor.findReferences", "linux")).toBe(
      "Shift+F12",
    );
    expect(defaultShortcutForCommand("editor.findReferences", "windows")).toBe(
      "Shift+F12",
    );
    expect(defaultKeymapSettings("mac")["editor.findReferences"]).toBe(
      "Shift+F12",
    );
  });

  it("defaults quick definition to Cmd/Ctrl+Shift+I without colliding with redo", () => {
    expect(defaultShortcutForCommand("editor.quickDefinition", "mac")).toBe(
      "Cmd+Shift+I",
    );
    expect(defaultShortcutForCommand("editor.quickDefinition", "linux")).toBe(
      "Ctrl+Shift+I",
    );
    expect(defaultShortcutForCommand("editor.quickDefinition", "windows")).toBe(
      "Ctrl+Shift+I",
    );
    expect(defaultKeymapSettings("mac")["editor.quickDefinition"]).toBe(
      "Cmd+Shift+I",
    );
  });

  it("defaults the format document shortcut to Shift+Alt+F on every platform", () => {
    expect(defaultShortcutForCommand("editor.formatDocument", "mac")).toBe(
      "Shift+Alt+F",
    );
    expect(defaultShortcutForCommand("editor.formatDocument", "linux")).toBe(
      "Shift+Alt+F",
    );
    expect(defaultShortcutForCommand("editor.formatDocument", "windows")).toBe(
      "Shift+Alt+F",
    );
    expect(defaultKeymapSettings("mac")["editor.formatDocument"]).toBe(
      "Shift+Alt+F",
    );
  });

  it("defaults move statement to Cmd+Shift+Arrow and move line to Shift+Alt+Arrow", () => {
    expect(defaultShortcutForCommand("editor.moveStatementUp", "mac")).toBe(
      "Cmd+Shift+ArrowUp",
    );
    expect(defaultShortcutForCommand("editor.moveStatementUp", "linux")).toBe(
      "Ctrl+Shift+ArrowUp",
    );
    expect(defaultShortcutForCommand("editor.moveStatementDown", "mac")).toBe(
      "Cmd+Shift+ArrowDown",
    );
    expect(defaultShortcutForCommand("editor.moveLineUp", "mac")).toBe(
      "Shift+Alt+ArrowUp",
    );
    expect(defaultShortcutForCommand("editor.moveLineUp", "linux")).toBe(
      "Shift+Alt+ArrowUp",
    );
    expect(defaultShortcutForCommand("editor.moveLineDown", "mac")).toBe(
      "Shift+Alt+ArrowDown",
    );
  });

  it("defaults the editor ergonomics shortcuts to their PhpStorm/VS Code keys", () => {
    expect(defaultShortcutForCommand("editor.duplicateLine", "mac")).toBe(
      "Cmd+Shift+D",
    );
    expect(defaultShortcutForCommand("editor.duplicateLine", "linux")).toBe(
      "Ctrl+Shift+D",
    );
    expect(defaultShortcutForCommand("editor.addSelectionToNextMatch", "mac")).toBe(
      "Cmd+D",
    );
    expect(
      defaultShortcutForCommand("editor.addSelectionToNextMatch", "linux"),
    ).toBe("Ctrl+D");
    expect(defaultShortcutForCommand("editor.deleteLine", "mac")).toBe(
      "Cmd+Shift+K",
    );
    expect(defaultShortcutForCommand("editor.deleteLine", "linux")).toBe(
      "Ctrl+Shift+K",
    );
  });

  it("assigns every default shortcut to at most one command per platform", () => {
    for (const platform of ["mac", "linux", "windows"] as const) {
      const defaults = defaultKeymapSettings(platform);
      const assigned = Object.values(defaults).filter(
        (shortcut) => shortcut.length > 0,
      );
      const unique = new Set(assigned);

      expect(unique.size).toBe(assigned.length);
    }
  });

  it("matches the format document shortcut against Shift+Alt+F", () => {
    expect(
      matchesShortcut(
        keyEvent({ key: "f", altKey: true, shiftKey: true }),
        "Shift+Alt+F",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "f", altKey: true }), "Shift+Alt+F"),
    ).toBe(false);
  });

  it("uses Ctrl defaults on non-Mac platforms", () => {
    expect(defaultShortcutForCommand("editor.save", "linux")).toBe("Ctrl+S");
    expect(defaultShortcutForCommand("editor.save", "windows")).toBe("Ctrl+S");
    expect(defaultShortcutForCommand("editor.save", "mac")).toBe("Cmd+S");
    expect(defaultShortcutForCommand("editor.fontZoomIn", "linux")).toBe(
      "Ctrl+=",
    );
    expect(defaultShortcutForCommand("editor.fontZoomOut", "linux")).toBe(
      "Ctrl+-",
    );
    expect(defaultShortcutForCommand("editor.fontZoomReset", "linux")).toBe(
      "Ctrl+0",
    );
    expect(defaultKeymapSettings("linux")).toMatchObject({
      "class.quickOpen": "Ctrl+O",
      "editor.closeTab": "Ctrl+W",
      "editor.fileStructure": "Ctrl+R",
      "editor.fontZoomIn": "Ctrl+=",
      "editor.fontZoomOut": "Ctrl+-",
      "editor.fontZoomReset": "Ctrl+0",
      "editor.goToDefinition": "Ctrl+B",
      "file.quickOpen": "Ctrl+P",
      "navigation.back": "Ctrl+[",
      "navigation.forward": "Ctrl+]",
    });
    expect(defaultKeymapSettings("linux")["terminal.show"]).toBe("Ctrl+`");
  });

  it("matches the font zoom shortcuts against the platform primary modifier", () => {
    expect(
      matchesShortcut(keyEvent({ key: "=", metaKey: true }), "Cmd+=", "mac"),
    ).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "-", metaKey: true }), "Cmd+-", "mac"),
    ).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "0", metaKey: true }), "Cmd+0", "mac"),
    ).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "=", ctrlKey: true }), "Cmd+=", "linux"),
    ).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "0", metaKey: true }), "Cmd+0", "linux"),
    ).toBe(false);
  });

  it("normalizes persisted keymaps and keeps unknown values out", () => {
    expect(
      normalizeKeymapSettings({
        "editor.save": "command + s",
        "file.quickOpen": "",
        "navigation.back": "cmd+[",
        unknown: "Cmd+X",
      }, "mac"),
    ).toMatchObject({
      "editor.save": "Cmd+S",
      "file.quickOpen": "",
      "navigation.back": "Cmd+[",
    });
  });

  it("migrates persisted Mac defaults to Ctrl on non-Mac platforms", () => {
    expect(
      normalizeKeymapSettings(
        {
          "editor.save": "Cmd+S",
          "editor.closeTab": "Cmd+W",
          "editor.goToImplementation": "Cmd+Alt+B",
          "editor.quickFix": "Alt+Enter",
          "terminal.show": "Ctrl+`",
        },
        "linux",
      ),
    ).toMatchObject({
      "editor.save": "Ctrl+S",
      "editor.closeTab": "Ctrl+W",
      "editor.goToImplementation": "Ctrl+Alt+B",
      "editor.quickFix": "Alt+Enter",
      "terminal.show": "Ctrl+`",
    });
    expect(
      normalizeKeymapSettings({ "editor.save": "Cmd+Shift+S" }, "linux")[
        "editor.save"
      ],
    ).toBe("Cmd+Shift+S");
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
    expect(
      matchesShortcut(keyEvent({ key: "[", metaKey: true }), "Cmd+[", "mac"),
    ).toBe(true);
    expect(
      matchesShortcut(
        keyEvent({ key: "f", metaKey: true, shiftKey: true }),
        "Cmd+Shift+F",
        "mac",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        keyEvent({ key: "f", metaKey: true }),
        "Cmd+Shift+F",
        "mac",
      ),
    ).toBe(false);
    expect(matchesShortcut(keyEvent({ key: "Enter", altKey: true }), "Alt+Enter")).toBe(
      true,
    );
    expect(matchesShortcut(keyEvent({ key: "Enter", altKey: true }), "")).toBe(
      false,
    );
  });

  it("matches Cmd shortcuts against the platform primary modifier", () => {
    expect(
      matchesShortcut(keyEvent({ key: "s", ctrlKey: true }), "Cmd+S", "linux"),
    ).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "s", metaKey: true }), "Cmd+S", "linux"),
    ).toBe(false);
    expect(
      matchesShortcut(keyEvent({ key: "s", metaKey: true }), "Cmd+S", "mac"),
    ).toBe(true);
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

  it("detects mac, windows, and linux platforms from navigator fields", () => {
    expect(
      detectKeymapPlatform({
        platform: "MacIntel",
        userAgent: "Mozilla/5.0",
      }),
    ).toBe("mac");
    expect(
      detectKeymapPlatform({
        platform: "Win32",
        userAgent: "Mozilla/5.0",
      }),
    ).toBe("windows");
    expect(
      detectKeymapPlatform({
        platform: "Linux x86_64",
        userAgent: "Mozilla/5.0",
      }),
    ).toBe("linux");
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
