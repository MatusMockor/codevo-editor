import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { monacoKeybindingsForShortcut } from "./monacoKeybindings";

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
