import { describe, expect, it } from "vitest";
import { contrastRatio } from "../../domain/themeContrast";
import {
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
  type CssRule,
  type TokenTable,
} from "../../components/cssContractTestSupport";
import { AGENT_TYPE_SCALE_VARIABLE } from "../../components/appShellTypeScale";

const SHEET = "ui/tokens/semantic.css";
const SCHEMES = ["dark", "light"] as const;
const FILE_TYPES = [
  "ts",
  "tsx",
  "js",
  "json",
  "npm",
  "md",
  "css",
  "sh",
  "docker",
  "git",
  "env",
  "lock",
];
const SYMBOLS = [
  "method",
  "property",
  "const",
  "class",
  "interface",
  "enum",
  "function",
  "trait",
  "variable",
  "keyword",
];
const VISIBILITIES = ["public", "private", "protected"];
const SCHEMED_TOKENS = [
  "--cv-ok-soft",
  "--cv-danger-soft",
  "--cv-shadow-card",
  ...FILE_TYPES.map((kind) => `--cv-ft-${kind}`),
  "--cv-sym-badge-fg",
  ...SYMBOLS.map((kind) => `--cv-sym-${kind}`),
  ...VISIBILITIES.map((kind) => `--cv-vis-${kind}`),
];
const MINIMUM_ICON_CONTRAST = 3;

const parsed = parseAllStyleSheets();

function rules(scheme: (typeof SCHEMES)[number] | "root") {
  return parsed.rules.filter(
    (rule) =>
      rule.sheet === SHEET &&
      rule.context.length === 0 &&
      (scheme === "root"
        ? rule.selector === ":root"
        : selectorParts(rule.selector).includes(`:root[data-cv-scheme="${scheme}"]`)),
  );
}

function schemeValue(scheme: (typeof SCHEMES)[number], value: string): string {
  const name = /^var\((--[\w-]+)\)$/.exec(value)?.[1] ?? "";
  const resolved = lastOf(table(scheme).get(name)) ?? lastOf(table("root").get(name)) ?? "";
  expect(resolved, `${scheme} ${value}`).toMatch(/^#[0-9a-f]{6}$/i);
  return resolved;
}

function table(scheme: (typeof SCHEMES)[number] | "root"): TokenTable {
  return buildTokenTable(rules(scheme));
}

describe("replacement tokens for retired legacy variables", () => {
  it("declares every schemed replacement in both palette schemes", () => {
    const missing = SCHEMES.flatMap((scheme) => {
      const declared = table(scheme);
      return SCHEMED_TOKENS.filter((name) => !declared.has(name)).map(
        (name) => `${scheme} ${name}`,
      );
    });

    expect(missing).toEqual([]);
  });

  it("drives the thread type scale from the app shell with a neutral default", () => {
    expect(AGENT_TYPE_SCALE_VARIABLE).toBe("--cv-type-scale");
    expect(lastOf(table("root").get("--cv-type-scale"))).toBe("1");
  });

  it("paints native controls in the palette scheme, not the classic syntax theme", () => {
    for (const scheme of SCHEMES) {
      const values = rules(scheme)
        .flatMap((rule) => rule.declarations)
        .filter((declaration) => declaration.property === "color-scheme")
        .map((declaration) => declaration.value);
      expect(values, scheme).toEqual([scheme]);
    }
  });

  it("keeps the rendered symbol badge glyph readable on every symbol kind in both schemes", () => {
    const badgeRules = parsed.rules.filter(
      (rule) =>
        rule.sheet === "App.css" &&
        rule.context.length === 0 &&
        /^\.symbol-icon(\[data-kind="[a-z]+"\])?$/.test(rule.selector),
    );
    const base = badgeRules.find((rule) => rule.selector === ".symbol-icon");
    const declared = (rule: CssRule | undefined, property: string) =>
      lastOf(rule?.declarations.filter((declaration) => declaration.property === property))
        ?.value ?? "";
    const foreground = declared(base, "color");
    const kinds = badgeRules.map((rule) => ({
      selector: rule.selector,
      background: declared(rule, "background"),
    }));

    expect(foreground).toBe("var(--cv-sym-badge-fg)");
    expect(kinds.length).toBeGreaterThanOrEqual(SYMBOLS.length - 1);

    const unreadable = SCHEMES.flatMap((scheme) =>
      kinds
        .map(({ selector, background }) => ({
          selector,
          fg: schemeValue(scheme, foreground),
          bg: schemeValue(scheme, background),
        }))
        .filter(({ fg, bg }) => contrastRatio(fg, bg) < MINIMUM_ICON_CONTRAST)
        .map(({ selector, fg, bg }) => `${scheme} ${selector} ${fg} on ${bg}`),
    );

    expect(unreadable).toEqual([]);
  });
});
