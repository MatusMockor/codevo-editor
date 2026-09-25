import { describe, expect, it } from "vitest";
import { PALETTE_IDS, RESOLVED_COLOR_SCHEMES } from "../../domain/appearance";
import {
  PALETTE_TOKEN_NAMES,
  SCHEME_SURFACE_ROLES,
  cssTokenName,
  paletteTokens,
  type SurfaceRole,
} from "../../domain/appearancePalettes";
import {
  SHADOW_TOKEN_ROOTS,
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
  type CssRule,
} from "../../components/cssContractTestSupport";

const parsed = parseAllStyleSheets();
const PALETTE_SHEET = "ui/tokens/palettes.css";
const SEMANTIC_SHEET = "ui/tokens/semantic.css";
const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";
const SURFACE_ROLES: readonly SurfaceRole[] = ["canvas", "side", "raised", "popover"];

function rulesFor(
  sheet: string,
  selector: string,
  context: readonly string[] = [],
): readonly CssRule[] {
  return parsed.rules.filter(
    (rule) =>
      rule.sheet === sheet &&
      rule.context.length === context.length &&
      rule.context.every((entry, index) => entry === context[index]) &&
      selectorParts(rule.selector).includes(selector),
  );
}

function declaredValues(rules: readonly CssRule[], prefix: string): Record<string, string> {
  return Object.fromEntries(
    [...buildTokenTable(rules, prefix).entries()].map(([name, values]) => [
      name,
      lastOf(values) ?? "",
    ]),
  );
}

function paletteSelector(palette: string, scheme: string): string {
  return `:root[data-cv-palette="${palette}"][data-cv-scheme="${scheme}"]`;
}

describe("palette token stylesheet", () => {
  it("parses every stylesheet cleanly", () => {
    expect(parsed.issues).toEqual([]);
  });

  it("declares every palette token exactly as the typed palette definitions", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        const tokens = paletteTokens(palette, scheme);
        const expected = Object.fromEntries(
          PALETTE_TOKEN_NAMES.map((name) => [cssTokenName(name), tokens[name]]),
        );

        expect(
          declaredValues(rulesFor(PALETTE_SHEET, paletteSelector(palette, scheme)), "--cv-"),
          `${palette} ${scheme}`,
        ).toEqual(expected);
        expect(
          declaredValues(rulesFor(PALETTE_SHEET, paletteSelector(palette, scheme)), "color-scheme"),
        ).toEqual({ "color-scheme": scheme });
      }
    }
  });

  it("paints Graphite · Teal when the document carries no palette attribute", () => {
    expect(declaredValues(rulesFor(PALETTE_SHEET, ":root"), "--cv-")).toEqual(
      declaredValues(rulesFor(PALETTE_SHEET, paletteSelector("graphite-teal", "dark")), "--cv-"),
    );
    expect(
      declaredValues(rulesFor(PALETTE_SHEET, ':root[data-cv-scheme="light"]'), "--cv-"),
    ).toEqual(
      declaredValues(rulesFor(PALETTE_SHEET, paletteSelector("graphite-teal", "light")), "--cv-"),
    );
  });

  it("keeps the typed palettes complete and pinned to the approved mockup", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        expect(Object.keys(paletteTokens(palette, scheme)).sort()).toEqual(
          [...PALETTE_TOKEN_NAMES].sort(),
        );
      }
    }
    expect(paletteTokens("graphite-teal", "dark").accent).toBe("#4FCDB3");
    expect(paletteTokens("slate-blue", "dark").accentFill).toBe("#2563EB");
    expect(paletteTokens("black-violet", "light").s2).toBe("#FFFFFF");
    expect(paletteTokens("zinc-orange", "dark").warn).toBe("#F2D049");
    expect(paletteTokens("carbon-lime", "light").onAccent).toBe("#162200");
    expect(paletteTokens("ink-mint", "light").hair).toBe("rgba(14, 20, 48, 0.085)");
  });

  it("derives kebab-case custom property names", () => {
    expect(cssTokenName("accentFill")).toBe("--cv-accent-fill");
    expect(cssTokenName("popBg")).toBe("--cv-pop-bg");
    expect(cssTokenName("s0")).toBe("--cv-s0");
    expect(cssTokenName("synKw")).toBe("--cv-syn-kw");
  });
});

describe("semantic token stylesheet", () => {
  it("maps surface roles to palette steps per scheme", () => {
    for (const scheme of RESOLVED_COLOR_SCHEMES) {
      const declared = declaredValues(
        rulesFor(SEMANTIC_SHEET, `:root[data-cv-scheme="${scheme}"]`),
        "--cv-",
      );
      for (const role of SURFACE_ROLES) {
        expect(declared[`--cv-${role}`], `${scheme} ${role}`).toBe(
          `var(${cssTokenName(SCHEME_SURFACE_ROLES[scheme][role])})`,
        );
      }
    }
  });

  it("declares every foundation shadow root the border contract allows", () => {
    const declared = new Set(
      parsed.rules
        .filter((rule) => rule.sheet === SEMANTIC_SHEET)
        .flatMap((rule) => rule.declarations.map((declaration) => declaration.property)),
    );
    const roots = SHADOW_TOKEN_ROOTS.filter((name) => name.startsWith("--cv-"));

    expect(roots).toHaveLength(23);
    expect(roots.filter((name) => !declared.has(name))).toEqual([]);
  });

  it("zeroes every motion duration under reduced motion", () => {
    const reduced = declaredValues(rulesFor(SEMANTIC_SHEET, ":root", [REDUCED_MOTION]), "--cv-");

    expect(reduced).toEqual({
      "--cv-motion-fast": "0ms",
      "--cv-motion-base": "0ms",
      "--cv-motion-slow": "0ms",
    });
  });
});
