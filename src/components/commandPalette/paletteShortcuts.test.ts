import { describe, expect, it } from "vitest";
import { defaultKeymapSettings } from "../../domain/keymap";
import { formatShortcutLabel, paletteShortcutGroups } from "./paletteShortcuts";

describe("formatShortcutLabel", () => {
  it("renders mac glyphs joined and other platforms with plus signs", () => {
    expect(formatShortcutLabel("Cmd+Shift+P", "mac")).toBe("⌘⇧P");
    expect(formatShortcutLabel("Cmd+K Cmd+\\", "mac")).toBe("⌘K ⌘\\");
    expect(formatShortcutLabel("Cmd+Shift+P", "linux")).toBe("Ctrl+Shift+P");
    expect(formatShortcutLabel("", "mac")).toBeNull();
  });
});

describe("paletteShortcutGroups", () => {
  it("lists bound commands grouped by category with Workbench and Agent first", () => {
    const groups = paletteShortcutGroups(defaultKeymapSettings("mac"), "mac");
    expect(groups[0]?.category).toBe("Workbench");
    expect(groups[1]?.category).toBe("Agent");
    const workbench = groups[0]?.entries.map((entry) => entry.label) ?? [];
    expect(workbench).toContain("Open Command Palette");
    expect(groups.flatMap((group) => group.entries).every((entry) => entry.shortcut !== "")).toBe(
      true,
    );
  });

  it("reflects user rebinding", () => {
    const keymap = { ...defaultKeymapSettings("mac"), "palette.open": "Cmd+Alt+K" };
    const entry = paletteShortcutGroups(keymap, "mac")
      .flatMap((group) => group.entries)
      .find((candidate) => candidate.commandId === "palette.open");
    expect(entry?.shortcut).toBe("⌘⌥K");
  });
});
