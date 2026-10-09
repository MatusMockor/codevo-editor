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
    for (const name of names) expect(name, name).toMatch(/^--(cv-|agent-|ease-standard$)/);
  });

  it("keeps the chat row and the indicator quiet: no frame, no card", () => {
    for (const selector of [".cv-spawn__head"]) {
      expect(declaration(selector, "background"), selector).toBe("transparent");
      expect(declaration(selector, "border"), selector).toBe("0");
      expect(declaration(selector, "box-shadow"), selector).toBeUndefined();
    }
  });

  it("gives panel rows the mockup three-line 62px anatomy and a 32px footer", () => {
    expect(declaration(".cv-agents-row", "height")).toBe("62px");
    expect(declaration(".cv-agents-row", "grid-template-rows")).toBe("20px 18px 16px");
    expect(declaration(".cv-agents-row", "box-sizing")).toBe("border-box");
    expect(declaration(".cv-agents__foot", "height")).toBe("32px");
  });

  it("paints the row stop as a danger pill and quiets it while stopping", () => {
    const stop = ".cv-agents-row__stop";
    const stopping = '.cv-agents-row__stop[aria-disabled="true"]';
    const hover = '.cv-agents-row__stop:hover:enabled:not([aria-disabled="true"])';
    expect(declaration(stop, "color")).toBe("var(--cv-danger)");
    expect(declaration(stop, "background")).toBe("var(--cv-danger-soft)");
    expect(declaration(stop, "box-shadow")).toBe("var(--cv-ring-danger-soft)");
    expect(declaration(stop, "border")).toBe("0");
    expect(declaration(stop, "height")).toBe("24px");
    expect(declaration(hover, "color")).toBe("var(--cv-danger)");
    expect(varReferences(declaration(hover, "background") ?? "")).toEqual(["--cv-danger"]);
    expect(declaration(stopping, "color")).toBe("var(--cv-fg-subtle)");
    expect(declaration(stopping, "box-shadow")).toBe("none");
    expect(declaration(stopping, "cursor")).toBe("default");
    expect(varReferences(declaration(stopping, "background") ?? "")).toEqual(["--cv-tint-1"]);
    expect(declaration(stopping, "height")).toBeUndefined();
    expect(sheet.source).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.cv-agents-row__stop,[\s\S]*transition: none/,
    );
  });

  it("uses static status dots and animates only the live spawn lead", () => {
    const animated = parsed.rules.filter((rule) =>
      rule.declarations.some((entry) => entry.property === "animation" && entry.value !== "none"),
    );
    expect(animated.map((rule) => rule.selector)).toEqual([
      '.cv-spawn[data-live="true"] .cv-spawn__lead',
    ]);
    expect(declaration(".cv-agents-row__dot", "background")).toBe("var(--cv-work)");
    expect(
      declaration('.cv-agents-row[data-status="failed"] .cv-agents-row__dot', "background"),
    ).toBe("var(--cv-danger)");
    expect(sheet.source).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("fills the right panel as a flex column without an overlay or docked column", () => {
    expect(declaration(".agents-dock", "display")).toBe("flex");
    expect(declaration(".agents-dock__main", "flex-direction")).toBe("column");
    expect(sheet.source).not.toContain("data-agents");
    expect(sheet.source).not.toContain(".agents-panel");
  });

  it("mirrors the mockup spawn row geometry and honours reduced motion", () => {
    expect(declaration(".cv-spawn__head", "min-height")).toBe("26px");
    expect(declaration(".cv-spawn__members", "margin")).toBe("2px 0 0 28px");
    expect(declaration(".cv-spawn__open", "height")).toBe("22px");
    expect(sheet.source).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.cv-spawn\[data-live="true"\] \.cv-spawn__lead[\s\S]*animation: none/,
    );
  });

  it("shows keyboard focus as a 2px accent underline on the title instead of a ring", () => {
    for (const selector of [
      ".cv-spawn__head:focus-visible",
      ".cv-spawn-member__head:focus-visible",
      ".cv-spawn__open:focus-visible",
    ]) {
      expect(declaration(selector, "box-shadow"), selector).toBe("none");
      expect(declaration(selector, "outline"), selector).toBe("none");
    }
    for (const selector of [
      ".cv-spawn__head:focus-visible > .cv-spawn__lead",
      ".cv-spawn-member__head:focus-visible > .cv-spawn-member__title",
      ".cv-spawn__open:focus-visible",
    ]) {
      expect(declaration(selector, "text-decoration"), selector).toBe("underline");
      expect(declaration(selector, "text-decoration-color"), selector).toBe("var(--cv-focus)");
      expect(declaration(selector, "text-decoration-thickness"), selector).toBe("2px");
    }
    expect(declaration(".cv-spawn__head:hover", "text-decoration")).toBeUndefined();
  });
});
