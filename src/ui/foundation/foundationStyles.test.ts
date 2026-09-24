import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  parseAllStyleSheets,
  selectorParts,
  varReferences,
} from "../../components/cssContractTestSupport";

const parsed = parseAllStyleSheets();
const foundationRules = parsed.rules.filter((rule) => rule.sheet.startsWith("ui/foundation/"));
const tokenRules = parsed.rules.filter((rule) => rule.sheet.startsWith("ui/tokens/"));
const declared = new Set(
  [...tokenRules, ...foundationRules]
    .flatMap((rule) => rule.declarations.map((declaration) => declaration.property))
    .filter((property) => property.startsWith("--cv-")),
);
const MOTION_PROPERTIES = new Set([
  "transition",
  "transition-duration",
  "animation",
  "animation-duration",
]);
const DURATION_LITERAL = /(^|[\s,(])\d+(\.\d+)?m?s\b/;
const MOTION_TOKEN = /var\(--cv-motion-(fast|base|slow|spin)\)/;
const LEGACY_TOKEN = /var\(\s*--(color|agent|codevo|settings|toast|change)-/;
const CLASS_NAME = /\.(-?[_a-zA-Z][\w-]*)/g;
const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";

function declarations() {
  return foundationRules.flatMap((rule) =>
    rule.declarations.map((declaration) => ({ rule, declaration })),
  );
}

describe("foundation stylesheets", () => {
  it("exist and parse cleanly", () => {
    expect(parsed.issues).toEqual([]);
    expect(foundationRules.length).toBeGreaterThan(0);
  });

  it("declare no colour literals", () => {
    const literals = declarations()
      .filter(({ declaration }) => COLOR_LITERAL.test(declaration.value))
      .map(({ rule, declaration }) => `${rule.sheet} ${rule.selector} ${declaration.property}`);

    expect(literals).toEqual([]);
  });

  it("reference only declared --cv tokens and never the legacy ones", () => {
    const undeclared = declarations().flatMap(({ rule, declaration }) =>
      varReferences(declaration.value)
        .filter((name) => name.startsWith("--cv-") && !declared.has(name))
        .map((name) => `${rule.sheet} ${rule.selector} ${name}`),
    );
    const legacy = declarations()
      .filter(({ declaration }) => LEGACY_TOKEN.test(declaration.value))
      .map(({ rule, declaration }) => `${rule.sheet} ${rule.selector} ${declaration.property}`);

    expect(undeclared).toEqual([]);
    expect(legacy).toEqual([]);
  });

  it("animate only through the motion tokens", () => {
    const offenders = declarations()
      .filter(({ declaration }) => MOTION_PROPERTIES.has(declaration.property))
      .filter(({ declaration }) => declaration.value !== "none")
      .filter(
        ({ declaration }) =>
          DURATION_LITERAL.test(declaration.value) || !MOTION_TOKEN.test(declaration.value),
      )
      .map(({ rule, declaration }) => `${rule.sheet} ${rule.selector}: ${declaration.value}`);

    expect(offenders).toEqual([]);
  });

  it("scope every class selector to the cv- namespace", () => {
    const foreign = foundationRules
      .flatMap((rule) => selectorParts(rule.selector))
      .flatMap((part) => [...part.matchAll(CLASS_NAME)].map((match) => match[1] ?? ""))
      .filter((name) => !name.startsWith("cv-"));

    expect(foreign).toEqual([]);
  });

  it("stops the spinner under reduced motion", () => {
    const reduced = foundationRules.filter(
      (rule) =>
        rule.context.includes(REDUCED_MOTION) &&
        selectorParts(rule.selector).includes(".cv-spinner"),
    );

    expect(
      reduced.flatMap((rule) => rule.declarations).find((entry) => entry.property === "animation")
        ?.value,
    ).toBe("none");
  });

  it("stacks popovers above dialogs and toasts above both", () => {
    const layer = (name: string) =>
      Number(
        tokenRules
          .filter((rule) => rule.sheet === "ui/tokens/semantic.css" && rule.selector === ":root")
          .flatMap((rule) => rule.declarations)
          .find((declaration) => declaration.property === name)?.value,
      );

    expect(layer("--cv-z-dialog")).toBeLessThan(layer("--cv-z-popover"));
    expect(layer("--cv-z-popover")).toBeLessThan(layer("--cv-z-toast"));
  });

  it("lets oversize menus and popovers scroll inside the viewport", () => {
    for (const surface of [".cv-menu", ".cv-popover"]) {
      const values = new Map(
        foundationRules
          .filter(
            (rule) => rule.sheet === "ui/foundation/overlays.css" && rule.context.length === 0,
          )
          .filter((rule) => selectorParts(rule.selector).includes(surface))
          .flatMap((rule) => rule.declarations)
          .map((declaration) => [declaration.property, declaration.value]),
      );

      expect(values.get("position")).toBe("fixed");
      expect(values.get("max-height")).toBe("calc(100vh - 16px)");
      expect(values.get("overflow-y")).toBe("auto");
      expect(
        ["transform", "filter", "contain", "will-change"].filter((key) => values.has(key)),
      ).toEqual([]);
    }
  });
});
