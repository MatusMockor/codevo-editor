import type * as Monaco from "monaco-editor";
import type { KeymapPlatform } from "../domain/keymap";
import { parseShortcutSequence, type ShortcutStroke } from "../domain/shortcutSequence";

export function monacoKeybindingsForShortcut(
  monaco: typeof Monaco,
  shortcut: string,
  platform: KeymapPlatform,
): number[] {
  const sequence = parseShortcutSequence(shortcut);
  if (!sequence) return [];
  const keybindings = sequence.map((stroke) => monacoKeybindingForStroke(monaco, stroke, platform));
  if (keybindings.some((keybinding) => keybinding === null)) return [];

  const first = keybindings[0];
  if (first === null || first === undefined) return [];
  const second = keybindings[1];
  return second === null || second === undefined ? [first] : [monaco.KeyMod.chord(first, second)];
}

function monacoKeybindingForStroke(
  monaco: typeof Monaco,
  stroke: ShortcutStroke,
  platform: KeymapPlatform,
): number | null {
  const keyCode = monacoKeyCode(monaco, stroke.key);
  if (!keyCode) return null;

  let keybinding = keyCode;
  const primaryModifier = platform === "mac" ? stroke.meta : stroke.meta || stroke.ctrl;
  const controlModifier = platform === "mac" ? stroke.ctrl : false;
  if (primaryModifier) keybinding |= monaco.KeyMod.CtrlCmd;
  if (controlModifier) keybinding |= monaco.KeyMod.WinCtrl ?? monaco.KeyMod.CtrlCmd;
  if (stroke.alt) keybinding |= monaco.KeyMod.Alt;
  if (stroke.shift) keybinding |= monaco.KeyMod.Shift;
  return keybinding;
}

function monacoKeyCode(monaco: typeof Monaco, key: string): number | null {
  if (/^[a-z]$/.test(key)) {
    return monaco.KeyCode[`Key${key.toUpperCase()}` as keyof typeof monaco.KeyCode] ?? null;
  }
  const specialKeyCodes: Record<string, keyof typeof monaco.KeyCode> = {
    ",": "Comma",
    ".": "Period",
    "-": "Minus",
    "/": "Slash",
    "=": "Equal",
    "`": "Backquote",
    "[": "BracketLeft",
    "]": "BracketRight",
    arrowdown: "DownArrow",
    arrowleft: "LeftArrow",
    arrowright: "RightArrow",
    arrowup: "UpArrow",
    enter: "Enter",
    escape: "Escape",
    f12: "F12",
    f2: "F2",
    f5: "F5",
  };
  const keyCodeName = specialKeyCodes[key];
  return keyCodeName ? (monaco.KeyCode[keyCodeName] ?? null) : null;
}
