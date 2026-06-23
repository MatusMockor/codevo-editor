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
      "editor.fontZoomIn": "Cmd+=",
      "editor.fontZoomOut": "Cmd+-",
      "editor.fontZoomReset": "Cmd+0",
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
