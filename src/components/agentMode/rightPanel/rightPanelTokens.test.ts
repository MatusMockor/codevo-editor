import { describe, expect, it } from "vitest";
import { parseCssRules, readStyleSheet } from "../../cssContractTestSupport";

const SHEETS = [
  "components/agentMode/rightPanel/rightPanel.css",
  "components/agentMode/rightPanel/diff/agentDiff.css",
  "components/agentMode/rightPanel/files/agentFiles.css",
  "components/agentMode/rightPanel/scripts/agentScripts.css",
] as const;
const SPACE_TOKEN_PX = new Set(["2px", "4px", "6px", "8px", "12px", "16px", "24px", "32px"]);
const SPACING = new Set(["padding", "margin", "gap", "row-gap", "column-gap"]);
const rules = SHEETS.flatMap((sheet) => parseCssRules(readStyleSheet(sheet).source, sheet).rules);

describe("right panel styles use shared tokens", () => {
  it("draws every focus ring with the shared focus ring token", () => {
    const focusShadows = rules
      .filter((rule) => rule.selector.includes(":focus-visible"))
      .flatMap((rule) =>
        rule.declarations
          .filter((declaration) => declaration.property === "box-shadow")
          .map((declaration) => [rule.selector, declaration.value]),
      );
    expect(focusShadows.length).toBeGreaterThan(0);
    for (const [selector, value] of focusShadows) {
      expect(value, selector).toBe("var(--cv-ring-focus)");
    }
  });

  it("never spells a spacing token value as raw pixels", () => {
    for (const rule of rules) {
      for (const declaration of rule.declarations) {
        if (!SPACING.has(declaration.property.replace(/-(top|right|bottom|left)$/, ""))) continue;
        const raw = declaration.value.split(/\s+/).filter((part) => SPACE_TOKEN_PX.has(part));
        expect(raw, `${rule.selector} ${declaration.property}`).toEqual([]);
      }
    }
  });

  it("never sets font sizes or radii in raw pixels", () => {
    for (const rule of rules) {
      for (const declaration of rule.declarations) {
        if (declaration.property !== "font-size" && declaration.property !== "border-radius")
          continue;
        expect(declaration.value, `${rule.selector} ${declaration.property}`).not.toMatch(/\d+px/);
      }
    }
  });

  it("lets the tab list be the strip's only horizontal scroller", () => {
    const wrapper = rules.filter((rule) => rule.selector === ".cv-rp-strip__tabs");
    expect(wrapper.length).toBeGreaterThan(0);
    for (const rule of wrapper) {
      const overflow = rule.declarations.filter(({ property }) => property.startsWith("overflow"));
      expect(overflow, rule.selector).toEqual([]);
    }
  });
});
