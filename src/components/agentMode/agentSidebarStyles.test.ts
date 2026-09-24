import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  parseCssRules,
  readStyleSheet,
  varReferences,
} from "../cssContractTestSupport";

const SHEET = "components/agentMode/agentSidebar.css";
const sheet = readStyleSheet(SHEET);
const parsed = parseCssRules(sheet.source, SHEET);

function declaration(selector: string, property: string): string | undefined {
  const values = parsed.rules
    .filter(
      (rule) =>
        rule.context.length === 0 &&
        rule.selector.split(",").some((part) => part.trim() === selector),
    )
    .flatMap((rule) => rule.declarations)
    .filter((entry) => entry.property === property)
    .map((entry) => entry.value);
  return values[values.length - 1];
}

describe("sidebar styles", () => {
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

  it("mirrors the mockup geometry", () => {
    expect(declaration(".cv-sb-search__field", "height")).toBe("32px");
    expect(declaration(".cv-filter__option", "height")).toBe("32px");
    expect(declaration(".cv-favicon", "width")).toBe("16px");
  });

  it("keeps the t3code card row geometry", () => {
    expect(declaration(".cv-card-row", "height")).toBe("78px");
    expect(declaration(".cv-card-row", "padding")).toBe("8px 10px");
    expect(declaration(".cv-card-row", "border-radius")).toBe("var(--cv-r-control)");
    expect(declaration(".cv-card-row__act", "top")).toBe("10px");
  });

  it("keeps the shelves and search results on the mockup geometry", () => {
    expect(declaration(".cv-sb-shelf", "height")).toBe("36px");
    expect(declaration(".cv-sr", "min-height")).toBe("36px");
    expect(declaration(".cv-sr mark", "background")).toBe("transparent");
  });
});
