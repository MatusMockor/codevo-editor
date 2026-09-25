import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PALETTE_IDS, type PaletteId, type ResolvedColorScheme } from "../domain/appearance";
import { paletteSyntaxTheme } from "../infrastructure/paletteSyntaxThemes";
import { calmDark, calmLight } from "./themePalettes";

const PALETTES_CSS_PATH = fileURLToPath(new URL("../ui/tokens/palettes.css", import.meta.url));
const SEMANTIC_CSS_PATH = fileURLToPath(new URL("../ui/tokens/semantic.css", import.meta.url));
const palettesCss = readFileSync(PALETTES_CSS_PATH, "utf8");
const semanticCss = readFileSync(SEMANTIC_CSS_PATH, "utf8");

describe("Monaco palette parity with the app canvas", () => {
  it.each(PALETTE_IDS)("keeps the %s dark editor theme on the dark canvas tone", (palette) => {
    expect(paletteSyntaxTheme(palette, "dark").bg.toLowerCase()).toBe(
      declaredCanvas(palette, "dark"),
    );
  });

  it.each(PALETTE_IDS)("keeps the %s light editor theme on the light canvas tone", (palette) => {
    expect(paletteSyntaxTheme(palette, "light").bg.toLowerCase()).toBe(
      declaredCanvas(palette, "light"),
    );
  });

  it("uses the primary accent for the caret in both calm palettes", () => {
    expect(calmDark.cursor).toBe(calmDark.accent);
    expect(calmLight.cursor).toBe(calmLight.accent);
  });

  it("selects with a translucent primary wash", () => {
    expect(calmDark.selection.toLowerCase()).toBe(`${calmDark.accent.toLowerCase()}38`);
    expect(calmLight.selection.toLowerCase()).toBe(`${calmLight.accent.toLowerCase()}38`);
  });

  it("raises widgets above the canvas", () => {
    expect(calmDark.widgetBg).not.toBe(calmDark.bg);
    expect(calmLight.widgetBg).not.toBe(calmLight.bg);
    expect(calmDark.border).toBe(calmDark.widgetBg);
    expect(calmLight.border).toBe(calmLight.widgetBg);
  });
});

function declaredCanvas(palette: PaletteId, scheme: ResolvedColorScheme): string {
  const surface = declarationIn(semanticCss, `:root[data-cv-scheme="${scheme}"] {`, "--cv-canvas");
  const step = /^var\((--cv-s[0-9])\)$/.exec(surface);
  expect(step, `--cv-canvas is not a surface step in the ${scheme} scheme`).not.toBeNull();

  const hex = declarationIn(
    palettesCss,
    `:root[data-cv-palette="${palette}"][data-cv-scheme="${scheme}"] {`,
    step?.[1] ?? "",
  );
  expect(hex, `${palette} ${scheme} canvas is not a hex colour`).toMatch(/^#[0-9a-fA-F]{6}$/);

  return hex.toLowerCase();
}

function declarationIn(css: string, selector: string, property: string): string {
  const selectorStart = css.indexOf(selector);
  expect(selectorStart, `selector ${selector} not found`).toBeGreaterThanOrEqual(0);
  const blockEnd = css.indexOf("\n}", selectorStart);
  expect(blockEnd).toBeGreaterThan(selectorStart);
  const block = css.slice(selectorStart, blockEnd);
  const match = new RegExp(`\\n\\s*${property}:\\s*([^;]+);`).exec(block);
  expect(match, `${property} not declared in ${selector}`).not.toBeNull();

  return match?.[1]?.trim() ?? "";
}
