import {
  defaultShortcutForCommand,
  detectKeymapPlatform,
  normalizeShortcutInput,
  normalizeShortcutSequenceInput,
  rebindableKeymapCommands,
  shortcutSequenceForPlatform,
  type KeymapPlatform,
  type RebindableKeymapCommandId,
} from "./keymap";
import { windowZoomDefaultConflictsWithShortcut } from "./windowZoomDefaultConflicts";

export const KEYMAP_DEFAULTS_REVISION = 2;

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
  Object.freeze({ commandId: "editor.fontZoomIn", retiredInRevision: 2, shortcut: "Cmd+=" }),
  Object.freeze({ commandId: "editor.fontZoomOut", retiredInRevision: 2, shortcut: "Cmd+-" }),
  Object.freeze({ commandId: "editor.fontZoomReset", retiredInRevision: 2, shortcut: "Cmd+0" }),
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

  if (appliedRevision < 2) preserveCustomBindingsFromNewZoomDefaults(keymap, platform);

  return { keymap, revision };
}

function preserveCustomBindingsFromNewZoomDefaults(
  keymap: Record<string, unknown>,
  platform: KeymapPlatform,
): void {
  const customShortcuts = rebindableKeymapCommands.flatMap(({ id }) => {
    const value = keymap[id];
    if (typeof value !== "string") return [];
    const shortcut = canonicalShortcut(value);
    const defaultShortcut = defaultShortcutForCommand(id, platform);
    if (!shortcut || shortcutSequenceForPlatform(shortcut, platform) === defaultShortcut) {
      return [];
    }
    return [shortcut];
  });
  for (const id of ["workbench.zoomIn", "workbench.zoomOut", "workbench.zoomReset"] as const) {
    if (typeof keymap[id] === "string") continue;
    if (
      !customShortcuts.some((shortcut) =>
        windowZoomDefaultConflictsWithShortcut(id, shortcut, platform),
      )
    )
      continue;
    keymap[id] = "";
  }
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
