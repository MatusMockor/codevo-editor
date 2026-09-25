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
  const keyCodeName = monacoKeyCodeName(key);
  return keyCodeName ? (monaco.KeyCode[keyCodeName] ?? null) : null;
}

function monacoKeyCodeName(key: string): keyof typeof Monaco.KeyCode | null {
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}` as keyof typeof Monaco.KeyCode;
  if (/^[0-9]$/.test(key)) return `Digit${key}` as keyof typeof Monaco.KeyCode;
  if (/^f(?:[1-9]|1\d|2[0-4])$/.test(key)) return key.toUpperCase() as keyof typeof Monaco.KeyCode;
  return SPECIAL_KEY_CODE_NAMES[key] ?? null;
}

const SPECIAL_KEY_CODE_NAMES: Readonly<Record<string, keyof typeof Monaco.KeyCode>> = {
  "'": "Quote",
  ",": "Comma",
  ".": "Period",
  "-": "Minus",
  "/": "Slash",
  ";": "Semicolon",
  "=": "Equal",
  "\\": "Backslash",
  "`": "Backquote",
  "[": "BracketLeft",
  "]": "BracketRight",
  arrowdown: "DownArrow",
  arrowleft: "LeftArrow",
  arrowright: "RightArrow",
  arrowup: "UpArrow",
  backspace: "Backspace",
  delete: "Delete",
  enter: "Enter",
  escape: "Escape",
  space: "Space",
  tab: "Tab",
};
