import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { calmDark, calmLight } from "./themePalettes";

const APP_CSS_PATH = fileURLToPath(new URL("../App.css", import.meta.url));
const appCss = readFileSync(APP_CSS_PATH, "utf8");

describe("Monaco palette parity with the app canvas", () => {
  it("keeps calm-dark on the dark canvas tone", () => {
    expect(calmDark.bg).toBe(declaredColorApp(":root {"));
  });

  it("keeps calm-light on the light canvas tone", () => {
    expect(calmLight.bg).toBe(declaredColorApp('.app-shell[data-theme="light"] {'));
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

function declaredColorApp(selector: string): string {
  const selectorStart = appCss.indexOf(selector);
  expect(selectorStart, `selector ${selector} not found in App.css`).toBeGreaterThanOrEqual(0);
  const blockEnd = appCss.indexOf("\n}", selectorStart);
  expect(blockEnd).toBeGreaterThan(selectorStart);
  const block = appCss.slice(selectorStart, blockEnd);
  const match = /--color-app:\s*(#[0-9a-fA-F]{3,8});/.exec(block);
  expect(match, `--color-app not declared in ${selector}`).not.toBeNull();

  return match?.[1] ?? "";
}
