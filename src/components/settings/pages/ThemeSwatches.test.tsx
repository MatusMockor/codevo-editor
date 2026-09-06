// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appThemeOptions, type AppTheme } from "../../../domain/settings";
import {
  SYSTEM_LIGHT_CONTEXT,
  SYSTEM_THEME_SELECTOR,
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
  type CssRule,
} from "../../cssContractTestSupport";
import { ThemeSwatches } from "./ThemeSwatches";

const APP_SHEET = "App.css";
const appRules = parseAllStyleSheets().rules.filter((rule) => rule.sheet === APP_SHEET);

const THEME_SELECTORS: Readonly<Record<AppTheme, string>> = {
  dark: ":root",
  light: '.app-shell[data-theme="light"]',
  system: ":root",
  ayuMirage: '.app-shell[data-theme="ayuMirage"]',
  materialDeepOcean: '.app-shell[data-theme="materialDeepOcean"]',
  oneDarkPro: '.app-shell[data-theme="oneDarkPro"]',
  dracula: '.app-shell[data-theme="dracula"]',
  catppuccinMocha: '.app-shell[data-theme="catppuccinMocha"]',
  catppuccinLatte: '.app-shell[data-theme="catppuccinLatte"]',
  oneLight: '.app-shell[data-theme="oneLight"]',
  darkPlus: '.app-shell[data-theme="darkPlus"]',
};

function themeBlock(selector: string): readonly CssRule[] {
  return appRules.filter(
    (rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector),
  );
}

function systemLightBlock(): readonly CssRule[] {
  return appRules.filter(
    (rule) => rule.context[0] === SYSTEM_LIGHT_CONTEXT && rule.selector === SYSTEM_THEME_SELECTOR,
  );
}

function colorValue(rules: readonly CssRule[], name: string): string {
  return lastOf(buildTokenTable(rules).get(name)) ?? "";
}

function rgb(hex: string): string {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

describe("ThemeSwatches", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function renderSwatches(onChange: (theme: AppTheme) => void = () => undefined): void {
    act(() => {
      root.render(<ThemeSwatches onChange={onChange} value="dark" />);
    });
  }

  function swatch(theme: AppTheme): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`[data-value="${theme}"]`);

    expect(element, theme).not.toBeNull();

    return element as HTMLButtonElement;
  }

  it("paints every swatch with the App.css colours of the theme it previews", () => {
    renderSwatches();

    for (const theme of appThemeOptions) {
      const block = themeBlock(THEME_SELECTORS[theme.id]);
      const button = swatch(theme.id);
      const sidebar = button.querySelector<HTMLElement>(".settings-swatch__sidebar");
      const accent = button.querySelector<HTMLElement>(".settings-swatch__accent");
      const sidebarBlock = theme.id === "system" ? systemLightBlock() : block;

      expect(button.style.backgroundColor, `${theme.id} app`).toBe(
        rgb(colorValue(block, "--color-app")),
      );
      expect(sidebar?.style.backgroundColor, `${theme.id} sidebar`).toBe(
        rgb(colorValue(sidebarBlock, "--color-sidebar")),
      );
      expect(accent?.style.backgroundColor, `${theme.id} accent`).toBe(
        rgb(colorValue(block, "--color-accent")),
      );
    }
  });

  it("renders one radio per theme and moves the selection with the arrow keys", () => {
    const onChange = vi.fn<(theme: AppTheme) => void>();
    renderSwatches(onChange);

    const group = host.querySelector('[role="radiogroup"]');
    const radios = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];

    expect(group?.getAttribute("aria-label")).toBe("Theme preview");
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual(
      appThemeOptions.map((theme) => theme.label),
    );
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(
      appThemeOptions.map((theme) => String(theme.id === "dark")),
    );

    act(() => {
      group?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });

    expect(onChange).toHaveBeenCalledWith("light");
  });
});
