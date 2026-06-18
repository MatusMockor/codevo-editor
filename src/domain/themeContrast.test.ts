import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  terminalThemeForAppTheme,
  type TerminalTheme,
} from "./settings";
import { contrastRatio } from "./themeContrast";

const minimumTextContrast = 4.5;
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
});

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
