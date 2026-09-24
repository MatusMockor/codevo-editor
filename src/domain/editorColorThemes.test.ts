import { describe, expect, it } from "vitest";
import { CLASSIC_SYNTAX_THEME_IDS, PALETTE_IDS, RESOLVED_COLOR_SCHEMES } from "./appearance";
import { surfaceColor } from "./appearancePalettes";
import {
  classicMonacoTheme,
  classicTerminalTheme,
  paletteMonacoTheme,
  paletteTerminalTheme,
  resolveEditorColorThemes,
  type TerminalTheme,
} from "./editorColorThemes";
import { contrastRatio } from "./themeContrast";

const TERMINAL_TEXT_KEYS = [
  "black",
  "blue",
  "brightBlack",
  "brightBlue",
  "brightCyan",
  "brightGreen",
  "brightMagenta",
  "brightRed",
  "brightWhite",
  "brightYellow",
  "cyan",
  "foreground",
  "green",
  "magenta",
  "red",
  "white",
  "yellow",
] as const satisfies readonly (keyof TerminalTheme)[];

describe("resolveEditorColorThemes", () => {
  it("follows the palette and the resolved scheme for Match palette", () => {
    const system = {
      palette: "ink-mint",
      colorScheme: "system",
      syntaxTheme: "matchPalette",
    } as const;

    expect(resolveEditorColorThemes(system, true)).toMatchObject({
      colorScheme: "light",
      monacoTheme: "cv-ink-mint-light",
    });
    expect(resolveEditorColorThemes(system, false)).toMatchObject({
      colorScheme: "dark",
      monacoTheme: "cv-ink-mint-dark",
    });
    expect(resolveEditorColorThemes(system, false).terminalTheme).toEqual(
      paletteTerminalTheme("ink-mint", "dark"),
    );
  });

  it("keeps a classic syntax theme independent of the chrome scheme", () => {
    const themes = resolveEditorColorThemes(
      { palette: "slate-blue", colorScheme: "light", syntaxTheme: "dracula" },
      false,
    );

    expect(themes.colorScheme).toBe("light");
    expect(themes.monacoTheme).toBe("dracula");
    expect(themes.terminalTheme).toEqual(classicTerminalTheme("dracula"));
  });
});

describe("classic editor themes", () => {
  it("maps every classic syntax theme to its registered Monaco theme", () => {
    expect(CLASSIC_SYNTAX_THEME_IDS.map(classicMonacoTheme)).toEqual([
      "calm-dark",
      "calm-light",
      "ayu-mirage",
      "material-deep-ocean",
      "one-dark-pro",
      "dracula",
      "catppuccin-mocha",
      "catppuccin-latte",
      "one-light",
      "dark-plus",
    ]);
  });

  it("keeps the terminal palettes that shipped before the redesign", () => {
    expect(classicTerminalTheme("classicDark").background).toBe("#111418");
    expect(classicTerminalTheme("classicDark").foreground).toBe("#d8dee9");
    expect(classicTerminalTheme("classicLight").background).toBe("#f4f6f8");
    expect(classicTerminalTheme("classicLight").foreground).toBe("#263240");
    expect(classicTerminalTheme("ayuMirage").background).toBe("#1f2430");
    expect(classicTerminalTheme("materialDeepOcean").background).toBe("#0f111a");
    expect(classicTerminalTheme("darkPlus")).toMatchObject({
      background: "#1e1e1e",
      foreground: "#cccccc",
    });
  });
});

describe("palette editor themes", () => {
  it("names one Monaco theme per palette and scheme", () => {
    expect(paletteMonacoTheme("carbon-lime", "light")).toBe("cv-carbon-lime-light");
  });

  it("paints the terminal on the palette canvas", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        expect(paletteTerminalTheme(palette, scheme).background).toBe(
          surfaceColor(palette, scheme, "canvas"),
        );
      }
    }
  });

  it("keeps every palette terminal and the AA-checked classic terminals readable", () => {
    const themes = [
      ...CLASSIC_SYNTAX_THEME_IDS.filter((theme) => theme !== "darkPlus").map(classicTerminalTheme),
      ...PALETTE_IDS.flatMap((palette) =>
        RESOLVED_COLOR_SCHEMES.map((scheme) => paletteTerminalTheme(palette, scheme)),
      ),
    ];
    const failures = themes.flatMap((theme) =>
      TERMINAL_TEXT_KEYS.filter((key) => contrastRatio(theme[key], theme.background) < 4.5).map(
        (key) => `${key} ${theme[key]} on ${theme.background}`,
      ),
    );

    expect(failures).toEqual([]);
  });
});
