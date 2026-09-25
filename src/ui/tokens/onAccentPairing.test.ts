import { describe, expect, it } from "vitest";
import {
  buildTokenTable,
  parseAllStyleSheets,
  selectorParts,
  varReferences,
  type CssRule,
  type TokenTable,
} from "../../components/cssContractTestSupport";

const ON_ACCENT = "--cv-on-accent";
const ACCENT = "--cv-accent";
const ACCENT_FILL = "--cv-accent-fill";
const FG_STRONG = "--cv-fg-strong";
const BACKGROUND_PROPERTIES = new Set(["background", "background-color"]);
const MAX_CHAIN_DEPTH = 6;
const SINGLE_VAR = /^var\((--[\w-]+)\)$/;
const COLOR_MIX = /^color-mix\(in srgb, (var\(--[\w-]+\)) (\d+)%, ([^,]+)\)$/;
const HOVER_MIX = /^color-mix\(in srgb, var\((--[\w-]+)\) 94%, var\((--[\w-]+)\)\)$/;

const BACKGROUND_FROM_SIBLING_RULE: ReadonlyArray<{
  readonly sheet: string;
  readonly selector: string;
  readonly reason: string;
}> = [
  {
    sheet: "ui/foundation/controls.css",
    selector: ".cv-checkbox",
    reason: "the glyph is hidden unless aria-checked, whose rule paints --cv-accent-fill",
  },
  {
    sheet: "ui/foundation/buttons.css",
    selector: ".cv-button--primary:disabled",
    reason: "keeps the .cv-button--primary --cv-accent-fill background",
  },
  {
    sheet: "components/toastNotification.css",
    selector: ".toast-notification-action--primary.toast-notification-action--busy::before",
    reason: "spinner pseudo-element drawn over the primary action --cv-accent-fill background",
  },
];

const parsed = parseAllStyleSheets();
const tokens = buildTokenTable(parsed.rules);

function reachableNames(value: string, table: TokenTable): ReadonlySet<string> {
  const seen = new Set<string>();
  const queue = varReferences(value).map((name) => ({ name, depth: 0 }));
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || seen.has(next.name) || next.depth > MAX_CHAIN_DEPTH) continue;
    seen.add(next.name);
    for (const declared of table.get(next.name) ?? []) {
      for (const name of varReferences(declared)) queue.push({ name, depth: next.depth + 1 });
    }
  }
  return seen;
}

function resolvesTo(value: string, target: string): boolean {
  return reachableNames(value, tokens).has(target);
}

function isFillBackground(value: string): boolean {
  const names = reachableNames(value, tokens);
  return names.has(ACCENT_FILL) && !names.has(ACCENT);
}

function isAllowedHoverBackground(value: string): boolean {
  if (varReferences(value).length === 1 && value.startsWith("var(")) {
    return isFillBackground(value);
  }
  const match = HOVER_MIX.exec(value);
  if (match === null) return false;
  return isFillBackground(`var(${match[1]})`) && resolvesTo(`var(${match[2]})`, FG_STRONG);
}

function isSolidAccent(value: string, depth: number): boolean {
  if (depth > MAX_CHAIN_DEPTH) return false;
  const single = SINGLE_VAR.exec(value);
  if (single !== null) {
    if (single[1] === ACCENT) return true;
    return (tokens.get(single[1] ?? "") ?? []).some((declared) =>
      isSolidAccent(declared, depth + 1),
    );
  }
  const mix = COLOR_MIX.exec(value);
  if (mix === null) return false;
  const weight = Number(mix[2]);
  if (weight >= 50) return isSolidAccent(mix[1] ?? "", depth + 1);
  return isSolidAccent(mix[3] ?? "", depth + 1);
}

function backgrounds(rule: CssRule): readonly string[] {
  return rule.declarations
    .filter((declaration) => BACKGROUND_PROPERTIES.has(declaration.property))
    .map((declaration) => declaration.value);
}

function onAccentRules(rules: readonly CssRule[]): readonly CssRule[] {
  return rules.filter((rule) =>
    rule.declarations.some(
      (declaration) => declaration.property === "color" && resolvesTo(declaration.value, ON_ACCENT),
    ),
  );
}

function overridesTextColor(rule: CssRule): boolean {
  return rule.declarations.some(
    (declaration) => declaration.property === "color" && !resolvesTo(declaration.value, ON_ACCENT),
  );
}

function isAllowlisted(rule: CssRule): boolean {
  return BACKGROUND_FROM_SIBLING_RULE.some(
    (entry) => entry.sheet === rule.sheet && entry.selector === rule.selector,
  );
}

function ruleKey(rule: CssRule): string {
  return `${rule.sheet} ${rule.selector}`;
}

describe("on-accent text pairing", () => {
  it("parses every stylesheet", () => {
    expect(parsed.issues).toEqual([]);
  });

  it("paints every on-accent text rule on the accent fill in the same rule", () => {
    const unpaired = onAccentRules(parsed.rules)
      .filter((rule) => !isAllowlisted(rule))
      .filter((rule) => {
        const values = backgrounds(rule);
        return values.length === 0 || !values.every(isFillBackground);
      })
      .map((rule) => `${ruleKey(rule)} -> ${backgrounds(rule).join(" | ") || "no background"}`);

    expect(unpaired).toEqual([]);
  });

  it("never declares a text colour on a plain accent background", () => {
    const offenders = parsed.rules
      .filter((rule) => rule.declarations.some((declaration) => declaration.property === "color"))
      .filter((rule) => backgrounds(rule).some((value) => isSolidAccent(value, 0)))
      .map((rule) => `${ruleKey(rule)} -> ${backgrounds(rule).join(" | ")}`);

    expect(offenders).toEqual([]);
  });

  it("keeps every allowlisted pairing alive", () => {
    const present = new Set(onAccentRules(parsed.rules).map(ruleKey));
    const stale = BACKGROUND_FROM_SIBLING_RULE.map(
      (entry) => `${entry.sheet} ${entry.selector}`,
    ).filter((key) => !present.has(key));

    expect(stale).toEqual([]);
  });

  it("keeps hover and state variants of on-accent rules on the accent fill", () => {
    const bases = onAccentRules(parsed.rules).flatMap((rule) =>
      selectorParts(rule.selector).map((part) => ({ sheet: rule.sheet, part })),
    );
    const offenders = parsed.rules
      .filter((rule) =>
        selectorParts(rule.selector).some((part) =>
          bases.some((base) => base.sheet === rule.sheet && part.startsWith(`${base.part}:`)),
        ),
      )
      .filter((rule) => !overridesTextColor(rule))
      .flatMap((rule) =>
        backgrounds(rule)
          .filter((value) => !isAllowedHoverBackground(value))
          .map((value) => `${ruleKey(rule)} -> ${value}`),
      );

    expect(offenders).toEqual([]);
  });
});
