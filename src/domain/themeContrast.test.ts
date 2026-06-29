import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  terminalThemeForAppTheme,
  type TerminalTheme,
} from "./settings";
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
  ["catppuccinLatte", '.app-shell[data-theme="catppuccinLatte"]'],
  ["oneLight", '.app-shell[data-theme="oneLight"]'],
];
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

describe("contrastRatio", () => {
  it("returns WCAG contrast ratios for two hex colors", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#777777", "#ffffff")).toBeGreaterThan(4.4);
  });

  it("keeps tree active states readable in app themes", () => {
    const appCss = readFileSync("src/App.css", "utf8");
    const darkActive = cssVariable(appCss, ":root", "--color-active");
    const darkActiveText = cssVariable(appCss, ":root", "--color-active-text");
    const lightActive = cssVariable(
      appCss,
      ".app-shell[data-theme=\"light\"]",
      "--color-active",
    );
    const lightActiveText = cssVariable(
      appCss,
      ".app-shell[data-theme=\"light\"]",
      "--color-active-text",
    );
    const systemActive = cssVariable(
      appCss,
      ".app-shell[data-theme=\"system\"]",
      "--color-active",
    );
    const systemActiveText = cssVariable(
      appCss,
      ".app-shell[data-theme=\"system\"]",
      "--color-active-text",
    );
    const ayuActive = cssVariable(
      appCss,
      ".app-shell[data-theme=\"ayuMirage\"]",
      "--color-active",
    );
    const ayuActiveText = cssVariable(
      appCss,
      ".app-shell[data-theme=\"ayuMirage\"]",
      "--color-active-text",
    );
    const materialActive = cssVariable(
      appCss,
      ".app-shell[data-theme=\"materialDeepOcean\"]",
      "--color-active",
    );
    const materialActiveText = cssVariable(
      appCss,
      ".app-shell[data-theme=\"materialDeepOcean\"]",
      "--color-active-text",
    );

    expect(appCss).toContain("color: var(--color-active-text)");
    expect(contrastRatio(darkActiveText, darkActive)).toBeGreaterThanOrEqual(
      minimumTextContrast,
    );
    expect(contrastRatio(lightActiveText, lightActive)).toBeGreaterThanOrEqual(
      minimumTextContrast,
    );
    expect(contrastRatio(systemActiveText, systemActive)).toBeGreaterThanOrEqual(
      minimumTextContrast,
    );
    expect(contrastRatio(ayuActiveText, ayuActive)).toBeGreaterThanOrEqual(
      minimumTextContrast,
    );
    expect(
      contrastRatio(materialActiveText, materialActive),
    ).toBeGreaterThanOrEqual(minimumTextContrast);

    for (const id of [
      "oneDarkPro",
      "dracula",
      "catppuccinMocha",
      "catppuccinLatte",
      "oneLight",
    ]) {
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
    expectTerminalThemeContrast(terminalThemeForAppTheme("dark"));
    expectTerminalThemeContrast(terminalThemeForAppTheme("light"));
    expectTerminalThemeContrast(terminalThemeForAppTheme("ayuMirage"));
    expectTerminalThemeContrast(terminalThemeForAppTheme("materialDeepOcean"));
    expectTerminalThemeContrast(terminalThemeForAppTheme("oneDarkPro"));
    expectTerminalThemeContrast(terminalThemeForAppTheme("dracula"));
    expectTerminalThemeContrast(terminalThemeForAppTheme("catppuccinMocha"));
    expectTerminalThemeContrast(terminalThemeForAppTheme("catppuccinLatte"));
    expectTerminalThemeContrast(terminalThemeForAppTheme("oneLight"));
    expectTerminalThemeContrast(terminalThemeForAppTheme("system", true));
    expectTerminalThemeContrast(terminalThemeForAppTheme("system", false));
  });
});

describe("calm design tokens", () => {
  const appCss = readFileSync("src/App.css", "utf8");

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
      const foreground = cssVariableWithRootFallback(
        appCss,
        selector,
        "--symbol-icon-foreground",
      );

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

function accentSoftColor(css: string, selector: string): string {
  const accent = cssVariable(css, selector, "--color-accent");
  const panel = cssVariable(css, selector, "--color-panel");

  // --color-accent-soft: color-mix(in srgb, var(--color-accent) 14%, var(--color-panel))
  return mixHex(accent, panel, 0.14);
}

function mixHex(foreground: string, background: string, weight: number): string {
  const a = hexChannels(foreground);
  const b = hexChannels(background);
  const channel = (index: number) =>
    Math.round(weight * a[index] + (1 - weight) * b[index]);

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
  const match = new RegExp(`${escapeRegex(variable)}:\\s*(#[0-9a-fA-F]{6})`).exec(
    block,
  );

  if (!match) {
    throw new Error(`Missing ${variable} in ${selector}`);
  }

  return match[1];
}

function cssVariableWithRootFallback(
  css: string,
  selector: string,
  variable: string,
): string {
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
