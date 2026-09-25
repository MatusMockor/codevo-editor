import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLASSIC_SYNTAX_THEME_IDS,
  PALETTE_IDS,
  RESOLVED_COLOR_SCHEMES,
  type ResolvedColorScheme,
} from "./appearance";
import { paletteTokens } from "./appearancePalettes";
import { classicTerminalTheme, type TerminalTheme } from "./editorColorThemes";
import { contrastRatio } from "./themeContrast";

const minimumTextContrast = 4.5;
const minimumIconContrast = 3;
const themeSelectors: Array<[string, string]> = [
  ["dark", ":root"],
  ["light", '.app-shell[data-theme="light"]'],
  ["system", '.app-shell[data-theme="system"]'],
  ["ayuMirage", '.app-shell[data-theme="ayuMirage"]'],
  ["materialDeepOcean", '.app-shell[data-theme="materialDeepOcean"]'],
  ["oneDarkPro", '.app-shell[data-theme="oneDarkPro"]'],
  ["dracula", '.app-shell[data-theme="dracula"]'],
  ["catppuccinMocha", '.app-shell[data-theme="catppuccinMocha"]'],
  ["darkPlus", '.app-shell[data-theme="darkPlus"]'],
  ["catppuccinLatte", '.app-shell[data-theme="catppuccinLatte"]'],
  ["oneLight", '.app-shell[data-theme="oneLight"]'],
];
const themeAliasSelectors = themeSelectors.map(([, selector]) => selector).join(",\n");
const themeTokenAliases = [
  ["--accent", "--color-accent"],
  ["--background-active", "--color-accent-soft"],
  ["--background-primary", "--color-panel"],
  ["--border-color", "--color-border"],
  ["--border-strong", "--color-border-strong"],
  ["--border-subtle", "--color-border"],
  ["--button-primary-bg", "--color-accent"],
  ["--color-bg", "--color-app"],
  ["--color-border-subtle", "--color-border"],
  ["--color-danger", "--color-error"],
  ["--color-editor", "--color-app"],
  ["--color-focus", "--color-accent"],
  ["--color-info", "--color-accent"],
  ["--color-input-background", "--color-control"],
  ["--color-panel-soft", "--color-hover"],
  ["--color-surface-hover", "--color-hover"],
  ["--color-surface-raised", "--color-modal"],
  ["--color-surface-strong", "--color-panel-deep"],
  ["--danger-border", "--color-error"],
  ["--danger-surface", "--change-deleted-soft"],
  ["--danger-text", "--color-error"],
  ["--editor-background", "--color-app"],
  ["--editor-bg", "--color-app"],
  ["--input-background", "--color-control"],
  ["--panel-background", "--color-panel"],
  ["--panel-bg", "--color-modal"],
  ["--selection-background", "--color-accent-soft"],
  ["--selection-bg", "--color-accent-soft"],
  ["--status-error", "--color-error"],
  ["--status-success", "--color-success"],
  ["--success", "--color-success"],
  ["--surface-control", "--color-control"],
  ["--surface-input", "--color-control"],
  ["--surface-raised", "--color-modal"],
  ["--text-danger", "--color-error"],
  ["--text-muted", "--color-text-muted"],
  ["--text-primary", "--color-text"],
  ["--text-secondary", "--color-text-muted"],
  ["--warning", "--color-warning"],
] as const;
const runtimeStyleTokens = new Set([
  "--bottom-panel-height",
  "--git-history-file-depth",
  "--minimap-distance",
  "--minimap-strip",
  "--structure-indent",
  "--tree-level",
]);
const unmappedThemeTokens = ["--button-primary-text", "--color-shadow", "--font-mono"];
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
const symbolColorKeys = [
  "--symbol-method",
  "--symbol-property",
  "--symbol-const",
  "--symbol-class",
  "--symbol-interface",
  "--symbol-enum",
  "--symbol-function",
  "--symbol-trait",
  "--symbol-variable",
  "--symbol-keyword",
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

  it("keeps tree active states readable in app themes", () => {
    const appCss = readFileSync("src/App.css", "utf8");
    const darkActive = cssVariable(appCss, ":root", "--color-active");
    const darkActiveText = cssVariable(appCss, ":root", "--color-active-text");
    const lightActive = cssVariable(appCss, '.app-shell[data-theme="light"]', "--color-active");
    const lightActiveText = cssVariable(
      appCss,
      '.app-shell[data-theme="light"]',
      "--color-active-text",
    );
    const systemActive = cssVariable(appCss, '.app-shell[data-theme="system"]', "--color-active");
    const systemActiveText = cssVariable(
      appCss,
      '.app-shell[data-theme="system"]',
      "--color-active-text",
    );
    const ayuActive = cssVariable(appCss, '.app-shell[data-theme="ayuMirage"]', "--color-active");
    const ayuActiveText = cssVariable(
      appCss,
      '.app-shell[data-theme="ayuMirage"]',
      "--color-active-text",
    );
    const materialActive = cssVariable(
      appCss,
      '.app-shell[data-theme="materialDeepOcean"]',
      "--color-active",
    );
    const materialActiveText = cssVariable(
      appCss,
      '.app-shell[data-theme="materialDeepOcean"]',
      "--color-active-text",
    );

    expect(appCss).toContain("color: var(--color-active-text)");
    expect(contrastRatio(darkActiveText, darkActive)).toBeGreaterThanOrEqual(minimumTextContrast);
    expect(contrastRatio(lightActiveText, lightActive)).toBeGreaterThanOrEqual(minimumTextContrast);
    expect(contrastRatio(systemActiveText, systemActive)).toBeGreaterThanOrEqual(
      minimumTextContrast,
    );
    expect(contrastRatio(ayuActiveText, ayuActive)).toBeGreaterThanOrEqual(minimumTextContrast);
    expect(contrastRatio(materialActiveText, materialActive)).toBeGreaterThanOrEqual(
      minimumTextContrast,
    );

    for (const id of ["oneDarkPro", "dracula", "catppuccinMocha", "catppuccinLatte", "oneLight"]) {
      const selector = `.app-shell[data-theme="${id}"]`;
      const active = cssVariable(appCss, selector, "--color-active");
      const activeText = cssVariable(appCss, selector, "--color-active-text");
      expect(
        contrastRatio(activeText, active),
        `${id}: active-text on active`,
      ).toBeGreaterThanOrEqual(minimumTextContrast);
    }
  });

  it("keeps terminal text colors readable in app themes", () => {
    for (const theme of CLASSIC_SYNTAX_THEME_IDS.filter((id) => id !== "darkPlus")) {
      expectTerminalThemeContrast(classicTerminalTheme(theme));
    }
  });
});

