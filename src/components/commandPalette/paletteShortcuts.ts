import {
  keymapCommands,
  shortcutForCommand,
  type KeymapPlatform,
  type KeymapSettings,
} from "../../domain/keymap";
import { keybindingStrokes } from "../settings/pages/keybindingsPresentation";

const CATEGORY_PRIORITY: readonly string[] = [
  "Workbench",
  "Agent",
  "File",
  "Search",
  "Git",
  "Terminal",
  "Editor",
];

export interface PaletteShortcutEntry {
  readonly commandId: string;
  readonly label: string;
  readonly shortcut: string;
  readonly category: string;
}

export interface PaletteShortcutGroup {
  readonly category: string;
  readonly entries: readonly PaletteShortcutEntry[];
}

export function formatShortcutLabel(shortcut: string, platform: KeymapPlatform): string | null {
  const strokes = keybindingStrokes(shortcut, platform);
  if (strokes.length === 0) return null;
  const joiner = platform === "mac" ? "" : "+";
  return strokes.map((stroke) => stroke.chips.join(joiner)).join(" ");
}

export function paletteShortcutGroups(
  keymap: KeymapSettings,
  platform: KeymapPlatform,
): readonly PaletteShortcutGroup[] {
  const grouped = new Map<string, PaletteShortcutEntry[]>();
  for (const command of keymapCommands) {
    const shortcut = formatShortcutLabel(
      shortcutForCommand(keymap, command.id, platform),
      platform,
    );
    if (shortcut === null) continue;
    const bucket = grouped.get(command.category) ?? [];
    bucket.push({
      commandId: command.id,
      label: command.label,
      shortcut,
      category: command.category,
    });
    grouped.set(command.category, bucket);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => categoryRank(left) - categoryRank(right))
    .map(([category, entries]) => ({ category, entries }));
}

function categoryRank(category: string): number {
  const index = CATEGORY_PRIORITY.indexOf(category);
  if (index < 0) return CATEGORY_PRIORITY.length;
  return index;
}
