import { describe, expect, it } from "vitest";
import { PALETTE_IDS, RESOLVED_COLOR_SCHEMES } from "../domain/appearance";
import { surfaceColor } from "../domain/appearancePalettes";
import { paletteMonacoTheme } from "../domain/editorColorThemes";
import { contrastRatio } from "../domain/themeContrast";
import type { ThemePalette } from "../components/themePalettes";
import { PALETTE_SYNTAX_THEMES, paletteSyntaxTheme } from "./paletteSyntaxThemes";

const READABLE_KEYS = [
  "fg",
  "keyword",
  "func",
  "type",
  "string",
  "number",
  "variable",
  "parameter",
  "property",
  "constant",
  "operator",
  "comment",
  "namespace",
  "regexp",
  "decorator",
] as const satisfies readonly (keyof ThemePalette)[];

describe("palette syntax themes", () => {
  it("registers one theme per palette and scheme", () => {
    expect(PALETTE_SYNTAX_THEMES.map((theme) => theme.name)).toEqual(
      PALETTE_IDS.flatMap((palette) =>
        RESOLVED_COLOR_SCHEMES.map((scheme) => paletteMonacoTheme(palette, scheme)),
      ),
    );
  });

  it("paints the editor on the palette canvas with the matching Monaco base", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        const theme = paletteSyntaxTheme(palette, scheme);
        expect(theme.bg).toBe(surfaceColor(palette, scheme, "canvas"));
        expect(theme.base).toBe(scheme === "dark" ? "vs-dark" : "vs");
      }
    }
  });

  it("uses only hex colours Monaco can parse", () => {
    for (const theme of PALETTE_SYNTAX_THEMES) {
      for (const [key, value] of Object.entries(theme)) {
        if (key === "name" || key === "base" || typeof value !== "string") continue;
        expect(value, `${theme.name} ${key}`).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
      }
    }
  });

  it("keeps every syntax colour readable on the editor background", () => {
    const failures = PALETTE_SYNTAX_THEMES.flatMap((theme) =>
      READABLE_KEYS.filter((key) => contrastRatio(theme[key], theme.bg) < 4.5).map(
        (key) => `${theme.name} ${key}`,
      ),
    );

    expect(failures).toEqual([]);
  });
});
