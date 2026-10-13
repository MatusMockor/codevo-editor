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
  const keybindings = sequence.map((stroke) =>
    monacoKeybindingsForStroke(monaco, stroke, platform),
  );

  const first = keybindings[0];
  if (first === undefined || first.length === 0) return [];
  const second = keybindings[1];
  if (second === undefined) return [...first];
  return first.flatMap((firstKeybinding) =>
    second.map((secondKeybinding) => monaco.KeyMod.chord(firstKeybinding, secondKeybinding)),
  );
}

function monacoKeybindingsForStroke(
  monaco: typeof Monaco,
  stroke: ShortcutStroke,
  platform: KeymapPlatform,
): readonly number[] {
  const primary = monacoKeybindingForStroke(
    monaco,
    stroke,
    platform,
    monacoKeyCode(monaco, stroke.key),
  );
  if (primary === null) return [];

  const equivalent = monacoKeybindingForStroke(
    monaco,
    stroke,
    platform,
    monacoEquivalentKeyCode(monaco, stroke.key),
  );
  if (equivalent === null) return [primary];
  return [primary, equivalent];
}

function monacoKeybindingForStroke(
  monaco: typeof Monaco,
  stroke: ShortcutStroke,
  platform: KeymapPlatform,
  keyCode: number | null,
): number | null {
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

function monacoEquivalentKeyCode(monaco: typeof Monaco, key: string): number | null {
  const keyCodeName = EQUIVALENT_KEY_CODE_NAMES.get(key);
  return keyCodeName ? (monaco.KeyCode[keyCodeName] ?? null) : null;
}

function monacoKeyCodeName(key: string): keyof typeof Monaco.KeyCode | null {
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}` as keyof typeof Monaco.KeyCode;
  if (/^[0-9]$/.test(key)) return `Digit${key}` as keyof typeof Monaco.KeyCode;
  if (/^f(?:[1-9]|1\d|2[0-4])$/.test(key)) return key.toUpperCase() as keyof typeof Monaco.KeyCode;
  return SPECIAL_KEY_CODE_NAMES[key] ?? null;
}

const EQUIVALENT_KEY_CODE_NAMES: ReadonlyMap<string, keyof typeof Monaco.KeyCode> = new Map([
  ["=", "NumpadAdd"],
]);

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
