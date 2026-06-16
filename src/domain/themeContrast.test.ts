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
  });

  it("keeps terminal text colors readable in app themes", () => {
    expectTerminalThemeContrast(terminalThemeForAppTheme("dark"));
    expectTerminalThemeContrast(terminalThemeForAppTheme("light"));
    expectTerminalThemeContrast(terminalThemeForAppTheme("system", true));
    expectTerminalThemeContrast(terminalThemeForAppTheme("system", false));
  });
});

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
