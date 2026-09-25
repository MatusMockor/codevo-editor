import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLASSIC_SYNTAX_THEME_IDS,
  PALETTE_IDS,
  RESOLVED_COLOR_SCHEMES,
  type ResolvedColorScheme,
} from "./appearance";
import { paletteTokens, surfaceColor } from "./appearancePalettes";
import { classicTerminalTheme, type TerminalTheme } from "./editorColorThemes";
import { contrastRatio } from "./themeContrast";

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
const monacoPopupTokenMap = [
  ["--vscode-editorSuggestWidget-background", "var(--cv-popover)"],
  ["--vscode-editorSuggestWidget-border", "transparent"],
  ["--vscode-editorSuggestWidget-foreground", "var(--cv-fg)"],
  ["--vscode-editorSuggestWidget-selectedBackground", "var(--cv-tint-3)"],
  ["--vscode-editorSuggestWidget-selectedForeground", "var(--cv-fg-strong)"],
  ["--vscode-editorSuggestWidget-highlightForeground", "var(--cv-accent)"],
  ["--vscode-editorSuggestWidget-focusHighlightForeground", "var(--cv-accent)"],
  ["--vscode-editorHoverWidget-background", "var(--cv-popover)"],
  ["--vscode-editorHoverWidget-border", "transparent"],
  ["--vscode-editorHoverWidget-foreground", "var(--cv-fg)"],
  ["--vscode-editorWidget-background", "var(--cv-popover)"],
  ["--vscode-editorWidget-border", "transparent"],
  ["--vscode-editorWidget-foreground", "var(--cv-fg)"],
  ["--vscode-menu-background", "var(--cv-popover)"],
  ["--vscode-menu-foreground", "var(--cv-fg)"],
  ["--vscode-menu-selectionBackground", "var(--cv-tint-3)"],
  ["--vscode-menu-selectionForeground", "var(--cv-fg-strong)"],
  ["--vscode-menu-separatorBackground", "var(--cv-hair)"],
  ["--vscode-menu-border", "transparent"],
  ["--vscode-editorActionList-background", "var(--cv-popover)"],
  ["--vscode-editorActionList-foreground", "var(--cv-fg)"],
  ["--vscode-editorActionList-focusBackground", "var(--cv-tint-3)"],
  ["--vscode-editorActionList-focusForeground", "var(--cv-fg-strong)"],
] as const;

