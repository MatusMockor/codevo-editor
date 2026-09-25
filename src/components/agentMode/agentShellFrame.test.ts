import { describe, expect, it } from "vitest";
import {
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
  type CssRule,
} from "../cssContractTestSupport";

const parsed = parseAllStyleSheets();
const agentRules = parsed.rules.filter((rule) => rule.sheet.startsWith("components/agentMode/"));
const RETIRED_SELECTORS = [
  ".agent-rail__chrome",
  ".agent-thread-head",
  ".agent-crumbs",
  ".agent-layout-controls",
  ".agent-icon-toggle",
  ".agent-surface__layout-controls",
  ".status-bar--agent",
] as const;

function value(rules: readonly CssRule[], selector: string, property: string): string | undefined {
  return lastOf(
    buildTokenTable(
      rules.filter(
        (rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector),
      ),
      "",
    ).get(property),
  );
}

describe("agent shell frame surfaces", () => {
  it("paints the sidebar on the side tone and the panel and conversation on the canvas", () => {
    expect(value(agentRules, ".agent-rail", "background")).toBe("var(--cv-side)");
    expect(value(agentRules, ".agent-rail", "box-shadow")).toBe("var(--cv-edge-end-divider)");
    expect(value(agentRules, ".agent-surface", "background")).toBe("var(--cv-canvas)");
    expect(value(agentRules, ".agent-surface", "box-shadow")).toBe("var(--cv-edge-start-divider)");
    expect(value(agentRules, ".agent-mode__center", "background")).toBe("var(--cv-canvas)");
  });

  it("keeps the conversation column a flex column so the session and composer stack", () => {
    expect(value(agentRules, ".agent-mode__center", "display")).toBe("flex");
    expect(value(agentRules, ".agent-mode__center", "flex-direction")).toBe("column");
    expect(value(agentRules, ".agent-mode__center", "min-height")).toBe("0");
  });

  it("retires every rule the shell primitive replaced", () => {
    const leftovers = agentRules
      .flatMap((rule) => selectorParts(rule.selector).map((part) => `${rule.sheet} ${part}`))
      .filter((entry) => RETIRED_SELECTORS.some((selector) => entry.includes(selector)));

    expect(leftovers).toEqual([]);
  });
});
