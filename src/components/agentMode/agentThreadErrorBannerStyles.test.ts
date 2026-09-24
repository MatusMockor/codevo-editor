import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  parseCssRules,
  readStyleSheet,
  varReferences,
} from "../cssContractTestSupport";

const SHEET = "components/agentMode/agentThreadErrorBanner.css";
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

describe("thread error banner styles", () => {
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

  it("is as wide as the conversation column", () => {
    expect(declaration(".cv-thread-alert", "width")).toBe("min(var(--cv-column), 100%)");
  });
});
