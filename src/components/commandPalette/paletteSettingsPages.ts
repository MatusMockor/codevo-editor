import type { Command } from "../../application/commandRegistry";
import type { ComposerPaletteModels } from "../../application/commandPalette/commandPaletteProvider";
import {
  COLOR_SCHEME_LABELS,
  COLOR_SCHEME_PREFERENCES,
  PALETTE_IDS,
  PALETTE_LABELS,
  type AppearanceSettings,
  type ColorSchemePreference,
  type ResolvedColorScheme,
} from "../../domain/appearance";
import { paletteTokens } from "../../domain/appearancePalettes";
import {
  paletteGroup as group,
  tokenText,
  type PaletteGlyph,
  type PaletteGroup,
  type PaletteItem,
} from "../../domain/commandPalette/paletteItem";
import { matchesAllTokens } from "../../domain/commandPalette/paletteMatch";
import type { PaletteShortcutGroup } from "./paletteShortcuts";

const SCHEME_GLYPHS: Readonly<Record<ColorSchemePreference, PaletteGlyph>> = {
  system: "monitor",
  light: "sun",
  dark: "moon",
};
const SCHEME_ORDER: readonly ColorSchemePreference[] = ["system", "light", "dark"];

export function modelGroups(
  models: ComposerPaletteModels | null,
  tokens: readonly string[],
): readonly PaletteGroup[] {
  const options = models?.options ?? [];
  const labels = [...new Set(options.map((option) => option.group))];
  return labels.map((label) =>
    group(
      `models:${label}`,
      label,
      options
        .filter((option) => option.group === label)
        .filter((option) => matchesAllTokens([option.label, option.group], tokens))
        .map((option) => ({
          key: `model:${option.key}`,
          intent: { kind: "selectModel", modelKey: option.key },
          icon: { kind: "glyph", glyph: "cpu" },
          title: tokenText(option.label, tokens),
          description: null,
          timestamp: null,
          shortcut: null,
          current: option.current,
          disabled: false,
        })),
    ),
  );
}

export function themeItems(
  appearance: AppearanceSettings,
  resolvedScheme: ResolvedColorScheme,
  tokens: readonly string[],
): readonly PaletteItem[] {
  return PALETTE_IDS.filter((palette) => matchesAllTokens([PALETTE_LABELS[palette]], tokens)).map(
    (palette) => ({
      key: `theme:${palette}`,
      intent: { kind: "setPalette", palette },
      icon: { kind: "swatch", color: paletteTokens(palette, resolvedScheme).accent },
      title: tokenText(PALETTE_LABELS[palette], tokens),
      description: null,
      timestamp: null,
      shortcut: null,
      current: appearance.palette === palette,
      disabled: false,
    }),
  );
}

export function appearanceItems(
  appearance: AppearanceSettings,
  tokens: readonly string[],
): readonly PaletteItem[] {
  return SCHEME_ORDER.filter((scheme) => COLOR_SCHEME_PREFERENCES.includes(scheme))
    .filter((scheme) => matchesAllTokens([COLOR_SCHEME_LABELS[scheme]], tokens))
    .map((scheme) => ({
      key: `appearance:${scheme}`,
      intent: { kind: "setColorScheme", scheme },
      icon: { kind: "glyph", glyph: SCHEME_GLYPHS[scheme] },
      title: tokenText(COLOR_SCHEME_LABELS[scheme], tokens),
      description: null,
      timestamp: null,
      shortcut: null,
      current: appearance.colorScheme === scheme,
      disabled: false,
    }));
}

export function shortcutGroupsView(
  shortcutGroups: readonly PaletteShortcutGroup[],
  commands: readonly Command[],
  tokens: readonly string[],
): readonly PaletteGroup[] {
  const registered = new Set(commands.map((command) => command.id));
  return shortcutGroups.map((shortcutGroup) =>
    group(
      `shortcuts:${shortcutGroup.category}`,
      shortcutGroup.category,
      shortcutGroup.entries
        .filter((entry) => matchesAllTokens([entry.label, entry.category], tokens))
        .map((entry) => ({
          key: `shortcut:${entry.commandId}`,
          intent: { kind: "command", commandId: entry.commandId },
          icon: null,
          title: tokenText(entry.label, tokens),
          description: null,
          timestamp: null,
          shortcut: entry.shortcut,
          current: false,
          disabled: !registered.has(entry.commandId),
        })),
    ),
  );
}
