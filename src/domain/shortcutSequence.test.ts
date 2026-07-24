import { describe, expect, it } from "vitest";
import { collectBareKeyShortcutKeys, defaultKeymapSettings } from "./keymap";
import {
  findKeymapSequenceConflicts,
  lookupKeymapShortcutSequence,
  matchesShortcutStroke,
  normalizeShortcutSequenceInput,
  parseShortcutSequence,
  shortcutSequenceForPlatform,
  shortcutStrokeFromKeyboardEvent,
} from "./shortcutSequence";

describe("shortcutSequence", () => {
  it("strictly parses and canonically orders one or two strokes", () => {
    expect(normalizeShortcutSequenceInput(" control+shift+k   ctrl+C ")).toBe(
      "Ctrl+Shift+K Ctrl+C",
    );
    expect(parseShortcutSequence("Cmd+K Cmd+C")?.map((stroke) => stroke.value)).toEqual([
      "Cmd+K",
      "Cmd+C",
    ]);
    expect(normalizeShortcutSequenceInput("F8")).toBe("F8");
  });

  it.each([
    "",
    "Cmd",
    "Cmd+",
    "+K",
    "Cmd++K",
    "Cmd+Cmd+K",
    "Cmd+Wat+K",
    "Cmd+K Cmd+C Cmd+X",
    "Cmd+K\nCmd+C\nCmd+X",
    "Cmd+K+C",
    "Cmd+💥boom",
    "Cmd+K\u0000",
    `Cmd+${"K".repeat(100)}`,
  ])("rejects malformed or ambiguous input %j", (value) => {
    expect(parseShortcutSequence(value)).toBeNull();
    expect(normalizeShortcutSequenceInput(value)).toBe("");
  });

  it("maps primary modifiers stroke-by-stroke without inventing Ctrl", () => {
    expect(shortcutSequenceForPlatform("Cmd+K Cmd+C", "linux")).toBe("Ctrl+K Ctrl+C");
    expect(shortcutSequenceForPlatform("Alt+K Shift+F8", "windows")).toBe("Alt+K Shift+F8");
    expect(shortcutSequenceForPlatform("Cmd+Ctrl+K", "linux")).toBe("Ctrl+K");
    expect(shortcutSequenceForPlatform("Cmd+K", "mac")).toBe("Cmd+K");
  });

  it("captures and platform-matches a single event stroke", () => {
    const event = keyboardEvent({ key: "k", metaKey: true });
    const stroke = shortcutStrokeFromKeyboardEvent(event);
    expect(stroke?.value).toBe("Cmd+K");
    expect(stroke && matchesShortcutStroke(event, stroke, "mac")).toBe(true);
    expect(
      stroke && matchesShortcutStroke(keyboardEvent({ ctrlKey: true, key: "K" }), stroke, "linux"),
    ).toBe(true);
    expect(
      shortcutStrokeFromKeyboardEvent(keyboardEvent({ key: "Meta", metaKey: true })),
    ).toBeNull();
  });

  it("looks up exact and prefix owners in reverse command order", () => {
    const keymap = {
      comment: "Cmd+K Cmd+C",
      duplicate: "Cmd+K Cmd+C",
      leader: "Cmd+K",
      other: "Cmd+L",
    };

    expect(
      lookupKeymapShortcutSequence(keymap, "Cmd+K", ["comment", "duplicate", "leader", "other"]),
    ).toEqual({ exact: ["leader"], prefix: ["duplicate", "comment"] });
    expect(
      lookupKeymapShortcutSequence(keymap, "Cmd+K Cmd+C", [
        "comment",
        "duplicate",
        "leader",
        "other",
      ]),
    ).toEqual({ exact: ["duplicate", "comment"], prefix: [] });
  });

  it.each(["linux", "windows"] as const)(
    "matches a synced Cmd chord against Ctrl events on %s",
    (platform) => {
      const keymap = { custom: "Cmd+K Cmd+C" };
      expect(lookupKeymapShortcutSequence(keymap, "Ctrl+K", ["custom"], platform)).toEqual({
        exact: [],
        prefix: ["custom"],
      });
      expect(lookupKeymapShortcutSequence(keymap, "Ctrl+K Ctrl+C", ["custom"], platform)).toEqual({
        exact: ["custom"],
        prefix: [],
      });
    },
  );

  it("keeps Cmd and explicit Ctrl distinct on macOS but equivalent on non-mac", () => {
    const keymap = { command: "Cmd+K Cmd+C", control: "Ctrl+K Ctrl+C" };
    expect(
      lookupKeymapShortcutSequence(keymap, "Ctrl+K Ctrl+C", ["command", "control"], "mac"),
    ).toEqual({ exact: ["control"], prefix: [] });
    expect(
      lookupKeymapShortcutSequence(keymap, "Ctrl+K Ctrl+C", ["command", "control"], "linux"),
    ).toEqual({ exact: ["control", "command"], prefix: [] });
  });

  it("platform-normalizes default-style and custom chord conflicts", () => {
    const keymap = { custom: "Ctrl+; Ctrl+C", default: "Cmd+; Cmd+C" };
    expect(findKeymapSequenceConflicts(keymap, "default", "windows")).toEqual([
      { id: "custom", kind: "exact" },
    ]);
    expect(findKeymapSequenceConflicts(keymap, "default", "mac")).toEqual([]);
  });

  it("resolves the official Debug Test at Cursor chord on each platform", () => {
    const linuxKeymap = defaultKeymapSettings("linux");
    expect(
      lookupKeymapShortcutSequence(
        linuxKeymap,
        "Ctrl+; Ctrl+C",
        ["testing.debugAtCursor"],
        "linux",
      ),
    ).toEqual({ exact: ["testing.debugAtCursor"], prefix: [] });

    const macKeymap = defaultKeymapSettings("mac");
    expect(
      lookupKeymapShortcutSequence(macKeymap, "Cmd+; Cmd+C", ["testing.debugAtCursor"], "mac"),
    ).toEqual({ exact: ["testing.debugAtCursor"], prefix: [] });
  });

  it("keeps a bare first stroke reachable through the keydown prefilter", () => {
    const keymap = { ...defaultKeymapSettings("mac"), "editor.save": "A B" };
    expect(collectBareKeyShortcutKeys(keymap).has("a")).toBe(true);
  });

  it("distinguishes exact duplicate and prefix ambiguity conflicts", () => {
    const keymap = {
      child: "Cmd+K Cmd+C",
      duplicate: "Cmd+K",
      leader: "Cmd+K",
      unrelated: "Cmd+L",
    };
    expect(findKeymapSequenceConflicts(keymap, "leader")).toEqual([
      { id: "child", kind: "prefix" },
      { id: "duplicate", kind: "exact" },
    ]);
    expect(findKeymapSequenceConflicts(keymap, "unrelated")).toEqual([]);
  });

  it("freezes parsed values so callers cannot mutate a live keymap token", () => {
    const sequence = parseShortcutSequence("Cmd+K Cmd+C");
    expect(Object.isFrozen(sequence)).toBe(true);
    expect(Object.isFrozen(sequence?.[0])).toBe(true);
  });
});

function keyboardEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}
