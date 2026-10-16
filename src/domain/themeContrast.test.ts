import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLASSIC_SYNTAX_THEME_IDS, PALETTE_IDS, RESOLVED_COLOR_SCHEMES } from "./appearance";
import { paletteTokens, surfaceColor } from "./appearancePalettes";
import { SCHEME_SHELL_STATES, compositeOver } from "../test/appearanceShellStates";
import { classicTerminalTheme, type TerminalTheme } from "./appColorThemes";
import { contrastRatio } from "../test/themeContrast";

const minimumTextContrast = 4.5;
const runtimeStyleTokens = new Set([
  "--bottom-panel-height",
  "--git-history-file-depth",
  "--minimap-distance",
  "--minimap-strip",
  "--structure-indent",
  "--tree-level",
]);
const terminalTextColorKeys = [
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
] as const;

describe("contrastRatio", () => {
  it("returns WCAG contrast ratios for two hex colors", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#777777", "#ffffff")).toBeGreaterThan(4.4);
  });

  it("keeps tree active states readable in every palette and scheme", () => {
    const appCss = readFileSync("src/agentApp.css", "utf8");
    const active = cssBlock(appCss, ".tree-row.active");

    expect(cssDeclaration(active, "background")).toBe("var(--cv-row-active)");
    expect(cssDeclaration(active, "color")).toBe("var(--cv-fg-strong)");
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        const tokens = paletteTokens(palette, scheme);
        for (const role of ["canvas", "side"] as const) {
          const fill =
            scheme === "light"
              ? surfaceColor(palette, scheme, "raised")
              : compositeOver(SCHEME_SHELL_STATES.dark.tint3, surfaceColor(palette, scheme, role));
          expect(
            contrastRatio(tokens.fgStrong, fill),
            `${palette}/${scheme}: active text on row-active over ${role} ${fill}`,
          ).toBeGreaterThanOrEqual(minimumTextContrast);
        }
      }
    }
  });

  it("keeps selected settings chips readable in every palette and scheme", () => {
    const settingsCss = readFileSync("src/components/settings/settings.css", "utf8");
    const selected = cssBlock(settingsCss, '.settings-chip[data-state="on"]');

    expect(cssDeclaration(selected, "background")).toBe("var(--cv-accent-soft)");
    expect(cssDeclaration(selected, "color")).toBe("var(--cv-fg-strong)");
    expect(cssDeclaration(selected, "box-shadow")).toBe("var(--cv-ring-selected)");
    const selectedHover = cssBlock(
      settingsCss,
      '.settings-chip[data-state="on"]:hover:not(:disabled)',
    );
    expect(cssDeclaration(selectedHover, "background")).toBe("var(--cv-accent-soft)");
    expect(cssDeclaration(selectedHover, "color")).toBe("var(--cv-fg-strong)");
    const selectedFocus = cssBlock(
      settingsCss,
      '.settings-screen .settings-chip[data-state="on"]:focus-visible',
    );
    expect(cssDeclaration(selectedFocus, "box-shadow")).toBe(
      "var(--cv-ring-selected), var(--cv-ring-focus)",
    );
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        const tokens = paletteTokens(palette, scheme);
        for (const role of ["canvas", "side", "raised"] as const) {
          const fill = compositeRgba(tokens.accentSoft, surfaceColor(palette, scheme, role));
          expect(
            contrastRatio(tokens.fgStrong, fill),
            `${palette}/${scheme}: selected chip text on accent-soft over ${role} ${fill}`,
          ).toBeGreaterThanOrEqual(minimumTextContrast);
        }
      }
    }
  });

  it("keeps terminal text colors readable in app themes", () => {
    for (const theme of CLASSIC_SYNTAX_THEME_IDS.filter((id) => id !== "darkPlus")) {
      expectTerminalThemeContrast(classicTerminalTheme(theme));
    }
  });
});