describe("contrastRatio", () => {
  it("returns WCAG contrast ratios for two hex colors", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#777777", "#ffffff")).toBeGreaterThan(4.4);
  });

  it("keeps tree active states readable in every palette and scheme", () => {
    const appCss = readFileSync("src/App.css", "utf8");
    const active = cssBlock(appCss, ".tree-row.active");

    expect(cssDeclaration(active, "background")).toBe("var(--cv-accent-soft)");
    expect(cssDeclaration(active, "color")).toBe("var(--cv-fg-strong)");
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        const tokens = paletteTokens(palette, scheme);
        for (const role of ["canvas", "side"] as const) {
          const fill = compositeRgba(tokens.accentSoft, surfaceColor(palette, scheme, role));
          expect(
            contrastRatio(tokens.fgStrong, fill),
            `${palette}/${scheme}: active text on accent-soft over ${role} ${fill}`,
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
    [
      "src/components/DirtyCloseDecisionDialogHost.css",
      ".dirty-close-decision-content .dirty-close-decision-save:hover",
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

describe("Monaco popup chrome", () => {
  const widgetCss = readFileSync("src/components/editorPanel/editorWidgets.css", "utf8");
  const semanticCss = readFileSync("src/ui/tokens/semantic.css", "utf8");

  it("pins popup theme tokens to palette chrome variables on every popup surface", () => {
    const block = cssBlockContainingSelector(widgetCss, ".app-shell .monaco-editor");

    for (const selector of [
      ".app-shell .monaco-editor",
      ".app-shell .action-widget",
      ".app-shell .monaco-menu",
      ".app-shell .monaco-hover",
      ".app-shell .context-view",
    ]) {
      expect(block, selector).toContain(selector);
    }

    for (const [token, value] of monacoPopupTokenMap) {
      expect(cssDeclaration(block, token), token).toBe(value);
    }
  });

  it("keeps autocomplete, hover, rename, find and action widgets on the shared popover chrome", () => {
    for (const selector of [
      ".app-shell .monaco-editor .suggest-widget",
      ".app-shell .monaco-editor .suggest-details",
      ".app-shell .monaco-editor .monaco-hover",
      ".app-shell .monaco-editor .find-widget",
      ".app-shell .monaco-editor .rename-box",
      ".app-shell .action-widget {",
    ]) {
      const block = cssBlockContainingSelector(widgetCss, selector);
      expect(block, `${selector}: radius`).toContain("border-radius: var(--cv-r-card)");
      expect(block, `${selector}: surface`).toContain("background: var(--cv-popover)");
      expect(block, `${selector}: shadow`).toContain("box-shadow: var(--cv-shadow-pop)");
    }
  });

  it("keeps focused popup rows on the contrast-checked tint treatment", () => {
    for (const selector of [
      ".app-shell .monaco-editor .suggest-widget .monaco-list .monaco-list-row.focused",
      ".app-shell .monaco-menu .monaco-action-bar.vertical .action-item.focused .action-menu-item",
      ".app-shell .action-widget .monaco-list .monaco-list-row.action.focused:not(.option-disabled)",
    ]) {
      const block = cssBlockContainingSelector(widgetCss, selector);
      expect(block, `${selector}: selected background`).toContain("var(--cv-tint-3)");
    }

    const actionRow = cssBlockContainingSelector(
      widgetCss,
      ".app-shell .action-widget .monaco-list .monaco-list-row.action.focused:not(.option-disabled)",
    );
    expect(actionRow).toContain("color: var(--cv-fg-strong)");
  });

  it("keeps popup labels readable on the palette popover surface in every palette and scheme", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        const tokens = paletteTokens(palette, scheme);
        const focused = compositeRgba(schemeTint3(semanticCss, scheme), tokens.popBg);
        const name = `${palette}/${scheme}`;

        expect(
          contrastRatio(tokens.fg, tokens.popBg),
          `${name}: popup foreground on popover ${tokens.popBg}`,
        ).toBeGreaterThanOrEqual(minimumTextContrast);
        expect(
          contrastRatio(tokens.fgStrong, focused),
          `${name}: focused row foreground on tint-3 ${focused}`,
        ).toBeGreaterThanOrEqual(minimumTextContrast);
        expect(
          contrastRatio(tokens.fgMuted, tokens.popBg),
          `${name}: muted popup text on popover ${tokens.popBg}`,
        ).toBeGreaterThanOrEqual(minimumTextContrast);
      }
    }
  });
});

function schemeTint3(css: string, scheme: ResolvedColorScheme): string {
  const start = css.indexOf(`:root[data-cv-scheme="${scheme}"] {`);
  const block = css.slice(start, css.indexOf("}", start));
  const match = /--cv-tint-3:\s*(rgba\([^)]*\));/.exec(block);
  expect(match, `--cv-tint-3 in ${scheme}`).not.toBeNull();
  return match?.[1] ?? "";
}

function compositeRgba(rgba: string, background: string): string {
  const parts = /rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/.exec(rgba);
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

function cssBlockContainingSelector(css: string, selector: string): string {
  let searchFrom = 0;

  while (searchFrom < css.length) {
    const selectorIndex = css.indexOf(selector, searchFrom);

    if (selectorIndex < 0) {
      break;
    }

    const bodyStart = css.indexOf("{", selectorIndex);
    const previousEnd = css.lastIndexOf("}", selectorIndex);
    const previousStart = css.lastIndexOf("{", selectorIndex);

    if (bodyStart >= 0 && previousStart <= previousEnd) {
      const end = css.indexOf("}", bodyStart);

      if (end < 0) {
        throw new Error(`Unclosed CSS block containing ${selector}`);
      }

      return css.slice(selectorIndex, end);
    }

    searchFrom = selectorIndex + selector.length;
  }

  throw new Error(`Missing CSS block containing ${selector}`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
