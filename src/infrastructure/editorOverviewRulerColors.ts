import { EDITOR_EXTRA_COLORS } from "../domain/appearanceEditorColors";
import type { ResolvedColorScheme } from "../domain/appearance";
import { cssColorToHex } from "../domain/cssColor";

export const OVERVIEW_RULER_ADDED = "editorOverviewRuler.addedForeground";
export const OVERVIEW_RULER_MODIFIED = "editorOverviewRuler.modifiedForeground";
export const OVERVIEW_RULER_DELETED = "editorOverviewRuler.deletedForeground";

const DEFAULT_CHANGE_COLORS: Readonly<
  Record<ResolvedColorScheme, Readonly<Record<string, string>>>
> = {
  dark: {
    [OVERVIEW_RULER_ADDED]: "#2ea043",
    [OVERVIEW_RULER_MODIFIED]: cssColorToHex(EDITOR_EXTRA_COLORS.dark.gitModified),
    [OVERVIEW_RULER_DELETED]: "#f85149",
  },
  light: {
    [OVERVIEW_RULER_ADDED]: "#1a7f37",
    [OVERVIEW_RULER_MODIFIED]: cssColorToHex(EDITOR_EXTRA_COLORS.light.gitModified),
    [OVERVIEW_RULER_DELETED]: "#cf222e",
  },
};

export function withOverviewRulerChangeColors(
  colors: Readonly<Record<string, string>> | undefined,
  scheme: ResolvedColorScheme,
): Record<string, string> {
  return { ...DEFAULT_CHANGE_COLORS[scheme], ...colors };
}
