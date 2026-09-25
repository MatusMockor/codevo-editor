import {
  keymapCommands,
  normalizeShortcutSequenceInput,
  parseShortcutSequence,
  shortcutForCommand,
  type KeymapCommandId,
  type KeymapPlatform,
  type KeymapSettings,
  type ShortcutStroke,
} from "../domain/keymap";
import { commandActiveForEditorFocus } from "./shortcutFocusScope";
import { FOCUS_SCOPED_COMMAND_IDS } from "./workbenchShortcutCommandDispatcher";

export interface EditorKeymapCommandBinding {
  readonly shortcut: string;
  readonly commandIds: readonly KeymapCommandId[];
}

const PRIORITY_ORDERED_COMMAND_IDS: readonly KeymapCommandId[] = keymapCommands
  .map((command) => command.id)
  .reverse();
const FUNCTION_KEY = /^f\d{1,2}$/;

export function planEditorKeymapCommandBindings(
  keymap: KeymapSettings,
  platform: KeymapPlatform,
  editorOwnedCommandIds: ReadonlySet<KeymapCommandId>,
): readonly EditorKeymapCommandBinding[] {
  const shortcutOf = (commandId: KeymapCommandId) =>
    normalizeShortcutSequenceInput(shortcutForCommand(keymap, commandId, platform));
  const ownedShortcuts = new Set([...editorOwnedCommandIds].map(shortcutOf));
  const commandIdsByShortcut = new Map<string, KeymapCommandId[]>();

  for (const commandId of PRIORITY_ORDERED_COMMAND_IDS) {
    if (!bridgeableCommand(commandId, editorOwnedCommandIds)) continue;
    const shortcut = shortcutOf(commandId);
    if (!shortcut || ownedShortcuts.has(shortcut) || !safeInsideEditorText(shortcut)) continue;
    const commandIds = commandIdsByShortcut.get(shortcut) ?? [];
    commandIds.push(commandId);
    commandIdsByShortcut.set(shortcut, commandIds);
  }

  return [...commandIdsByShortcut].map(([shortcut, commandIds]) =>
    Object.freeze({ shortcut, commandIds: Object.freeze(commandIds) }),
  );
}

function bridgeableCommand(
  commandId: KeymapCommandId,
  editorOwnedCommandIds: ReadonlySet<KeymapCommandId>,
): boolean {
  return (
    commandActiveForEditorFocus(commandId, true) &&
    !FOCUS_SCOPED_COMMAND_IDS.has(commandId) &&
    !editorOwnedCommandIds.has(commandId)
  );
}

function safeInsideEditorText(shortcut: string): boolean {
  const firstStroke = parseShortcutSequence(shortcut)?.[0];
  if (!firstStroke) return false;
  return strokeHasCommandModifier(firstStroke) || FUNCTION_KEY.test(firstStroke.key);
}

function strokeHasCommandModifier(stroke: ShortcutStroke): boolean {
  return stroke.meta || stroke.ctrl || stroke.alt;
}
