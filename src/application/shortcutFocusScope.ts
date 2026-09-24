import { keymapCommandFocusScope, keymapCommands, type KeymapCommandId } from "../domain/keymap";

const ALL_IDS: readonly KeymapCommandId[] = keymapCommands.map((command) => command.id);
const INSIDE_EDITOR_IDS = ALL_IDS.filter((id) => commandActiveForEditorFocus(id, true));
const OUTSIDE_EDITOR_IDS = ALL_IDS.filter((id) => commandActiveForEditorFocus(id, false));

export function commandActiveForEditorFocus(
  commandId: KeymapCommandId,
  editorTextFocused: boolean,
): boolean {
  const scope = keymapCommandFocusScope(commandId);
  if (scope === "editorText") return editorTextFocused;
  if (scope === "outsideEditorText") return !editorTextFocused;
  return true;
}

export function keymapCommandIdsForEditorFocus(
  editorTextFocused: boolean,
): readonly KeymapCommandId[] {
  if (editorTextFocused) return INSIDE_EDITOR_IDS;
  return OUTSIDE_EDITOR_IDS;
}
