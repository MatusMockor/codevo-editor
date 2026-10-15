import {
  defaultShortcutForCommand,
  detectKeymapPlatform,
  isNewThreadDefaultShortcut,
  keymapCommands,
  normalizeShortcutInput,
  normalizeShortcutSequenceInput,
  restoredNewThreadPickerShortcut,
  shortcutSequenceForPlatform,
  withCloseActiveBindingMigrated,
  type KeymapPlatform,
} from "./keymap";
import { windowZoomDefaultConflictsWithShortcut } from "./windowZoomDefaultConflicts";

export const KEYMAP_DEFAULTS_REVISION = 4;

export interface KeymapDefaultsMigration {
  readonly keymap: unknown;
  readonly revision: number;
}

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

  const keymap = { ...withCloseActiveBindingMigrated(persistedKeymap) };

  if (appliedRevision < 2) preserveCustomBindingsFromNewZoomDefaults(keymap, platform);
  if (appliedRevision < 3) separateNewThreadPickerFromNewThread(keymap, platform);
  if (appliedRevision < 4) retireGitCommitEnterDefault(keymap, platform);

  return { keymap, revision };
}

function preserveCustomBindingsFromNewZoomDefaults(
  keymap: Record<string, unknown>,
  platform: KeymapPlatform,
): void {
  const customShortcuts = keymapCommands.flatMap(({ id }) => {
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

function separateNewThreadPickerFromNewThread(
  keymap: Record<string, unknown>,
  platform: KeymapPlatform,
): void {
  if (!isNewThreadDefaultShortcut(keymap["agent.newThread"], platform)) return;
  if (!isNewThreadDefaultShortcut(keymap["agent.newThreadIn"], platform)) return;
  keymap["agent.newThreadIn"] = restoredNewThreadPickerShortcut(keymap, platform);
}

function retireGitCommitEnterDefault(
  keymap: Record<string, unknown>,
  platform: KeymapPlatform,
): void {
  const value = keymap["git.commit"];
  if (typeof value !== "string") return;
  const retired = platform === "mac" ? ["Cmd+Enter"] : ["Cmd+Enter", "Ctrl+Enter"];
  if (retired.includes(canonicalShortcut(value))) delete keymap["git.commit"];
}

function normalizeKeymapDefaultsRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

function canonicalShortcut(value: string): string {
  return normalizeShortcutSequenceInput(normalizeShortcutInput(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
