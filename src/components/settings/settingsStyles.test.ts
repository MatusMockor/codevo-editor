import { describe, expect, it } from "vitest";
import {
  listStyleSheets,
  parseAllStyleSheets,
  parseCssRules,
  readStyleSheet,
  selectorParts,
  stripCssComments,
  varReferences,
  type CssRule,
} from "../cssContractTestSupport";

const SETTINGS_SHEET_ROOTS = ["components/settings/", "components/usage/"] as const;
const REQUIRED_SHEETS = [
  "components/settings/settings.css",
  "components/settings/settingsShell.css",
  "components/settings/pages/environmentsSettings.css",
] as const;
const SHARED_CONTROL_PREFIXES = [
  ".settings-select",
  ".settings-input",
  ".settings-numfield",
  ".settings-btn",
  ".settings-segmented",
  ".settings-chip",
  ".settings-kbd",
  ".settings-popover",
  ".settings-mappings",
  ".settings-snippet",
] as const;
const COLOR_PROPERTIES = new Set(["color", "background", "background-color", "box-shadow"]);
const COLOR_KEYWORDS = new Set(["none", "transparent", "inherit", "currentcolor"]);
const RADIUS_KEYWORDS = new Set(["0", "50%", "inherit"]);

const sheets = listStyleSheets().filter((sheet) =>
  SETTINGS_SHEET_ROOTS.some((root) => sheet.startsWith(root)),
);
const declaredTokens = new Set(
  parseAllStyleSheets().rules.flatMap((rule) =>
    rule.declarations
      .filter((declaration) => declaration.property.startsWith("--"))
      .map((declaration) => declaration.property),
  ),
);

describe("settings stylesheets", () => {
  it("covers every settings stylesheet", () => {
    expect(sheets).toEqual(expect.arrayContaining([...REQUIRED_SHEETS]));
  });

  it.each(sheets)("%s uses only --cv tokens or the local --settings aliases", (sheet) => {
    const source = readStyleSheet(sheet).source;
    const legacy = source.match(/var\(--(codevo|color|agent)-[\w-]+/gu) ?? [];

    expect(legacy).toEqual([]);
  });

  it.each(sheets)("%s declares no raw colours", (sheet) => {
    const source = stripCssComments(readStyleSheet(sheet).source);
    const literals = source.match(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch)\(/giu) ?? [];

    expect(literals).toEqual([]);
  });

  it.each(sheets)("%s references only declared custom properties", (sheet) => {
    const undeclared = sheetRules(sheet)
      .flatMap((rule) =>
        rule.declarations.flatMap((declaration) => varReferences(declaration.value)),
      )
      .filter((token) => !declaredTokens.has(token));

    expect([...new Set(undeclared)]).toEqual([]);
  });

  it("styles the shared controls directly on --cv tokens", () => {
    const violations = sharedControlRules().flatMap((rule) =>
      rule.declarations
        .filter((declaration) => !isTokenDeclaration(declaration.property, declaration.value))
        .map((declaration) => `${rule.selector} { ${declaration.property}: ${declaration.value} }`),
    );

    expect(violations).toEqual([]);
  });

  it("gives fields and steppers the mockup hairline ring and control radius", () => {
    expect(declaration(".settings-select, .settings-input", "box-shadow")).toBe(
      "var(--cv-ring-hair-strong)",
    );
    expect(declaration(".settings-select, .settings-input", "font-size")).toBe("var(--cv-t-md)");
    expect(declaration(".settings-numfield", "box-shadow")).toBe("var(--cv-ring-hair-strong)");
    expect(declaration(".settings-numfield", "border-radius")).toBe("var(--cv-r-control)");
    expect(declaration(".settings-btn--micro", "height")).toBe("24px");
    expect(declaration(".settings-btn--xsq", "border-radius")).toBe("var(--cv-r-sm)");
  });

  it("marks the selected palette card with the selection ring, not the focus ring", () => {
    const selected = paletteCardDeclarations('.settings-palette-card[aria-checked="true"]');

    expect(selected.get("box-shadow")).toBe("var(--cv-ring-selected)");
    expect(selected.get("background")).toBe("var(--cv-tint-2)");
    expect(
      paletteCardDeclarations(".settings-screen .settings-palette-card:focus-visible").get(
        "box-shadow",
      ),
    ).toBe("var(--cv-ring-focus)");
    expect(
      paletteCardDeclarations(
        '.settings-screen .settings-palette-card[aria-checked="true"]:focus-visible',
      ).get("box-shadow"),
    ).toBe("var(--cv-ring-selected), var(--cv-ring-focus)");
  });
});

function paletteCardDeclarations(selector: string): ReadonlyMap<string, string> {
  const rules = sheetRules("components/settings/settings.css").filter((rule) =>
    selectorParts(rule.selector).includes(selector),
  );

  return new Map(
    rules.flatMap((rule) =>
      rule.declarations.map((candidate) => [candidate.property, candidate.value] as const),
    ),
  );
}

function sheetRules(sheet: string): readonly CssRule[] {
  return parseCssRules(readStyleSheet(sheet).source, sheet).rules;
}

function sharedControlRules(): readonly CssRule[] {
  return sheetRules("components/settings/settings.css").filter((rule) =>
    selectorParts(rule.selector).every((part) =>
      SHARED_CONTROL_PREFIXES.some((prefix) => part.startsWith(prefix)),
    ),
  );
}

function declaration(selector: string, property: string): string | undefined {
  const rule = sharedControlRules().find(
    (candidate) => selectorParts(candidate.selector).join(", ") === selector,
  );

  return rule?.declarations.find((candidate) => candidate.property === property)?.value;
}

function isTokenDeclaration(property: string, value: string): boolean {
  if (/var\(--settings-/u.test(value)) return false;
  if (property === "font-size") return /^var\(--cv-t-[\w-]+\)$/u.test(value);
  if (property === "border-radius") {
    return RADIUS_KEYWORDS.has(value) || /^var\(--cv-r-[\w-]+\)$/u.test(value);
  }
  if (!COLOR_PROPERTIES.has(property)) return true;
  if (COLOR_KEYWORDS.has(value)) return true;
  return /var\(--cv-/u.test(value);
}
