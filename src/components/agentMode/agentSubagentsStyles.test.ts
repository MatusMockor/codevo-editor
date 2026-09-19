import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  parseCssRules,
  readStyleSheet,
  varReferences,
} from "../cssContractTestSupport";

const SHEET = "components/agentMode/agentSubagents.css";
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

describe("agent subagent styles", () => {
  it("parses cleanly and uses theme tokens instead of color literals", () => {
    expect(parsed.issues).toEqual([]);
    for (const rule of parsed.rules) {
      for (const entry of rule.declarations) {
        expect(COLOR_LITERAL.test(entry.value), `${rule.selector} ${entry.property}`).toBe(false);
      }
    }
  });

  it("only references agent tokens so light and dark themes both resolve", () => {
    const names = new Set(
      parsed.rules.flatMap((rule) =>
        rule.declarations.flatMap((entry) => varReferences(entry.value)),
      ),
    );
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) expect(name, name).toMatch(/^--(agent-|ease-standard$)/);
  });

  it("keeps the chat row and the indicator quiet: no frame, no card", () => {
    for (const selector of [".agent-spawn__row", ".agent-background-row__action"]) {
      expect(declaration(selector, "background"), selector).toBe("transparent");
      expect(declaration(selector, "border"), selector).toBe("0");
      expect(declaration(selector, "box-shadow"), selector).toBeUndefined();
    }
  });

  it("gives panel rows a fixed three-line height", () => {
    expect(declaration(".agents-panel__row", "height")).toBe("64px");
    expect(declaration(".agents-panel__row", "grid-template-rows")).toBe("20px 18px 16px");
    expect(declaration(".agents-panel__row", "box-sizing")).toBe("border-box");
  });

  it("uses static status dots and respects reduced motion", () => {
    expect(sheet.source).not.toMatch(/animation|@keyframes/);
    expect(
      declaration('.agents-panel__row[data-status="working"] .agents-panel__dot', "background"),
    ).toBe("var(--agent-status-working)");
    expect(
      declaration('.agents-panel__row[data-status="failed"] .agents-panel__activity', "color"),
    ).toBe("var(--agent-danger)");
    expect(sheet.source).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("docks the panel as a thread-reflowing column and overlays only when narrow", () => {
    expect(declaration(".agents-dock", "display")).toBe("grid");
    expect(declaration('.agents-dock[data-agents="docked"]', "grid-template-columns")).toBe(
      "minmax(0, 1fr) 340px",
    );
    expect(declaration(".agents-panel", "position")).toBeUndefined();
    expect(declaration(".agents-panel", "grid-column")).toBe("2");
    expect(declaration(".agents-dock", "position")).toBeUndefined();
    expect(declaration('.agents-dock[data-agents="overlay"] .agents-panel', "grid-column")).toBe(
      "1",
    );
    expect(declaration('.agents-dock[data-agents="overlay"] .agents-panel', "box-shadow")).toBe(
      "var(--agent-shadow-raised)",
    );
  });

  it("colors the static chat row dot by batch tone", () => {
    expect(declaration('.agent-spawn[data-tone="working"] .agent-spawn__dot', "background")).toBe(
      "var(--agent-status-working)",
    );
    expect(declaration('.agent-spawn[data-tone="failed"] .agent-spawn__dot', "background")).toBe(
      "var(--agent-danger)",
    );
  });

  it("shows keyboard focus with the agent focus ring", () => {
    expect(declaration(".agent-spawn__row:focus-visible", "box-shadow")).toBe(
      "var(--agent-focus-ring)",
    );
    expect(declaration(".agent-background-row__action:focus-visible", "box-shadow")).toBe(
      "var(--agent-focus-ring)",
    );
  });
});
