import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  parseCssRules,
  readStyleSheet,
  varReferences,
} from "../cssContractTestSupport";

const SHEET = "components/usage/codexRateLimitResets.css";
const parsed = parseCssRules(readStyleSheet(SHEET).source, SHEET);

describe("codex limit reset styles", () => {
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
});
