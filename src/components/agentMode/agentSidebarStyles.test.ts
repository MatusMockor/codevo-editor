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
    expect(declaration(".cv-favicon", "width")).toBe("16px");
  });

  it("keeps project groups compact and their hover actions out of the way until needed", () => {
    expect(declaration(".cv-sb-project__toggle", "height")).toBe("30px");
    expect(declaration(".cv-card-row.is-grouped", "height")).toBe("56px");
    expect(declaration(".cv-sb-project__actions", "opacity")).toBe("0");
    expect(declaration(".cv-sb-project__head:hover .cv-sb-project__actions", "opacity")).toBe("1");
    expect(
      declaration(".cv-sb-project__head:focus-within .cv-sb-project__actions", "opacity"),
    ).toBe("1");
    expect(
      declaration(
        '.cv-sb-project__toggle[aria-expanded="true"] .cv-sb-project__chevron',
        "transform",
      ),
    ).toBe("rotate(90deg)");
  });

  it("keeps the t3code card row geometry", () => {
    expect(declaration(".cv-card-row", "height")).toBe("78px");
    expect(declaration(".cv-card-row", "padding")).toBe("8px 10px");
    expect(declaration(".cv-card-row", "border-radius")).toBe("var(--cv-r-control)");
    expect(declaration(".cv-card-row__act", "top")).toBe("10px");
  });

  it("paints Working in the --cv-work blue and fades unfocused working rows until hovered", () => {
    expect(declaration('.cv-card-row__status[data-tone="work"]', "color")).toBe("var(--cv-work)");
    expect(
      declaration('.cv-card-row__status[data-tone="work"] .cv-card-row__tick', "font-weight"),
    ).toBe("500");
    expect(declaration('.cv-sb-project__signal[data-tone="working"]', "background")).toBe(
      "var(--cv-work)",
    );
    expect(declaration(".cv-card-row.is-fade", "opacity")).toBe("0.7");
    expect(declaration(".cv-card-row.is-fade:hover", "opacity")).toBe("1");
    expect(declaration(".cv-card-row.is-fade:focus-visible", "opacity")).toBe("1");
    expect(declaration(".cv-card-row.is-fade:has(.cv-card-row__rename)", "opacity")).toBe("1");
    expect(declaration(".cv-card-row", "transition")).toBe(
      "opacity var(--cv-motion-base) var(--cv-ease)",
    );
    expect(declaration('.cv-sb-item[data-menu-open="true"] .cv-card-row.is-fade', "opacity")).toBe(
      "1",
    );
  });

  it("marks an unseen completion with a green dot, bold label, bold title and a faint tint", () => {
    const unseen =
      '.cv-sb-item:not([data-menu-open="true"]) > .cv-card-row.is-unread-done:not(.is-current):not(.is-marked)';
    expect(declaration('.cv-card-row__status[data-tone="ok"]', "color")).toBe("var(--cv-ok)");
    expect(declaration('.cv-card-row__status[data-tone="ok"]', "font-weight")).toBe("700");
    expect(declaration(".cv-card-row__done-dot", "width")).toBe("8px");
    expect(declaration(".cv-card-row__done-dot", "border-radius")).toBe("50%");
    expect(declaration(".cv-card-row__done-dot", "background")).toBe("var(--cv-ok)");
    expect(declaration(".cv-card-row__done-dot::before", "inset")).toBe("-3px");
    expect(declaration(".cv-card-row__done-dot::before", "background")).toBe(
      "color-mix(in srgb, var(--cv-ok) 18%, transparent)",
    );
    expect(declaration(unseen, "background")).toBe(
      "color-mix(in srgb, var(--cv-ok) 7%, transparent)",
    );
    expect(declaration(`${unseen}:hover`, "background")).toBe(
      "color-mix(in srgb, var(--cv-ok) 10%, transparent)",
    );
    expect(declaration(".cv-card-row.is-unread-done .cv-card-row__title", "font-weight")).toBe(
      "600",
    );
    expect(declaration(".cv-card-row.is-unread-done .cv-card-row__title", "color")).toBe(
      "var(--cv-fg-strong)",
    );
  });

  it("lets a seen completion calm down to the receded time-only row", () => {
    expect(declaration(".cv-card-row.is-recede .cv-card-row__title", "color")).toBe(
      "var(--cv-fg-muted)",
    );
    expect(declaration(".cv-card-row.is-recede .cv-card-row__title", "font-weight")).toBe("400");
    expect(declaration(".cv-card-row__when", "font-variant-numeric")).toBe("tabular-nums");
  });

  it("adds no focus ring for the new working and done row states", () => {
    for (const rule of parsed.rules) {
      if (!/is-fade|is-unread-done|done-dot/.test(rule.selector)) continue;
      for (const entry of rule.declarations) {
        expect(`${rule.selector} ${entry.property}`).not.toMatch(/ outline$/);
        expect(entry.value, rule.selector).not.toContain("--cv-ring-focus");
        expect(entry.value, rule.selector).not.toContain("--cv-focus");
        expect(entry.value, rule.selector).not.toContain("--cv-accent");
      }
    }
  });

  it("keeps the shelves and search results on the mockup geometry", () => {
    expect(declaration(".cv-sb-shelf", "height")).toBe("36px");
    expect(declaration(".cv-sr", "min-height")).toBe("36px");
    expect(declaration(".cv-sr mark", "background")).toBe("transparent");
  });
});
