import { describe, expect, it } from "vitest";
import { parseAllStyleSheets, selectorParts } from "../cssContractTestSupport";
import { readAgentModeStyles } from "./agentModeCssTestSupport";

const css = readAgentModeStyles();

interface CssRule {
  readonly selectors: ReadonlyArray<string>;
  readonly body: string;
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ");
}

function topLevelRules(source: string): ReadonlyArray<CssRule> {
  const scan = withoutComments(source);
  const rules: CssRule[] = [];
  let cursor = 0;
  let prelude = 0;

  while (cursor < scan.length) {
    const character = scan[cursor];
    if (character === "}") {
      cursor += 1;
      prelude = cursor;
      continue;
    }
    if (character !== "{") {
      cursor += 1;
      continue;
    }

    const bodyStart = cursor + 1;
    let depth = 1;
    let end = bodyStart;
    while (end < scan.length && depth > 0) {
      if (scan[end] === "{") depth += 1;
      if (scan[end] === "}") depth -= 1;
      end += 1;
    }
    rules.push({
      selectors: scan
        .slice(prelude, cursor)
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== ""),
      body: scan.slice(bodyStart, end - 1),
    });
    cursor = end;
    prelude = cursor;
  }

  return rules;
}

const RULES = topLevelRules(css);

function declarations(selector: string, property: string): ReadonlyArray<string> {
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]*)`, "g");
  return RULES.filter((entry) => entry.selectors.includes(selector)).flatMap((entry) =>
    [...entry.body.matchAll(pattern)].map((match) => (match[1] ?? "").trim().replace(/\s+/g, " ")),
  );
}

function winningDeclaration(selector: string, property: string): string | null {
  const values = declarations(selector, property);
  return values[values.length - 1] ?? null;
}

describe("agent thread Airy style contract", () => {
  it("drops the rule under the thread header and scales it from the 48px bar height", () => {
    expect(winningDeclaration(".agent-thread-head", "padding")).toBeNull();
    expect(winningDeclaration(".agent-thread-head", "min-height")).toBeNull();
  });

  it("makes find focus a tone step instead of a ring on the input", () => {
    expect(declarations(".agent-find__input", "box-shadow")).toEqual([]);
    expect(winningDeclaration(".agent-find__input:focus-visible", "box-shadow")).toBe("none");
    expect(winningDeclaration(".agent-find__input", "outline")).toBe("none");
    expect(winningDeclaration(".agent-find__input", "background")).toBe("transparent");
    expect(winningDeclaration(".agent-find__input", "caret-color")).toBe("var(--agent-accent)");
    expect(winningDeclaration(".agent-find", "box-shadow")).toBe("var(--codevo-shadow-float)");
    expect(winningDeclaration(".agent-find:focus-within", "box-shadow")).toBe(
      "var(--codevo-shadow-window)",
    );
    expect(winningDeclaration(".agent-find:focus-within .agent-find__glyph", "color")).toBe(
      "var(--agent-accent)",
    );
  });

  it("keeps the shell-wide focus ring off the autofocused find input", () => {
    const shellRing = parseAllStyleSheets()
      .rules.filter(
        (rule) =>
          rule.context.length === 0 && selectorParts(rule.selector).includes(":focus-visible"),
      )
      .flatMap((rule) =>
        rule.declarations
          .filter((entry) => entry.property === "box-shadow")
          .map((entry) => entry.value),
      );

    expect(shellRing).toEqual(["var(--focus-ring)"]);
    expect(winningDeclaration(".agent-find__input:focus-visible", "box-shadow")).toBe("none");
    expect(winningDeclaration(".agent-find__input", "outline")).toBe("none");
  });

  it("leaves the focus ring intact on every other control it touched", () => {
    for (const selector of [
      ".agent-find__step:focus-visible",
      ".agent-find__close:focus-visible",
      ".agent-minimap__dash:focus-visible",
      ".agent-minimap__toggle:focus-visible",
    ]) {
      expect(winningDeclaration(selector, "box-shadow"), selector).toMatch(
        /(-focus-ring|--cv-ring-focus)\)$/,
      );
    }
  });

  it("floats the find pill on the column corner without taking a layout row", () => {
    expect(winningDeclaration(".agent-find", "position")).toBe("absolute");
    expect(winningDeclaration(".agent-find", "top")).toBe("var(--agent-find-pill-top)");
    expect(winningDeclaration(".agent-find", "right")).toBe(
      "max(var(--agent-session-gutter), calc((100% - var(--agent-thread-column)) / 2))",
    );
    expect(winningDeclaration(".agent-find", "height")).toBe("var(--agent-find-pill-height)");
    expect(winningDeclaration(".agent-find", "border-radius")).toBe("var(--agent-radius-lg)");
    expect(winningDeclaration(".agent-find", "background")).toBe("var(--agent-raised)");
    expect(winningDeclaration(".agent-find", "box-shadow")).toBe("var(--codevo-shadow-float)");
  });

  it("wears the cap as a readable note with a warm mark, never as an error", () => {
    expect(winningDeclaration(".agent-find__note", "color")).toBe("var(--agent-text-muted)");
    expect(winningDeclaration(".agent-find__plus", "color")).toBe("var(--agent-attention)");
    expect(winningDeclaration(".agent-find__count--empty", "color")).toBe(
      "var(--agent-text-subtle)",
    );
    expect(winningDeclaration(".agent-find__note", "font-size")).toBe("var(--agent-fs-2xs)");
  });

  it("steps the minimap dash width down to a floor of 8px and accents only the current one", () => {
    expect(winningDeclaration(".agent-minimap__dash--rail::before", "width")).toBe(
      "calc(24px - min(var(--minimap-distance, 4), 4) * 4px)",
    );
    expect(
      winningDeclaration(".agent-minimap--dense .agent-minimap__dash--rail::before", "width"),
    ).toBe("calc(16px - min(var(--minimap-distance, 4), 4) * 2px)");
    expect(winningDeclaration(".agent-minimap__dash--rail::before", "background")).toBe(
      "var(--cv-fg-muted)",
    );
    expect(declarations(".agent-minimap__dash--rail::before", "opacity")).toEqual([]);
    expect(
      winningDeclaration('.agent-minimap__dash[aria-current="true"]::before', "background"),
    ).toBe("var(--cv-accent)");
    expect(
      winningDeclaration(
        '.agent-minimap__item:hover .agent-minimap__dash--rail:not([aria-current="true"])::before',
        "background",
      ),
    ).toBe("var(--cv-fg-strong)");
    expect(winningDeclaration(".agent-minimap__dash--live::after", "background")).toBe(
      "var(--cv-accent)",
    );
    expect(winningDeclaration(".agent-minimap__list--rail", "overflow-y")).toBe("auto");
    expect(declarations(".agent-minimap__list--rail", "justify-content")).toEqual([]);
    expect(winningDeclaration(".agent-minimap__item", "flex-shrink")).toBe("0");
    expect(declarations(".agent-minimap--rail", "transform")).toEqual([]);
    expect(declarations(".agent-minimap--rail", "contain")).toEqual([]);
  });

  it("keeps no header status styling behind after the status element left the header", () => {
    expect(css).not.toContain(".agent-thread-head__status");
  });

  it("reveals a find hit with a plain centred scroll and no pinned-band inset", () => {
    expect(declarations(".agent-find__hit", "scroll-margin-top")).toEqual([]);
    expect(declarations(".agent-answer [data-agent-event]", "scroll-margin-top")).toEqual([]);
    expect(
      RULES.filter((entry) => entry.selectors.includes(".agent-session__reveal-slack")),
    ).toEqual([]);
    expect(css).not.toContain("--agent-band-reveal-inset");
    expect(css).not.toContain("reveal-slack");
  });

  it("puts the changes summary on a raised card", () => {
    for (const selector of [".agent-diff__text"]) {
      expect(winningDeclaration(selector, "border-radius"), selector).toBe(
        "var(--agent-radius-md)",
      );
      expect(declarations(selector, "box-shadow"), selector).toEqual([]);
    }
    expect(winningDeclaration(".agent-diff__text", "background")).toBe("var(--agent-well)");
    expect(winningDeclaration(".agent-changes", "background")).toBe("var(--agent-raised)");
    expect(winningDeclaration(".agent-changes", "box-shadow")).toBe("var(--agent-shadow-raised)");
    expect(winningDeclaration(".agent-changes", "border-radius")).toBe("var(--agent-radius-md)");
    expect(declarations(".agent-changes", "border-top")).toEqual([]);
    expect(declarations(".agent-files__row + .agent-files__row", "border-top")).toEqual([]);
  });

  it("declares every thread-body selector once, in the thread stylesheet", () => {
    for (const selector of [".agent-reasoning", ".agent-subagents"]) {
      expect(RULES.filter((entry) => entry.selectors.includes(selector))).toHaveLength(1);
    }
  });

  it("raises the header split controls with a tone divider instead of a border", () => {
    expect(winningDeclaration(".agent-split", "height")).toBe(
      "calc(28px * var(--codevo-fs-scale))",
    );
    expect(winningDeclaration(".agent-split", "background")).toBe("var(--agent-outline-button-bg)");
    expect(winningDeclaration(".agent-split", "border-radius")).toBe("var(--agent-radius-sm)");
    expect(winningDeclaration(".agent-split", "box-shadow")).toBe("var(--agent-shadow-raised)");
    expect(declarations(".agent-split", "border")).toEqual([]);
    expect(declarations(".agent-split__chevron", "border-left")).toEqual([]);
    expect(winningDeclaration(".agent-split__chevron::before", "width")).toBe("1px");
    expect(winningDeclaration(".agent-split__chevron::before", "background")).toBe(
      "var(--agent-hover)",
    );
    expect(winningDeclaration(".agent-split--open", "background")).toBe("var(--agent-fill)");
    expect(declarations(".agent-split--open", "border-color")).toEqual([]);
    expect(winningDeclaration(".agent-split__main:hover:not(:disabled)", "background")).toBe(
      "var(--agent-outline-button-hover)",
    );
  });

  it("floats menus and popovers on the float shadow without a hairline ring", () => {
    expect(winningDeclaration(".agent-menu", "box-shadow")).toBe("var(--codevo-shadow-float)");
    expect(winningDeclaration(".agent-menu", "border-radius")).toBe("var(--agent-radius-lg)");
    expect(winningDeclaration(".agent-menu__item", "min-height")).toBe(
      "calc(30px * var(--codevo-fs-scale))",
    );
    expect(winningDeclaration(".agent-menu__item", "border-radius")).toBe("7px");
    expect(winningDeclaration(".agent-menu__item:hover:not(:disabled)", "background")).toBe(
      "var(--codevo-active)",
    );
    expect(winningDeclaration(".agent-menu__item:focus-visible", "box-shadow")).toBe(
      "var(--agent-focus-ring)",
    );
    expect(winningDeclaration(".agent-menu__item--armed", "background")).toBe(
      "var(--agent-glow-danger)",
    );
    expect(declarations(".agent-menu__item--armed", "box-shadow")).toEqual([]);
    expect(winningDeclaration(".agent-menu__separator", "background")).toBe("var(--agent-hover)");
  });
});
