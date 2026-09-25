import { describe, expect, it } from "vitest";
import { lastOf, parseAllStyleSheets, selectorParts, type CssRule } from "./cssContractTestSupport";

const ACCENT_RING = /--cv-ring-focus|--cv-focus\b|--cv-accent|--settings-focus-ring/;
const RING_PROPERTIES = new Set(["box-shadow", "outline", "outline-color", "border-color"]);
const NON_TEXT_INPUT =
  /input\[type="(checkbox|radio|range|button|submit|reset|color|file|image)"\]/;
const TEXT_ENTRY_FOCUS = /(^|[\s>+~(])(input|textarea)(?![\w-])[^\s,>+~]*:focus(-visible)?$/;

const FOCUS_WITHIN_NON_TEXT_CONTAINERS: ReadonlySet<string> = new Set([
  ".settings-screen .settings-select:focus-within",
  ".cv-esub__acts:focus-within",
]);

const TEXT_ENTRY_CONTAINERS = [
  ".cv-composer__slab:focus-within",
  ".cv-bpick__field",
  ".cv-sb-search__field:focus-within",
  ".cv-files__search:focus-within",
  ".cv-git-box:focus-within",
] as const;

const TEXT_ENTRY_FIELDS = [
  ".cv-input:focus-visible",
  ".cv-textarea:focus-visible",
  ".cv-snooze__input:focus-visible",
  ".cv-card-row__rename",
  ".agent-remote-add-project__field input:focus-visible",
] as const;

const { rules, issues } = parseAllStyleSheets();

function rulesFor(selector: string): readonly CssRule[] {
  return rules.filter((rule) => selectorParts(rule.selector).includes(selector));
}

function ringValues(selector: string): readonly string[] {
  return rulesFor(selector).flatMap((rule) =>
    rule.declarations
      .filter((declaration) => RING_PROPERTIES.has(declaration.property))
      .map((declaration) => declaration.value),
  );
}

function focusWithinTextContainers(): readonly string[] {
  const found = rules.flatMap((rule) =>
    selectorParts(rule.selector).filter(
      (part) => part.endsWith(":focus-within") && !FOCUS_WITHIN_NON_TEXT_CONTAINERS.has(part),
    ),
  );
  return [...new Set(found)].sort();
}

function declarationValue(sheet: string, selector: string, property: string): string | undefined {
  return lastOf(
    rulesFor(selector)
      .filter((rule) => rule.sheet === sheet && rule.context.length === 0)
      .flatMap((rule) => rule.declarations)
      .filter((declaration) => declaration.property === property)
      .map((declaration) => declaration.value),
  );
}

describe("text-entry focus contract", () => {
  it("parses every stylesheet", () => {
    expect(issues).toEqual([]);
  });

  it("exempts text-entry elements from the global accent focus ring", () => {
    const globalIndex = rules.findIndex(
      (rule) => rule.sheet === "App.css" && rule.selector === ":focus-visible",
    );
    const exemptionIndex = rules.findIndex(
      (rule) =>
        rule.sheet === "App.css" &&
        rule.selector.startsWith(":where(") &&
        rule.selector.endsWith(":focus-visible") &&
        rule.selector.includes("textarea") &&
        rule.selector.includes('[type="checkbox"]'),
    );

    expect(globalIndex).toBeGreaterThanOrEqual(0);
    expect(exemptionIndex).toBeGreaterThan(globalIndex);
    expect(rules[exemptionIndex]?.declarations).toEqual([
      { property: "box-shadow", value: "none" },
    ]);
  });

  it("never paints an accent ring on a focused text input or textarea", () => {
    const offenders = rules.flatMap((rule) =>
      selectorParts(rule.selector)
        .filter((part) => TEXT_ENTRY_FOCUS.test(part) && !NON_TEXT_INPUT.test(part))
        .flatMap((part) =>
          rule.declarations
            .filter(
              (declaration) =>
                RING_PROPERTIES.has(declaration.property) && ACCENT_RING.test(declaration.value),
            )
            .map((declaration) => `${rule.sheet} ${part} ${declaration.property}`),
        ),
    );

    expect(offenders).toEqual([]);
  });

  it.each([...TEXT_ENTRY_CONTAINERS, ...TEXT_ENTRY_FIELDS])(
    "keeps %s on a neutral focus tone",
    (selector) => {
      for (const value of ringValues(selector)) {
        expect(value, selector).not.toMatch(ACCENT_RING);
      }
    },
  );

  it("finds the text-field containers that react to :focus-within", () => {
    expect(focusWithinTextContainers()).toEqual(
      expect.arrayContaining([
        ".cv-composer__slab:focus-within",
        ".cv-sb-search__field:focus-within",
        ".cv-files__search:focus-within",
        ".cv-git-box:focus-within",
      ]),
    );
  });

  it.each(focusWithinTextContainers())(
    "shows a neutral focus indicator on %s, not only a tint",
    (selector) => {
      const indicators = ringValues(selector).filter(
        (value) => !/^(none|0|transparent)$/.test(value) && !ACCENT_RING.test(value),
      );
      expect(indicators, selector).not.toEqual([]);
    },
  );

  it.each([
    ["components/agentMode/rightPanel/files/agentFiles.css", ".cv-files__search:focus-within"],
    ["components/agentMode/agentSidebar.css", ".cv-sb-search__field:focus-within"],
  ])("rings %s %s with the neutral hairline", (sheet, selector) => {
    expect(declarationValue(sheet, selector, "box-shadow")).toBe("var(--cv-ring-hair-strong)");
  });

  it("renders the composer as one surface without an inner framed box", () => {
    expect(
      declarationValue(
        "components/agentMode/composer/agentComposerFrame.css",
        ".cv-composer__slab:focus-within",
        "box-shadow",
      ),
    ).toContain("var(--cv-ring-hair-strong)");

    for (const selector of [".agent-composer__box", ".agent-composer__textarea"]) {
      for (const property of ["background", "box-shadow", "border", "outline"]) {
        const value = declarationValue(
          "components/agentMode/composer/agentComposerFrame.css",
          selector,
          property,
        );
        expect(value === undefined || /^(none|0)$/.test(value), `${selector} ${property}`).toBe(
          true,
        );
      }
    }
  });

  it("keeps the global keyboard ring for non-text controls", () => {
    expect(declarationValue("App.css", ":focus-visible", "box-shadow")).toBe(
      "var(--cv-ring-focus)",
    );
  });

  it.each([
    ["ui/foundation/buttons.css", ".cv-button:focus-visible"],
    ["ui/foundation/buttons.css", ".cv-icon-button:focus-visible"],
    ["ui/foundation/controls.css", ".cv-checkbox:focus-visible"],
    ["ui/foundation/controls.css", ".cv-switch:focus-visible"],
    ["ui/foundation/panels.css", ".cv-tab:focus-visible"],
    ["ui/foundation/panels.css", ".cv-tree-row:focus-visible"],
  ])("keeps the accent focus outline on %s %s", (sheet, selector) => {
    expect(declarationValue(sheet, selector, "outline")).toBe("2px solid var(--cv-focus)");
  });

  it.each([
    ["components/agentMode/agentSidebar.css", ".cv-card-row:focus-visible"],
    ["components/agentMode/rightPanel/rightPanel.css", ".cv-rp-ctl:focus-visible"],
    ["components/agentMode/rightPanel/files/agentFiles.css", ".cv-files__result:focus-visible"],
  ])("keeps the accent focus ring on %s %s", (sheet, selector) => {
    expect(declarationValue(sheet, selector, "box-shadow")).toBe("var(--cv-ring-focus)");
  });
});
