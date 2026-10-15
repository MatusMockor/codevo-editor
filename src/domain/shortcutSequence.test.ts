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
    "+",
    "Cmd++",
    "Cmd+Shift++",
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

  it.each([
    ["∂", "KeyD", "Cmd+Alt+D"],
    ["Dead", "KeyE", "Cmd+Alt+E"],
  ])("normalizes an Alt-modified %s key through its letter code", (key, code, value) => {
    const event = keyboardEvent({ altKey: true, code, key, metaKey: true });
    const stroke = shortcutStrokeFromKeyboardEvent(event);

    expect(stroke?.value).toBe(value);
    expect(stroke && matchesShortcutStroke(event, stroke, "mac")).toBe(true);
  });

  it("preserves an Alt-modified ASCII key from a non-QWERTY layout", () => {
    const event = keyboardEvent({ altKey: true, code: "KeyQ", key: "a", metaKey: true });
    const stroke = shortcutStrokeFromKeyboardEvent(event);

    expect(stroke?.value).toBe("Cmd+Alt+A");
    expect(stroke && matchesShortcutStroke(event, stroke, "mac")).toBe(true);
  });

  it("preserves AltGr text and accepts a representable transformed delimiter", () => {
    const altGraphEvent = keyboardEvent({
      altKey: true,
      code: "KeyE",
      ctrlKey: true,
      getModifierState: (keyArg) => keyArg === "AltGraph",
      key: "€",
    });
    const command = parseShortcutSequence("Cmd+Alt+E")?.[0];
    const delimiterEvent = keyboardEvent({ altKey: true, code: "KeyD", key: "+", metaKey: true });

    expect(shortcutStrokeFromKeyboardEvent(altGraphEvent)?.value).toBe("Ctrl+Alt+€");
    expect(command && matchesShortcutStroke(altGraphEvent, command, "windows")).toBe(false);
    expect(shortcutStrokeFromKeyboardEvent(delimiterEvent)?.value).toBe("Cmd+Alt+D");
  });

  it.each([
    [{ key: "+", metaKey: true, shiftKey: true }, "Cmd+Shift+="],
    [{ key: "+", metaKey: true }, "Cmd+="],
    [{ ctrlKey: true, key: "+", shiftKey: true }, "Ctrl+Shift+="],
    [{ key: "+" }, "="],
  ])("captures the delimiter key event %j as %s", (init, value) => {
    expect(shortcutStrokeFromKeyboardEvent(keyboardEvent(init))?.value).toBe(value);
  });

  it("matches a delimiter key event against its = stroke only with the same modifiers", () => {
    const zoomIn = parseShortcutSequence("Cmd+=")?.[0];
    const shiftedZoomIn = parseShortcutSequence("Cmd+Shift+=")?.[0];
    const shifted = keyboardEvent({ key: "+", metaKey: true, shiftKey: true });
    const unshifted = keyboardEvent({ key: "+", metaKey: true });
    const linuxShifted = keyboardEvent({ ctrlKey: true, key: "+", shiftKey: true });

    expect(shiftedZoomIn && matchesShortcutStroke(shifted, shiftedZoomIn, "mac")).toBe(true);
    expect(zoomIn && matchesShortcutStroke(shifted, zoomIn, "mac")).toBe(false);
    expect(zoomIn && matchesShortcutStroke(unshifted, zoomIn, "mac")).toBe(true);
    expect(shiftedZoomIn && matchesShortcutStroke(unshifted, shiftedZoomIn, "mac")).toBe(false);
    expect(shiftedZoomIn && matchesShortcutStroke(linuxShifted, shiftedZoomIn, "linux")).toBe(true);
    expect(shiftedZoomIn && matchesShortcutStroke(linuxShifted, shiftedZoomIn, "mac")).toBe(false);
  });

  it.each([
    ["≠", "Equal", "Cmd+Alt+="],
    ["–", "Minus", "Cmd+Alt+-"],
    ["÷", "Slash", "Cmd+Alt+/"],
    ["≤", "Comma", "Cmd+Alt+,"],
    ["≥", "Period", "Cmd+Alt+."],
    ["…", "Semicolon", "Cmd+Alt+;"],
    ["æ", "Quote", "Cmd+Alt+'"],
    ["«", "Backslash", "Cmd+Alt+\\"],
    ["Dead", "Backquote", "Cmd+Alt+`"],
    ["“", "BracketLeft", "Cmd+Alt+["],
    ["‘", "BracketRight", "Cmd+Alt+]"],
  ])("recovers the Alt-transformed %s key through its %s punctuation code", (key, code, value) => {
    const event = keyboardEvent({ altKey: true, code, key, metaKey: true });
    const stroke = shortcutStrokeFromKeyboardEvent(event);

    expect(stroke?.value).toBe(value);
    expect(stroke && matchesShortcutStroke(event, stroke, "mac")).toBe(true);
  });

  it("recovers a Shift+Alt transformed punctuation key with its real modifiers", () => {
    const event = keyboardEvent({
      altKey: true,
      code: "Equal",
      key: "±",
      metaKey: true,
      shiftKey: true,
    });
    const stroke = shortcutStrokeFromKeyboardEvent(event);

    expect(stroke?.value).toBe("Cmd+Shift+Alt+=");
    expect(stroke && matchesShortcutStroke(event, stroke, "mac")).toBe(true);
  });

  it.each([
    [{ altKey: true, code: "Slash", key: "-", metaKey: true }, "Cmd+Alt+-"],
    [{ altKey: true, code: "Equal", key: "=", ctrlKey: true }, "Ctrl+Alt+="],
    [{ altKey: true, code: "Minus", key: "+", metaKey: true }, "Cmd+Alt+="],
    [{ altKey: true, code: "IntlBackslash", key: "≠", metaKey: true }, "Cmd+Alt+≠"],
    [{ altKey: true, code: "", key: "≠", metaKey: true }, "Cmd+Alt+≠"],
    [{ altKey: true, key: "≠", metaKey: true }, "Cmd+Alt+≠"],
    [{ code: "Equal", key: "≠", metaKey: true }, "Cmd+≠"],
    [{ altKey: true, code: "Enter", key: "Enter", metaKey: true }, "Cmd+Alt+Enter"],
    [{ altKey: true, code: "Space", key: " ", metaKey: true }, "Cmd+Alt+Space"],
    [{ altKey: true, code: "KeyD", key: "+", metaKey: true }, "Cmd+Alt+D"],
    [{ altKey: true, code: "Semicolon", key: "a", metaKey: true }, "Cmd+Alt+A"],
  ])("keeps punctuation code recovery out of the event %j", (init, value) => {
    expect(shortcutStrokeFromKeyboardEvent(keyboardEvent(init))?.value).toBe(value);
  });

  it("keeps AltGr text on a punctuation code untouched", () => {
    const event = keyboardEvent({
      altKey: true,
      code: "Equal",
      ctrlKey: true,
      getModifierState: (keyArg) => keyArg === "AltGraph",
      key: "¸",
    });

    expect(shortcutStrokeFromKeyboardEvent(event)?.value).toBe("Ctrl+Alt+¸");
  });

  it("normalizes a macOS Control+Option transformed key", () => {
    const event = keyboardEvent({ altKey: true, code: "KeyD", ctrlKey: true, key: "∂" });
    const stroke = shortcutStrokeFromKeyboardEvent(event);

    expect(stroke?.value).toBe("Ctrl+Alt+D");
    expect(stroke && matchesShortcutStroke(event, stroke, "mac")).toBe(true);
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

  it("resolves a user-bound chord against the default keymap on each platform", () => {
    const linuxKeymap = { ...defaultKeymapSettings("linux"), "agent.goToTurn": "Ctrl+; C" };
    expect(
      lookupKeymapShortcutSequence(linuxKeymap, "Ctrl+; C", ["agent.goToTurn"], "linux"),
    ).toEqual({ exact: ["agent.goToTurn"], prefix: [] });

    const macKeymap = { ...defaultKeymapSettings("mac"), "agent.goToTurn": "Cmd+; C" };
    expect(lookupKeymapShortcutSequence(macKeymap, "Cmd+; C", ["agent.goToTurn"], "mac")).toEqual({
      exact: ["agent.goToTurn"],
      prefix: [],
    });
  });

  it("keeps a bare first stroke reachable through the keydown prefilter", () => {
    const keymap = { ...defaultKeymapSettings("mac"), "app.quit": "A B" };
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
