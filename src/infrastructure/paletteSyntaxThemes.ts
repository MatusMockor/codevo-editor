import {
  PALETTE_IDS,
  RESOLVED_COLOR_SCHEMES,
  type PaletteId,
  type ResolvedColorScheme,
} from "../domain/appearance";
import { EDITOR_EXTRA_COLORS } from "../domain/appearanceEditorColors";
import { paletteTokens, surfaceColor } from "../domain/appearancePalettes";
import { cssColorToHex } from "../domain/cssColor";
import { paletteMonacoTheme } from "../domain/editorColorThemes";
import type { ThemePalette } from "../components/themePalettes";

export function paletteSyntaxTheme(palette: PaletteId, scheme: ResolvedColorScheme): ThemePalette {
  const tokens = paletteTokens(palette, scheme);
  const side = surfaceColor(palette, scheme, "side");
  return {
    name: paletteMonacoTheme(palette, scheme),
    base: scheme === "dark" ? "vs-dark" : "vs",
    bg: surfaceColor(palette, scheme, "canvas"),
    fg: tokens.fg,
    lineHighlight: side,
    selection: cssColorToHex(tokens.selection),
    cursor: tokens.accent,
    lineNumber: tokens.fgSubtle,
    lineNumberActive: tokens.fgMuted,
    whitespace: tokens.s4,
    widgetBg: tokens.popBg,
    border: cssColorToHex(tokens.hairStrong),
    selectedBg: tokens.s3,
    selectedFg: tokens.fgStrong,
    accent: tokens.accent,
    inputBg: side,
    diffInserted: cssColorToHex(tokens.addBg),
    diffRemoved: cssColorToHex(tokens.delBg),
    keyword: tokens.synKw,
    func: tokens.accent,
    type: tokens.warn,
    string: tokens.synStr,
    number: tokens.synNum,
    variable: tokens.fg,
    parameter: tokens.fg,
    property: tokens.fg,
    constant: tokens.synNum,
    operator: tokens.fgMuted,
    comment: tokens.synCom,
    commentItalic: true,
    namespace: tokens.fgMuted,
    regexp: tokens.synStr,
    decorator: tokens.synKw,
    findMatch: cssColorToHex(EDITOR_EXTRA_COLORS[scheme].matchCurrent),
    findMatchHighlight: cssColorToHex(EDITOR_EXTRA_COLORS[scheme].match),
    peekBackground: surfaceColor(palette, scheme, "raised"),
    peekBorder: cssColorToHex(tokens.hairStrong),
    overviewAdded: cssColorToHex(tokens.ok),
    overviewModified: cssColorToHex(EDITOR_EXTRA_COLORS[scheme].gitModified),
    overviewDeleted: cssColorToHex(tokens.danger),
  };
}

export const PALETTE_SYNTAX_THEMES: readonly ThemePalette[] = PALETTE_IDS.flatMap((palette) =>
  RESOLVED_COLOR_SCHEMES.map((scheme) => paletteSyntaxTheme(palette, scheme)),
);
