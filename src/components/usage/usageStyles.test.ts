import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  parseCssRules,
  readStyleSheet,
  selectorParts,
  varReferences,
} from "../cssContractTestSupport";

const SHEET = "components/usage/usage.css";
const parsed = parseCssRules(readStyleSheet(SHEET).source, SHEET);
const PATTERN_PROPERTIES = /^(background-image|background-size|background-repeat|mask|mask-image)$/;
const PATTERN_VALUES = /gradient\(|url\(/;

function declaration(selector: string, property: string): string | undefined {
  const values = parsed.rules
    .filter(
      (rule) =>
        rule.context.length === 0 && selectorParts(rule.selector).some((part) => part === selector),
    )
    .flatMap((rule) => rule.declarations)
    .filter((entry) => entry.property === property)
    .map((entry) => entry.value);
  return values[values.length - 1];
}

describe("usage styles", () => {
  it("uses only --cv tokens and no colour literals", () => {
    expect(parsed.issues).toEqual([]);
    for (const rule of parsed.rules) {
      for (const entry of rule.declarations) {
        expect(COLOR_LITERAL.test(entry.value), `${rule.selector} ${entry.property}`).toBe(false);
        for (const name of varReferences(entry.value))
          expect(name, rule.selector).toMatch(/^--cv-/);
      }
    }
  });

  it("draws no pattern, gradient or image backgrounds", () => {
    for (const rule of parsed.rules) {
      for (const entry of rule.declarations) {
        const where = `${rule.selector} ${entry.property}`;
        expect(PATTERN_PROPERTIES.test(entry.property), where).toBe(false);
        expect(PATTERN_VALUES.test(entry.value), where).toBe(false);
      }
    }
  });

  it("hides the pace marker at rest and keeps it inside the muted track", () => {
    expect(declaration(".cv-usage-bar__pace", "opacity")).toBe("0");
    expect(declaration(".cv-usage-bar__pace", "background")).toBe("var(--cv-fg-subtle)");
    expect(declaration(".cv-usage-bar__pace", "top")).toBe("9px");
    expect(declaration(".cv-usage-bar__pace", "bottom")).toBe("9px");
    expect(declaration(".cv-usage-bar::before", "inset")).toBe("9px 0");
    expect(declaration(".cv-usage-bar:hover .cv-usage-bar__pace", "opacity")).toBe("1");
    expect(declaration(".cv-usage-bar:focus-visible .cv-usage-bar__pace", "opacity")).toBe("1");
  });
});
