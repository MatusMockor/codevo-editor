import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { KeyMod } from "monaco-editor/esm/vs/editor/common/services/editorBaseApi.js";
import { KeyCode } from "monaco-editor/esm/vs/editor/common/standalone/standaloneEnums.js";
import { shortcutFromKeyboardEvent } from "../domain/keymap";
import { monacoKeybindingsForShortcut } from "./monacoKeybindings";

const realMonaco = { KeyCode, KeyMod } as unknown as typeof Monaco;

describe("monacoKeybindingsForShortcut", () => {
  it("converts a custom npm command shortcut into a Monaco binding", () => {
    const monaco = {
      KeyCode: { KeyR: 18 },
      KeyMod: { Alt: 1 << 9, CtrlCmd: 1 << 11, Shift: 1 << 10, WinCtrl: 1 << 8 },
    } as unknown as typeof Monaco;

    expect(monacoKeybindingsForShortcut(monaco, "Cmd+Alt+R", "mac")).toEqual([
      18 | (1 << 11) | (1 << 9),
    ]);
    expect(monacoKeybindingsForShortcut(monaco, "", "mac")).toEqual([]);
  });

  it("converts both strokes of a chord with Monaco's sequence encoding", () => {
    const chord = vi.fn((first: number, second: number) => first * 100_000 + second);
    const monaco = {
      KeyCode: { KeyC: 13, KeyK: 21 },
      KeyMod: {
        Alt: 1 << 9,
        chord,
        CtrlCmd: 1 << 11,
        Shift: 1 << 10,
        WinCtrl: 1 << 8,
      },
    } as unknown as typeof Monaco;

    expect(monacoKeybindingsForShortcut(monaco, "Cmd+K Cmd+Shift+C", "mac")).toEqual([
      (21 | (1 << 11)) * 100_000 + (13 | (1 << 11) | (1 << 10)),
    ]);
    expect(chord).toHaveBeenCalledWith(21 | (1 << 11), 13 | (1 << 11) | (1 << 10));
  });

  it("rejects a whole chord when either Monaco stroke is unsupported", () => {
    const chord = vi.fn((first: number, second: number) => first + second);
    const monaco = {
      KeyCode: { KeyK: 21 },
      KeyMod: {
        Alt: 1 << 9,
        chord,
        CtrlCmd: 1 << 11,
        Shift: 1 << 10,
        WinCtrl: 1 << 8,
      },
    } as unknown as typeof Monaco;

    expect(monacoKeybindingsForShortcut(monaco, "Cmd+K Cmd+Home", "mac")).toEqual([]);
    expect(chord).not.toHaveBeenCalled();
  });

  it("maps every key the workbench keymap binds by default, including function keys and punctuation", () => {
    const monaco = {
      KeyCode: {
        Backquote: 91,
        Backslash: 93,
        Digit1: 22,
        F8: 66,
        F11: 69,
        KeyC: 33,
        KeyK: 41,
        Semicolon: 85,
        Tab: 2,
      },
      KeyMod: {
        Alt: 1 << 9,
        chord: (first: number, second: number) => first * 100_000 + second,
        CtrlCmd: 1 << 11,
        Shift: 1 << 10,
        WinCtrl: 1 << 8,
      },
    } as unknown as typeof Monaco;

    expect(monacoKeybindingsForShortcut(monaco, "F8", "mac")).toEqual([66]);
    expect(monacoKeybindingsForShortcut(monaco, "Shift+Alt+F11", "mac")).toEqual([
      69 | (1 << 10) | (1 << 9),
    ]);
    expect(monacoKeybindingsForShortcut(monaco, "Cmd+K Cmd+\\", "mac")).toEqual([
      (41 | (1 << 11)) * 100_000 + (93 | (1 << 11)),
    ]);
    expect(monacoKeybindingsForShortcut(monaco, "Cmd+1", "mac")).toEqual([22 | (1 << 11)]);
    expect(monacoKeybindingsForShortcut(monaco, "Cmd+; C", "mac")).toEqual([
      (85 | (1 << 11)) * 100_000 + 33,
    ]);
    expect(monacoKeybindingsForShortcut(monaco, "Ctrl+Tab", "mac")).toEqual([2 | (1 << 8)]);
    expect(monacoKeybindingsForShortcut(monaco, "Ctrl+`", "linux")).toEqual([91 | (1 << 11)]);
  });
});

