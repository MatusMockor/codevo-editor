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

function declaration(selector: string, property: string, context = ""): string | undefined {
  const values = parsed.rules
    .filter(
      (rule) =>
        rule.context.join(" ").startsWith(context) &&
        (context === "" ? rule.context.length === 0 : rule.context.length > 0) &&
        selectorParts(rule.selector).some((part) => part === selector),
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

  it("lets the headline totals wrap instead of overlapping at narrow widths", () => {
    expect(declaration(".cv-usage-totals", "grid-template-columns")).toBe(
      "repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr))",
    );
    expect(declaration(".cv-usage-totals__value", "white-space")).toBe("nowrap");
  });

  it("aligns every breakdown row on one shared column grid sized by its content", () => {
    expect(declaration(".cv-usage-breakdown", "container")).toBe("usage-breakdown / inline-size");
    expect(declaration(".cv-usage-breakdown__table", "display")).toBe("grid");
    expect(declaration(".cv-usage-breakdown__table", "grid-template-columns")).toBe(
      "minmax(0, 1fr) repeat(4, max-content)",
    );
    for (const selector of [".cv-usage-breakdown__group", ".cv-usage-breakdown__row"]) {
      expect(declaration(selector, "display"), selector).toBe("grid");
      expect(declaration(selector, "grid-column"), selector).toBe("1 / -1");
      expect(declaration(selector, "grid-template-columns"), selector).toBe("subgrid");
    }
  });

  it("keeps numeric cells right-aligned, tabular and on one line without fixed widths", () => {
    expect(declaration(".cv-usage-breakdown__cell", "text-align")).toBe("right");
    expect(declaration(".cv-usage-breakdown__cell", "white-space")).toBe("nowrap");
    expect(declaration(".cv-usage-breakdown__cell", "font-variant-numeric")).toBe("tabular-nums");
    const sized = parsed.rules.filter(
      (rule) =>
        rule.selector.includes("cv-usage-breakdown__cell") &&
        rule.declarations.some((entry) => /^(min-|max-)?width$/.test(entry.property)),
    );
    expect(sized.map((rule) => rule.selector)).toEqual([]);
  });

  it("ellipsizes long names instead of pushing the numbers out of the card", () => {
    expect(declaration(".cv-usage-breakdown__name", "min-width")).toBe("0");
    expect(declaration(".cv-usage-breakdown__label", "overflow")).toBe("hidden");
    expect(declaration(".cv-usage-breakdown__label", "text-overflow")).toBe("ellipsis");
    expect(declaration(".cv-usage-breakdown__label", "white-space")).toBe("nowrap");
  });

  it("moves names onto their own line when the card is too narrow for five columns", () => {
    const narrow = "@container usage-breakdown (max-width:";
    expect(declaration(".cv-usage-breakdown__name", "grid-column", narrow)).toBe("1 / -1");
    expect(
      declaration(".cv-usage-breakdown__name + .cv-usage-breakdown__cell", "grid-column", narrow),
    ).toBe("2");
  });
});
