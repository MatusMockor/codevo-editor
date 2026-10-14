import {
  defaultShortcutForCommand,
  detectKeymapPlatform,
  lookupKeymapShortcutSequence,
  matchesShortcut,
  normalizeShortcutInput,
  shortcutForCommand,
  shortcutSequenceForPlatform,
  type KeymapCommandId,
  type KeymapPlatform,
  type KeymapSettings,
} from "./keymap";

export interface KeymapDefaultAlias {
  readonly commandId: KeymapCommandId;
  readonly shortcut: string;
}

const KEYMAP_DEFAULT_ALIASES: readonly KeymapDefaultAlias[] = Object.freeze([
  Object.freeze({ commandId: "workbench.zoomIn", shortcut: "Cmd+Shift+=" }),
]);

export function keymapDefaultAliases(
  platform: KeymapPlatform = detectKeymapPlatform(),
): readonly KeymapDefaultAlias[] {
  return KEYMAP_DEFAULT_ALIASES.map((alias) => ({
    commandId: alias.commandId,
    shortcut: shortcutSequenceForPlatform(alias.shortcut, platform),
  }));
}

export function keymapDefaultAliasIsActive(
  keymap: KeymapSettings,
  alias: KeymapDefaultAlias,
  platform: KeymapPlatform = detectKeymapPlatform(),
): boolean {
  if (!commandUsesDefaultShortcut(keymap, alias.commandId, platform)) return false;

  const owners = lookupKeymapShortcutSequence(keymap, alias.shortcut, undefined, platform);
  return owners.exact.length === 0 && owners.prefix.length === 0;
}

export function keymapDefaultAliasCommandIdsForEvent(
  keymap: KeymapSettings,
  event: KeyboardEvent,
  platform: KeymapPlatform = detectKeymapPlatform(),
): readonly KeymapCommandId[] {
  return keymapDefaultAliases(platform)
    .filter((alias) => matchesShortcut(event, alias.shortcut, platform))
    .filter((alias) => keymapDefaultAliasIsActive(keymap, alias, platform))
    .map((alias) => alias.commandId);
}

function commandUsesDefaultShortcut(
  keymap: KeymapSettings,
  commandId: KeymapCommandId,
  platform: KeymapPlatform,
): boolean {
  return (
    normalizeShortcutInput(shortcutForCommand(keymap, commandId, platform)) ===
    defaultShortcutForCommand(commandId, platform)
  );
}