describe("monacoKeybindingsForShortcut numpad + equivalence", () => {
  it("registers the numpad + key after the primary = key for a single stroke", () => {
    expect(monacoKeybindingsForShortcut(realMonaco, "Cmd+=", "mac")).toEqual([
      KeyMod.CtrlCmd | KeyCode.Equal,
      KeyMod.CtrlCmd | KeyCode.NumpadAdd,
    ]);
    expect(monacoKeybindingsForShortcut(realMonaco, "Cmd+Shift+=", "mac")).toEqual([
      KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Equal,
      KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.NumpadAdd,
    ]);
    expect(monacoKeybindingsForShortcut(realMonaco, "Ctrl+Alt+=", "linux")).toEqual([
      KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Equal,
      KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.NumpadAdd,
    ]);
    expect(monacoKeybindingsForShortcut(realMonaco, "=", "mac")).toEqual([
      KeyCode.Equal,
      KeyCode.NumpadAdd,
    ]);
  });

  it("expands a chord with = in the first stroke, primary variant first", () => {
    const second = KeyMod.CtrlCmd | KeyCode.KeyK;

    expect(monacoKeybindingsForShortcut(realMonaco, "Cmd+= Cmd+K", "mac")).toEqual([
      KeyMod.chord(KeyMod.CtrlCmd | KeyCode.Equal, second),
      KeyMod.chord(KeyMod.CtrlCmd | KeyCode.NumpadAdd, second),
    ]);
  });

  it("expands a chord with = in the second stroke, primary variant first", () => {
    const first = KeyMod.CtrlCmd | KeyCode.KeyK;

    expect(monacoKeybindingsForShortcut(realMonaco, "Cmd+K Cmd+=", "mac")).toEqual([
      KeyMod.chord(first, KeyMod.CtrlCmd | KeyCode.Equal),
      KeyMod.chord(first, KeyMod.CtrlCmd | KeyCode.NumpadAdd),
    ]);
  });

  it("bounds a chord with = in both strokes to four ordered variants", () => {
    const firstEqual = KeyMod.CtrlCmd | KeyCode.Equal;
    const firstNumpad = KeyMod.CtrlCmd | KeyCode.NumpadAdd;
    const secondEqual = KeyMod.Shift | KeyCode.Equal;
    const secondNumpad = KeyMod.Shift | KeyCode.NumpadAdd;

    const keybindings = monacoKeybindingsForShortcut(realMonaco, "Cmd+= Shift+=", "mac");

    expect(keybindings).toEqual([
      KeyMod.chord(firstEqual, secondEqual),
      KeyMod.chord(firstEqual, secondNumpad),
      KeyMod.chord(firstNumpad, secondEqual),
      KeyMod.chord(firstNumpad, secondNumpad),
    ]);
    expect(new Set(keybindings).size).toBe(4);
  });

  it("leaves every other stroke with exactly one keybinding", () => {
    expect(monacoKeybindingsForShortcut(realMonaco, "Cmd+-", "mac")).toEqual([
      KeyMod.CtrlCmd | KeyCode.Minus,
    ]);
    expect(monacoKeybindingsForShortcut(realMonaco, "Cmd+Alt+-", "mac")).toEqual([
      KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Minus,
    ]);
    expect(monacoKeybindingsForShortcut(realMonaco, "F12", "mac")).toEqual([KeyCode.F12]);
    expect(monacoKeybindingsForShortcut(realMonaco, "Cmd+K Cmd+C", "mac")).toEqual([
      KeyMod.chord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyC),
    ]);
  });

  it("still rejects a shortcut with an unmappable stroke", () => {
    expect(monacoKeybindingsForShortcut(realMonaco, "Cmd+Alt+≠", "mac")).toEqual([]);
    expect(monacoKeybindingsForShortcut(realMonaco, "Cmd+= Cmd+≠", "mac")).toEqual([]);
    expect(monacoKeybindingsForShortcut(realMonaco, "Cmd+≠ Cmd+=", "mac")).toEqual([]);
    expect(monacoKeybindingsForShortcut(realMonaco, "Cmd+constructor", "mac")).toEqual([]);
  });

  it("keeps only the primary keybinding when Monaco exposes no numpad + key code", () => {
    const monaco = {
      KeyCode: { Equal: 86 },
      KeyMod: { Alt: 1 << 9, CtrlCmd: 1 << 11, Shift: 1 << 10, WinCtrl: 1 << 8 },
    } as unknown as typeof Monaco;

    expect(monacoKeybindingsForShortcut(monaco, "Cmd+=", "mac")).toEqual([86 | (1 << 11)]);
  });

  it("maps a recorded macOS Cmd+Option+= chord to a usable Monaco keybinding", () => {
    const recorded = shortcutFromKeyboardEvent({
      altKey: true,
      code: "Equal",
      ctrlKey: false,
      key: "≠",
      metaKey: true,
      shiftKey: false,
    });

    expect(recorded).toBe("Cmd+Alt+=");
    expect(monacoKeybindingsForShortcut(realMonaco, recorded ?? "", "mac")).toEqual([
      KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Equal,
      KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.NumpadAdd,
    ]);
  });

  it("maps a chord recorded with the numpad + key to the numpad Monaco key code", () => {
    const recorded = shortcutFromKeyboardEvent({
      altKey: false,
      code: "NumpadAdd",
      ctrlKey: false,
      key: "+",
      metaKey: true,
      shiftKey: false,
    });

    expect(recorded).toBe("Cmd+=");
    expect(monacoKeybindingsForShortcut(realMonaco, recorded ?? "", "mac")).toContain(
      KeyMod.CtrlCmd | KeyCode.NumpadAdd,
    );
  });
});