describe("calm design tokens", () => {
  const appCss = readFileSync("src/App.css", "utf8");

  it("defines compatibility token aliases for every app theme", () => {
    const aliases = cssBlock(appCss, themeAliasSelectors);

    for (const [, selector] of themeSelectors) {
      expect(aliases, selector).toContain(selector);
    }

    for (const [alias, canonical] of themeTokenAliases) {
      expect(cssDeclaration(aliases, alias), alias).toBe(`var(${canonical})`);
    }
  });

  it("limits undeclared theme tokens to documented unmapped tokens", () => {
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
        .filter((token) => !definedTokens.has(token) && !runtimeStyleTokens.has(token))
        .sort(),
    ).toEqual(unmappedThemeTokens);
  });

  it("declares the shared radius, motion and accent tokens in :root", () => {
    const root = cssBlock(appCss, ":root");
    for (const token of [
      "--radius-sm:",
      "--radius-md:",
      "--radius-lg:",
      "--radius-pill:",
      "--motion-fast:",
      "--motion-base:",
      "--ease-standard:",
      "--shadow-pop:",
      "--color-accent-soft:",
      "--focus-ring:",
    ]) {
      expect(root).toContain(token);
    }
  });

  it("honors reduced motion", () => {
    expect(appCss).toContain("prefers-reduced-motion: reduce");
  });

  it("keeps text readable on the rendered accent-soft active tint", () => {
    for (const [name, selector] of themeSelectors) {
      const accent = cssVariable(appCss, selector, "--color-accent");
      const panel = cssVariable(appCss, selector, "--color-panel");
      // --color-accent-soft: color-mix(in srgb, var(--color-accent) 14%, var(--color-panel))
      const accentSoft = mixHex(accent, panel, 0.14);

      for (const textKey of ["--color-active-text", "--color-text-strong"]) {
        const text = cssVariable(appCss, selector, textKey);
        expect(
          contrastRatio(text, accentSoft),
          `${name}: ${textKey} on accent-soft ${accentSoft}`,
        ).toBeGreaterThanOrEqual(minimumTextContrast);
      }
    }
  });

  it("keeps popup and palette text readable on theme surfaces", () => {
    for (const [name, selector] of themeSelectors) {
      const modal = cssVariable(appCss, selector, "--color-modal");
      const hover = cssVariable(appCss, selector, "--color-hover");
      const accentSoft = accentSoftColor(appCss, selector);

      const textPairs: Array<[string, string, string]> = [
        ["--color-text", "modal", modal],
        ["--color-text-strong", "modal", modal],
        ["--color-text", "hover", hover],
        ["--color-text-strong", "accent-soft", accentSoft],
      ];

      for (const [textKey, backgroundName, background] of textPairs) {
        const text = cssVariable(appCss, selector, textKey);
        expect(
          contrastRatio(text, background),
          `${name}: ${textKey} on ${backgroundName} ${background}`,
        ).toBeGreaterThanOrEqual(minimumTextContrast);
      }
    }
  });

  it("keeps symbol icons readable next to popup and palette labels", () => {
    for (const [name, selector] of themeSelectors) {
      const modal = cssVariable(appCss, selector, "--color-modal");
      const accentSoft = accentSoftColor(appCss, selector);

      for (const symbolKey of symbolColorKeys) {
        const symbol = cssVariable(appCss, selector, symbolKey);
        for (const [backgroundName, background] of [
          ["modal", modal],
          ["accent-soft", accentSoft],
        ] as const) {
          expect(
            contrastRatio(symbol, background),
            `${name}: ${symbolKey} on ${backgroundName} ${background}`,
          ).toBeGreaterThanOrEqual(minimumIconContrast);
        }
      }
    }
  });

  it("keeps circular symbol icon glyphs readable on their kind backgrounds", () => {
    for (const [name, selector] of themeSelectors) {
      const foreground = cssVariableWithRootFallback(appCss, selector, "--symbol-icon-foreground");

      for (const symbolKey of symbolColorKeys) {
        const symbol = cssVariable(appCss, selector, symbolKey);

        expect(
          contrastRatio(foreground, symbol),
          `${name}: --symbol-icon-foreground on ${symbolKey} ${symbol}`,
        ).toBeGreaterThanOrEqual(minimumIconContrast);
      }
    }
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

function accentSoftColor(css: string, selector: string): string {
  const accent = cssVariable(css, selector, "--color-accent");
  const panel = cssVariable(css, selector, "--color-panel");

  // --color-accent-soft: color-mix(in srgb, var(--color-accent) 14%, var(--color-panel))
  return mixHex(accent, panel, 0.14);
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

function cssVariable(css: string, selector: string, variable: string): string {
  const block = cssBlock(css, selector);
  const match = new RegExp(`${escapeRegex(variable)}:\\s*(#[0-9a-fA-F]{6})`).exec(block);

  if (!match) {
    throw new Error(`Missing ${variable} in ${selector}`);
  }

  return match[1];
}

function cssDeclaration(css: string, property: string): string {
  const match = new RegExp(`${escapeRegex(property)}:\\s*([^;]+);`).exec(css);

  if (!match) {
    throw new Error(`Missing ${property}`);
  }

  return match[1].trim();
}

function cssVariableWithRootFallback(css: string, selector: string, variable: string): string {
  try {
    return cssVariable(css, selector, variable);
  } catch (error) {
    if (selector === ":root") {
      throw error;
    }

    return cssVariable(css, ":root", variable);
  }
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