describe("accent fill pairing", () => {
  const primaryHoverSheets = [
    ["src/components/settings/settings.css", ".settings-btn--primary:hover:not(:disabled)"],
    [
      "src/components/toastNotification.css",
      ".toast-notification-action--primary:hover:not(:disabled)",
    ],
  ] as const;

  it("keeps on-accent text readable on the accent fill in every palette and scheme", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        const tokens = paletteTokens(palette, scheme);
        expect(
          contrastRatio(tokens.onAccent, tokens.accentFill),
          `${palette}/${scheme}: on-accent ${tokens.onAccent} on accent-fill ${tokens.accentFill}`,
        ).toBeGreaterThanOrEqual(minimumTextContrast);
      }
    }
  });

  it("rejects the plain accent as a background for on-accent text", () => {
    const unreadable = PALETTE_IDS.flatMap((palette) =>
      RESOLVED_COLOR_SCHEMES.filter((scheme) => {
        const tokens = paletteTokens(palette, scheme);
        return contrastRatio(tokens.onAccent, tokens.accent) < minimumTextContrast;
      }).map((scheme) => `${palette}/${scheme}`),
    );

    expect(unreadable).toEqual(
      expect.arrayContaining([
        "slate-blue/dark",
        "black-violet/dark",
        "ink-mint/light",
        "zinc-orange/light",
        "carbon-lime/light",
      ]),
    );
  });

  it("keeps on-accent text readable on the primary hover fill in every palette and scheme", () => {
    for (const [sheet, selector] of primaryHoverSheets) {
      const background = cssDeclaration(
        cssBlock(readFileSync(sheet, "utf8"), selector),
        "background",
      );
      const match = /^color-mix\(in srgb, var\(--[\w-]+\) (\d+)%, var\(--[\w-]+\)\)$/.exec(
        background,
      );
      expect(match, `${selector}: ${background}`).not.toBeNull();
      const weight = Number(match?.[1] ?? "0") / 100;
      for (const palette of PALETTE_IDS) {
        for (const scheme of RESOLVED_COLOR_SCHEMES) {
          const tokens = paletteTokens(palette, scheme);
          const hover = mixHex(tokens.accentFill, tokens.fgStrong, weight);
          expect(
            contrastRatio(tokens.onAccent, hover),
            `${selector} ${palette}/${scheme}: on-accent on hover fill ${hover}`,
          ).toBeGreaterThanOrEqual(minimumTextContrast);
        }
      }
    }
  });
});

describe("custom properties", () => {
  it("references only declared or runtime-set custom properties", () => {
    const definedTokens = new Set<string>();
    const usedTokens = new Set<string>();

    for (const file of sourceFiles("src")) {
      const source = readFileSync(file, "utf8");
      if (extname(file) === ".css") {
        for (const match of source.matchAll(/^\s*(--[\w-]+)\s*:/gm)) {
          definedTokens.add(match[1]);
        }
      }
      for (const match of source.matchAll(/var\(\s*(--[\w-]+)/g)) {
        usedTokens.add(match[1]);
      }
    }

    expect(
      Array.from(usedTokens)
        .filter((token) => !token.endsWith("-"))
        .filter((token) => !definedTokens.has(token) && !runtimeStyleTokens.has(token))
        .sort(),
    ).toEqual([]);
  });
});

function compositeRgba(rgba: string, background: string): string {
  const parts = /rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/.exec(rgba);
  expect(parts, `rgba color ${rgba}`).not.toBeNull();
  const alpha = Number(parts?.[4] ?? "0");
  const foreground = `#${[parts?.[1], parts?.[2], parts?.[3]]
    .map((value) =>
      Number(value ?? "0")
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
  return mixHex(foreground, background, alpha);
}

function mixHex(foreground: string, background: string, weight: number): string {
  const a = hexChannels(foreground);
  const b = hexChannels(background);
  const channel = (index: number) => Math.round(weight * a[index] + (1 - weight) * b[index]);

  return `#${[channel(0), channel(1), channel(2)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function hexChannels(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function expectTerminalThemeContrast(theme: TerminalTheme) {
  for (const key of terminalTextColorKeys) {
    expect(
      contrastRatio(theme[key], theme.background),
      `${key} against ${theme.background}`,
    ).toBeGreaterThanOrEqual(minimumTextContrast);
  }
}

function cssDeclaration(css: string, property: string): string {
  const match = new RegExp(`${escapeRegex(property)}:\\s*([^;]+);`).exec(css);

  if (!match) {
    throw new Error(`Missing ${property}`);
  }

  return match[1].trim();
}

function cssBlock(css: string, selector: string): string {
  const blockStart = new RegExp(`${escapeRegex(selector)}\\s*\\{`).exec(css);

  if (!blockStart) {
    throw new Error(`Missing CSS block ${selector}`);
  }

  const start = blockStart.index;
  const bodyStart = css.indexOf("{", start);

  if (bodyStart < 0) {
    throw new Error(`Missing CSS block ${selector}`);
  }

  const end = css.indexOf("}", bodyStart);

  if (end < 0) {
    throw new Error(`Unclosed CSS block ${selector}`);
  }

  return css.slice(start, end);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return [".css", ".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
