import { describe, expect, it } from "vitest";
import {
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
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
});
