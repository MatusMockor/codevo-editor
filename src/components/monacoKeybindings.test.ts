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
});
