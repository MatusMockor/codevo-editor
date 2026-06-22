import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("window chrome styles", () => {
  it("uses a pointer cursor on clickable chrome controls", () => {
    const css = readFileSync(
      resolve(import.meta.dirname, "../App.css"),
      "utf8",
    );

    expect(cssRule(css, ".window-menu-button")).toContain("cursor: pointer;");
    expect(cssRule(css, ".window-menu-item")).toContain("cursor: pointer;");
    expect(cssRule(css, ".window-control")).toContain("cursor: pointer;");
  });
});

function cssRule(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{[^}]+\\}`));

  if (!match) {
    throw new Error(`CSS rule not found: ${selector}`);
  }

  return match[0];
}
