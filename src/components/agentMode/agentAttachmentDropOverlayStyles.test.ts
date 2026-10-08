import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  parseCssRules,
  readStyleSheet,
  varReferences,
} from "../cssContractTestSupport";

const SHEET = "components/agentMode/agentAttachmentDropOverlay.css";
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

describe("attachment drop overlay styles", () => {
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

  it("covers the column inset without intercepting the pointer", () => {
    expect(declaration(".agent-attachment-drop-column", "position")).toBe("relative");
    expect(declaration(".agent-attachment-drop-overlay", "position")).toBe("absolute");
    expect(declaration(".agent-attachment-drop-overlay", "inset")).toBe("var(--cv-space-4)");
    expect(declaration(".agent-attachment-drop-overlay", "pointer-events")).toBe("none");
  });

  it("stays neutral instead of borrowing the accent focus ring", () => {
    const references = parsed.rules.flatMap((rule) =>
      rule.declarations.flatMap((entry) => varReferences(entry.value)),
    );
    expect(references.filter((name) => /accent|focus|selected/.test(name))).toEqual([]);
    expect(declaration(".agent-attachment-drop-overlay__frame", "stroke")).toBe(
      "var(--cv-fg-subtle)",
    );
  });
});
