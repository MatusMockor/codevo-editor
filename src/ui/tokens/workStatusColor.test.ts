import { describe, expect, it } from "vitest";
import { parseAllStyleSheets, selectorParts } from "../../components/cssContractTestSupport";

const parsed = parseAllStyleSheets();

const WORKING_INDICATORS: ReadonlyArray<readonly [selector: string, property: string]> = [
  [".cv-status--work", "color"],
  [".cv-composer-banner--working .cv-spinner", "color"],
  [".cv-clone-banner__track > span", "background"],
  ['.cv-spawn-member[data-status="working"] .cv-spawn-member__meta', "color"],
  [".cv-agents-row__dot", "background"],
  [".cv-agents__working", "color"],
  [".agent-minimap__dash--live::after", "background"],
  [".agent-thread-activity__dot", "background"],
];

function declaredValues(selector: string, property: string): readonly string[] {
  return parsed.rules
    .filter((rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector))
    .flatMap((rule) => rule.declarations)
    .filter((entry) => entry.property === property)
    .map((entry) => entry.value);
}

describe("working status colour", () => {
  it.each(WORKING_INDICATORS)("paints %s %s with the working token", (selector, property) => {
    const values = declaredValues(selector, property);
    expect(values.length, selector).toBeGreaterThan(0);
    expect(values[values.length - 1], selector).toBe("var(--cv-work)");
  });

  it("never paints a working indicator with the brand accent", () => {
    for (const [selector, property] of WORKING_INDICATORS) {
      expect(declaredValues(selector, property), selector).not.toContain("var(--cv-accent)");
    }
  });
});
