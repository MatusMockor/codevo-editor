import { describe, expect, it } from "vitest";
import {
  CLASSIC_SYNTAX_THEME_IDS,
  COLOR_SCHEME_ATTRIBUTE,
  COLOR_SCHEME_LABELS,
  COLOR_SCHEME_PREFERENCES,
  DEFAULT_APPEARANCE,
  PALETTE_ATTRIBUTE,
  PALETTE_IDS,
  PALETTE_LABELS,
  SYNTAX_THEME_IDS,
  SYNTAX_THEME_LABELS,
  isColorSchemePreference,
  isPaletteId,
  isSyntaxThemeId,
  normalizeAppearance,
  resolveColorScheme,
} from "./appearance";

describe("appearance ids", () => {
  it("defaults to Graphite · Teal, system chrome and the palette syntax theme", () => {
    expect(DEFAULT_APPEARANCE).toEqual({
      palette: "graphite-teal",
      colorScheme: "system",
      syntaxTheme: "matchPalette",
    });
    expect(PALETTE_LABELS[DEFAULT_APPEARANCE.palette]).toBe("Graphite · Teal");
  });

  it("lists the six approved palettes in order", () => {
    expect(PALETTE_IDS.map((id) => PALETTE_LABELS[id])).toEqual([
      "Graphite · Teal",
      "Slate · Blue",
      "Black · Violet",
      "Ink · Mint",
      "Zinc · Orange",
      "Carbon · Lime",
    ]);
  });

  it("labels every scheme and syntax theme exactly once", () => {
    expect(COLOR_SCHEME_PREFERENCES.map((id) => COLOR_SCHEME_LABELS[id])).toEqual([
      "System",
      "Dark",
      "Light",
    ]);
    expect(new Set(SYNTAX_THEME_IDS).size).toBe(CLASSIC_SYNTAX_THEME_IDS.length + 1);
    expect(SYNTAX_THEME_IDS[0]).toBe("matchPalette");
    expect(SYNTAX_THEME_LABELS.matchPalette).toBe("Match palette");
    expect(SYNTAX_THEME_IDS.every((id) => SYNTAX_THEME_LABELS[id].length > 0)).toBe(true);
  });

  it("names the document attributes the stylesheets key on", () => {
    expect(PALETTE_ATTRIBUTE).toBe("data-cv-palette");
    expect(COLOR_SCHEME_ATTRIBUTE).toBe("data-cv-scheme");
  });

  it("rejects values outside the closed unions", () => {
    expect(isPaletteId("graphite-teal")).toBe(true);
    expect(isColorSchemePreference("system")).toBe(true);
    expect(isSyntaxThemeId("dracula")).toBe(true);
    for (const value of ["Graphite", "graphite_teal", "", null, 1, "constructor", "__proto__"]) {
      expect(isPaletteId(value)).toBe(false);
      expect(isColorSchemePreference(value)).toBe(false);
      expect(isSyntaxThemeId(value)).toBe(false);
    }
  });
});

describe("resolveColorScheme", () => {
  it("resolves system from the platform preference and keeps explicit schemes", () => {
    expect(resolveColorScheme("system", true)).toBe("light");
    expect(resolveColorScheme("system", false)).toBe("dark");
    expect(resolveColorScheme("dark", true)).toBe("dark");
    expect(resolveColorScheme("light", false)).toBe("light");
  });
});

describe("normalizeAppearance", () => {
  it("keeps a valid persisted appearance", () => {
    const appearance = { palette: "ink-mint", colorScheme: "system", syntaxTheme: "oneLight" };

    expect(normalizeAppearance(appearance, undefined)).toEqual(appearance);
  });

  it("falls back per field instead of discarding the whole appearance", () => {
    expect(
      normalizeAppearance({ palette: "ink-mint", colorScheme: "sepia", syntaxTheme: 7 }, undefined),
    ).toEqual({ palette: "ink-mint", colorScheme: "system", syntaxTheme: "matchPalette" });
  });

  it("prefers the persisted appearance over the legacy theme", () => {
    expect(
      normalizeAppearance(
        { palette: "slate-blue", colorScheme: "light", syntaxTheme: "matchPalette" },
        "dracula",
      ),
    ).toEqual({ palette: "slate-blue", colorScheme: "light", syntaxTheme: "matchPalette" });
  });

  it("migrates every legacy theme id to the default palette", () => {
    const cases = [
      ["dark", "dark", "matchPalette"],
      ["light", "light", "matchPalette"],
      ["system", "system", "matchPalette"],
      ["ayuMirage", "dark", "ayuMirage"],
      ["materialDeepOcean", "dark", "materialDeepOcean"],
      ["oneDarkPro", "dark", "oneDarkPro"],
      ["dracula", "dark", "dracula"],
      ["catppuccinMocha", "dark", "catppuccinMocha"],
      ["catppuccinLatte", "light", "catppuccinLatte"],
      ["oneLight", "light", "oneLight"],
      ["darkPlus", "dark", "darkPlus"],
    ] as const;

    for (const [legacy, colorScheme, syntaxTheme] of cases) {
      expect(normalizeAppearance(undefined, legacy), legacy).toEqual({
        palette: "graphite-teal",
        colorScheme,
        syntaxTheme,
      });
    }
  });

  it("falls back to the default for unknown, prototype and non-string legacy values", () => {
    for (const legacy of ["solarized", "constructor", "__proto__", "toString", 42, null, {}]) {
      expect(normalizeAppearance(undefined, legacy)).toEqual(DEFAULT_APPEARANCE);
    }
  });

  it("treats arrays, null and prototype-only records as a missing appearance", () => {
    expect(normalizeAppearance([], "light")).toEqual({
      palette: "graphite-teal",
      colorScheme: "light",
      syntaxTheme: "matchPalette",
    });
    expect(normalizeAppearance(null, undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(
      normalizeAppearance(JSON.parse('{"__proto__":{"palette":"ink-mint"}}'), undefined),
    ).toEqual(DEFAULT_APPEARANCE);
  });
});
