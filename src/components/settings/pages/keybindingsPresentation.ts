import {
  defaultShortcutForCommand,
  keymapCommands,
  parseShortcut,
  shortcutForCommand,
  type KeymapCommandId,
  type KeymapPlatform,
  type KeymapSettings,
} from "../../../domain/keymap";
import {
  findKeymapSequenceConflicts,
  shortcutSequenceForPlatform,
} from "../../../domain/shortcutSequence";

export type KeybindingConflictKind = "exact" | "prefix";

export interface KeybindingConflict {
  readonly id: KeymapCommandId;
  readonly kind: KeybindingConflictKind;
  readonly label: string;
}

export interface KeybindingStroke {
  readonly chips: ReadonlyArray<string>;
}

export interface KeybindingViewModel {
  readonly category: string;
  readonly commandId: KeymapCommandId;
  readonly conflictTitle: string | null;
  readonly conflicts: ReadonlyArray<KeybindingConflict>;
  readonly currentShortcut: string;
  readonly defaultShortcut: string;
  readonly label: string;
  readonly modified: boolean;
  readonly rebindable: boolean;
  readonly strokes: ReadonlyArray<KeybindingStroke>;
}

export interface KeybindingCategory {
  readonly bindings: ReadonlyArray<KeybindingViewModel>;
  readonly category: string;
}

const MAC_MODIFIER_GLYPHS: Readonly<Record<string, string>> = {
  Cmd: "⌘",
  Ctrl: "⌃",
  Shift: "⇧",
  Alt: "⌥",
};

const COMMAND_ORDER = new Map<string, number>(
  keymapCommands.map((command, index) => [command.id, index] as const),
);

const COMMAND_LABELS = new Map<string, string>(
  keymapCommands.map((command) => [command.id, command.label] as const),
);

export function keybindingStrokes(
  shortcut: string,
  platform: KeymapPlatform,
): ReadonlyArray<KeybindingStroke> {
  const display = shortcutSequenceForPlatform(shortcut, platform);

  if (display === "") return [];

  return display.split(" ").map((stroke) => ({ chips: strokeChips(stroke, platform) }));
}

export function keybindingConflictTitle(
  conflicts: ReadonlyArray<KeybindingConflict>,
): string | null {
  if (conflicts.length === 0) return null;

  const exact = conflicts.filter((conflict) => conflict.kind === "exact");
  const prefix = conflicts.filter((conflict) => conflict.kind === "prefix");
  const sentences: string[] = [];

  if (exact.length > 0) {
    sentences.push(`Also used by ${exact.map((conflict) => conflict.label).join(", ")}.`);
  }

  if (prefix.length > 0) {
    sentences.push(
      `Shares a first key with ${prefix.map((conflict) => conflict.label).join(", ")}.`,
    );
  }

  return sentences.join(" ");
}

export function keybindingCategories(
  keymap: KeymapSettings,
  platform: KeymapPlatform,
  filter: string,
): ReadonlyArray<KeybindingCategory> {
  const conflictKeymap = platformKeymap(keymap, platform);
  const normalizedFilter = filter.trim().toLowerCase();
  const grouped = new Map<string, KeybindingViewModel[]>();

  for (const command of keymapCommands) {
    const currentShortcut = shortcutForCommand(keymap, command.id, platform);
    const defaultShortcut = defaultShortcutForCommand(command.id, platform);

    if (!matchesKeybindingFilter(command, currentShortcut, defaultShortcut, normalizedFilter)) {
      continue;
    }

    const conflicts = keybindingConflicts(conflictKeymap, command.id);
    const binding: KeybindingViewModel = {
      category: command.category,
      commandId: command.id,
      conflictTitle: keybindingConflictTitle(conflicts),
      conflicts,
      currentShortcut,
      defaultShortcut,
      label: command.label,
      modified: currentShortcut !== defaultShortcut,
      rebindable: !("rebindable" in command),
      strokes: keybindingStrokes(currentShortcut, platform),
    };
    const bucket = grouped.get(command.category);

    if (bucket === undefined) {
      grouped.set(command.category, [binding]);
      continue;
    }

    bucket.push(binding);
  }

  return [...grouped.entries()].map(([category, bindings]) => ({ bindings, category }));
}

export function keybindingCountLabel(categories: ReadonlyArray<KeybindingCategory>): string {
  const count = categories.reduce((total, group) => total + group.bindings.length, 0);

  return `${count} ${count === 1 ? "binding" : "bindings"}`;
}

function keybindingConflicts(
  conflictKeymap: KeymapSettings,
  commandId: KeymapCommandId,
): ReadonlyArray<KeybindingConflict> {
  return findKeymapSequenceConflicts(conflictKeymap, commandId)
    .map((conflict) => {
      const label = COMMAND_LABELS.get(conflict.id);

      return label === undefined ? null : { id: conflict.id, kind: conflict.kind, label };
    })
    .filter((conflict): conflict is KeybindingConflict => conflict !== null)
    .sort(
      (left, right) =>
        (left.kind === "exact" ? 0 : 1) - (right.kind === "exact" ? 0 : 1) ||
        (COMMAND_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (COMMAND_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
}

function platformKeymap(keymap: KeymapSettings, platform: KeymapPlatform): KeymapSettings {
  return Object.fromEntries(
    keymapCommands.map((command) => [
      command.id,
      shortcutSequenceForPlatform(shortcutForCommand(keymap, command.id, platform), platform),
    ]),
  ) as KeymapSettings;
}

function matchesKeybindingFilter(
  command: (typeof keymapCommands)[number],
  currentShortcut: string,
  defaultShortcut: string,
  normalizedFilter: string,
): boolean {
  if (normalizedFilter === "") return true;

  return `${command.label} ${command.category} ${command.id} ${currentShortcut} ${defaultShortcut}`
    .toLowerCase()
    .includes(normalizedFilter);
}

function strokeChips(stroke: string, platform: KeymapPlatform): ReadonlyArray<string> {
  if (parseShortcut(stroke) === null) return [stroke];

  const parts = stroke.split("+");
  const key = parts[parts.length - 1] ?? stroke;
  const mac = platform === "mac";

  return [
    ...parts
      .slice(0, -1)
      .map((modifier) => (mac ? (MAC_MODIFIER_GLYPHS[modifier] ?? modifier) : modifier)),
    key,
  ];
}
