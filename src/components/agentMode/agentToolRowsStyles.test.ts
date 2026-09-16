import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  lastOf,
  parseCssRules,
  readStyleSheet,
  selectorParts,
  type CssRule,
} from "../cssContractTestSupport";

const SHEET = "components/agentMode/agentToolRows.css";
const ALLOWED_RADII = ["var(--agent-radius-sm)", "var(--agent-radius-md)"];
const parsed = parseCssRules(readStyleSheet(SHEET).source, SHEET);

function rulesFor(selector: string, context: ReadonlyArray<string> = []): ReadonlyArray<CssRule> {
  return parsed.rules.filter(
    (rule) =>
      rule.context.length === context.length &&
      rule.context.every((entry, index) => entry === context[index]) &&
      selectorParts(rule.selector).includes(selector),
  );
}

function declaration(
  selector: string,
  property: string,
  context: ReadonlyArray<string> = [],
): string | null {
  const values = rulesFor(selector, context).flatMap((rule) =>
    rule.declarations.filter((entry) => entry.property === property).map((entry) => entry.value),
  );
  return lastOf(values) ?? null;
}

describe("agent tool row styles", () => {
  it("parses without issues and declares only tool row selectors", () => {
    expect(parsed.issues).toEqual([]);
    const foreign = parsed.rules
      .flatMap((rule) => selectorParts(rule.selector))
      .filter((part) => !part.includes(".agent-tool-row") && !/^(from|to)$/.test(part));

    expect(foreign).toEqual([]);
  });

  it("pins the row metrics taken from the mock", () => {
    expect(declaration(".agent-tool-row", "min-height")).toBe("26px");
    expect(declaration(".agent-tool-row", "padding")).toBe("2px 6px");
    expect(declaration(".agent-tool-row", "margin")).toBe("0 -6px");
    expect(declaration(".agent-tool-row", "gap")).toBe("8px");
    expect(declaration(".agent-tool-row", "border-radius")).toBe("var(--agent-radius-sm)");
    expect(declaration(".agent-tool-row", "font-size")).toBe("var(--agent-fs-sm)");
    expect(declaration(".agent-tool-row", "box-sizing")).toBe("border-box");
    expect(declaration(".agent-tool-row", "display")).toBe("flex");
    expect(declaration(".agent-tool-row", "align-items")).toBe("center");
  });

  it("uses the hover tone and keeps the working row inert", () => {
    expect(declaration(".agent-tool-row:hover", "background")).toBe("var(--agent-hover)");
    expect(declaration(".agent-tool-row--working:hover", "background")).toBe("transparent");
    expect(declaration(".agent-tool-row--working", "cursor")).toBe("default");
    expect(declaration(".agent-tool-row", "cursor")).toBe("pointer");
  });

  it("truncates the label and the mono argument on one line", () => {
    for (const selector of [".agent-tool-row__label", ".agent-tool-row__argument"]) {
      expect(declaration(selector, "overflow"), selector).toBe("hidden");
      expect(declaration(selector, "text-overflow"), selector).toBe("ellipsis");
      expect(declaration(selector, "white-space"), selector).toBe("nowrap");
    }
    expect(declaration(".agent-tool-row__label", "flex")).toBe("none");
    expect(declaration(".agent-tool-row__label", "max-width")).toBe("60%");
    expect(declaration(".agent-tool-row__argument", "flex")).toBe("1 1 0");
    expect(declaration(".agent-tool-row__argument", "min-width")).toBe("0");
    expect(declaration(".agent-tool-row__argument", "font-family")).toBe("var(--agent-mono)");
    expect(declaration(".agent-tool-row__argument", "font-size")).toBe("var(--agent-fs-2xs)");
    expect(declaration(".agent-tool-row__label", "color")).toBe("var(--agent-text)");
    expect(declaration(".agent-tool-row__label", "font-style")).toBe("normal");
  });

  it("mutes a row left unresolved by a stopped turn", () => {
    expect(declaration(".agent-tool-row--stopped .agent-tool-row__label", "color")).toBe(
      "var(--agent-text-subtle)",
    );
    expect(declaration(".agent-tool-row--stopped .agent-tool-row__icon", "color")).toBe(
      "var(--agent-text-subtle)",
    );
    expect(declaration(".agent-tool-row--stopped .agent-tool-row__label", "animation")).toBeNull();
  });

  it("colours a failed row with the danger token", () => {
    expect(declaration(".agent-tool-row--failed .agent-tool-row__label", "color")).toBe(
      "var(--agent-danger)",
    );
    expect(declaration(".agent-tool-row--failed .agent-tool-row__icon", "color")).toBe(
      "var(--agent-danger)",
    );
  });

  it("shimmers running and working labels and stops under reduced motion", () => {
    const shimmer = ".agent-tool-row--running .agent-tool-row__label";
    const working = ".agent-tool-row--working .agent-tool-row__label";
    expect(declaration(shimmer, "animation")).toBe("agent-tool-row-shimmer 1800ms linear infinite");
    expect(declaration(shimmer, "background-clip")).toBe("text");
    expect(declaration(shimmer, "color")).toBe("transparent");
    expect(declaration(shimmer, "-webkit-text-fill-color")).toBe("transparent");
    expect(declaration(working, "background-size")).toBe("200% 100%");

    const reduced = ["@media (prefers-reduced-motion: reduce)"];
    expect(declaration(shimmer, "animation", reduced)).toBe("none");
    expect(declaration(working, "animation", reduced)).toBe("none");
    expect(declaration(shimmer, "color", reduced)).toBe("var(--agent-text-muted)");
  });

  it("keeps the disclosure panel monospaced, welled and collapsible", () => {
    expect(declaration(".agent-tool-row__detail", "background")).toBe(
      "var(--agent-code-background)",
    );
    expect(declaration(".agent-tool-row__detail", "border-radius")).toBe("var(--agent-radius-md)");
    expect(declaration(".agent-tool-row__detail", "font-family")).toBe("var(--agent-mono)");
    expect(declaration(".agent-tool-row__detail", "font-size")).toBe("var(--agent-fs-2xs)");
    expect(declaration(".agent-tool-row__detail", "max-height")).toBe("260px");
    expect(declaration(".agent-tool-row__detail[hidden]", "display")).toBe("none");
    expect(declaration(".agent-tool-row__command", "white-space")).toBe("pre-wrap");
    expect(declaration(".agent-tool-row__output", "white-space")).toBe("pre-wrap");
  });

  it("holds the repository css contracts", () => {
    const declarations = parsed.rules.flatMap((rule) =>
      rule.declarations.map((entry) => ({ rule, entry })),
    );

    const borders = declarations
      .filter(({ entry }) => /^border(-|$)/.test(entry.property))
      .filter(({ entry }) => entry.value !== "0")
      .filter(({ entry }) => entry.property !== "border-radius")
      .map(({ rule, entry }) => `${rule.selector} ${entry.property}`);
    expect(borders).toEqual([]);

    const outlines = declarations
      .filter(({ entry }) => entry.property.startsWith("outline"))
      .filter(({ rule }) => !rule.selector.includes(":focus-visible"))
      .map(({ rule }) => rule.selector);
    expect(outlines).toEqual([]);

    const shadows = declarations
      .filter(({ entry }) => entry.property === "box-shadow")
      .map(({ entry }) => entry.value);
    expect(shadows).toEqual(["var(--agent-focus-ring)"]);

    const radii = declarations
      .filter(({ entry }) => entry.property === "border-radius")
      .map(({ entry }) => entry.value)
      .filter((value) => !ALLOWED_RADII.includes(value));
    expect(radii).toEqual([]);

    const literals = declarations
      .filter(({ entry }) => COLOR_LITERAL.test(entry.value))
      .map(({ rule, entry }) => `${rule.selector} ${entry.property}: ${entry.value}`);
    expect(literals).toEqual([]);

    const foreignTokens = declarations
      .flatMap(({ entry }) => [...entry.value.matchAll(/var\(\s*(--[\w-]+)/g)])
      .map((match) => match[1] ?? "")
      .filter((name) => !name.startsWith("--agent-") && name !== "--ease-standard");
    expect(foreignTokens).toEqual([]);
  });
});
