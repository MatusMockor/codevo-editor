import {
  defaultShortcutForCommand,
  detectKeymapPlatform,
  normalizeShortcutInput,
  normalizeShortcutSequenceInput,
  shortcutSequenceForPlatform,
  type KeymapPlatform,
  type RebindableKeymapCommandId,
} from "./keymap";

export const KEYMAP_DEFAULTS_REVISION = 1;

export interface KeymapDefaultsMigration {
  readonly keymap: unknown;
  readonly revision: number;
}

interface RetiredKeymapDefault {
  readonly commandId: RebindableKeymapCommandId;
  readonly retiredInRevision: number;
  readonly shortcut: string;
}

const RETIRED_KEYMAP_DEFAULTS: readonly RetiredKeymapDefault[] = Object.freeze([
  Object.freeze({ commandId: "editor.foldAll", retiredInRevision: 1, shortcut: "Cmd+Shift+-" }),
  Object.freeze({ commandId: "editor.unfoldAll", retiredInRevision: 1, shortcut: "Cmd+Shift+=" }),
]);

export function migrateRetiredKeymapDefaults(
  persistedKeymap: unknown,
  persistedRevision: unknown,
  platform: KeymapPlatform = detectKeymapPlatform(),
): KeymapDefaultsMigration {
  const appliedRevision = normalizeKeymapDefaultsRevision(persistedRevision);
  const revision = Math.max(appliedRevision, KEYMAP_DEFAULTS_REVISION);

  if (!isRecord(persistedKeymap)) {
    return { keymap: persistedKeymap, revision };
  }

  const keymap = { ...persistedKeymap };
  for (const retired of RETIRED_KEYMAP_DEFAULTS) {
    if (retired.retiredInRevision <= appliedRevision) continue;
    if (!isRetiredDefault(persistedKeymap[retired.commandId], retired, platform)) continue;
    keymap[retired.commandId] = defaultShortcutForCommand(retired.commandId, platform);
  }

  return { keymap, revision };
}

function normalizeKeymapDefaultsRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

function isRetiredDefault(
  persistedShortcut: unknown,
  retired: RetiredKeymapDefault,
  platform: KeymapPlatform,
): boolean {
  if (typeof persistedShortcut !== "string") return false;

  const shortcut = canonicalShortcut(persistedShortcut);
  return (
    shortcut === retired.shortcut ||
    shortcut === shortcutSequenceForPlatform(retired.shortcut, platform)
  );
}

function canonicalShortcut(value: string): string {
  return normalizeShortcutSequenceInput(normalizeShortcutInput(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
