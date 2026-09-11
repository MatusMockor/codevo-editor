import { describe, expect, it } from "vitest";
import { parseAllStyleSheets, readStyleSheet, selectorParts } from "../cssContractTestSupport";
import { agentModeSheetPath, readAgentModeStyles } from "./agentModeCssTestSupport";

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

function token(name: string): string {
  const values = RULES.filter((entry) => entry.selectors.includes(".workbench-frame")).flatMap(
    (entry) => [...entry.body.matchAll(new RegExp(`(?:^|;)\\s*${name}\\s*:([^;]*)`, "g"))],
  );
  return (values[values.length - 1]?.[1] ?? "").trim();
}

function turnGap(): string {
  return token("--agent-turn-gap");
}

function space(step: number): string {
  return token(`--agent-space-${step}`);
}

describe("agent thread Airy style contract", () => {
  it("drops the rule under the thread header and scales it from the 48px bar height", () => {
    expect(winningDeclaration(".agent-thread-head", "border-bottom")).toBeNull();
    expect(winningDeclaration(".agent-thread-head", "border")).toBeNull();
    expect(winningDeclaration(".agent-thread-head", "box-shadow")).toBeNull();
    expect(winningDeclaration(".agent-thread-head", "min-height")).toBe(
      "calc(48px * var(--codevo-fs-scale))",
    );
    expect(winningDeclaration(".agent-thread-head", "padding")).toBe("0 12px 0 18px");
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
      expect(winningDeclaration(selector, "box-shadow"), selector).toMatch(/-focus-ring\)$/);
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
      "var(--agent-text-muted)",
    );
    expect(declarations(".agent-minimap__dash--rail::before", "opacity")).toEqual([]);
    expect(
      winningDeclaration('.agent-minimap__dash[aria-current="true"]::before', "background"),
    ).toBe("var(--agent-accent)");
    expect(
      winningDeclaration(
        '.agent-minimap__item:hover .agent-minimap__dash--rail:not([aria-current="true"])::before',
        "background",
      ),
    ).toBe("var(--agent-text-strong)");
    expect(winningDeclaration(".agent-minimap__dash--live::after", "background")).toBe(
      "var(--agent-accent)",
    );
    expect(winningDeclaration(".agent-minimap__list--rail", "overflow-y")).toBe("auto");
    expect(declarations(".agent-minimap__list--rail", "justify-content")).toEqual([]);
    expect(winningDeclaration(".agent-minimap__item", "flex-shrink")).toBe("0");
    expect(declarations(".agent-minimap--rail", "transform")).toEqual([]);
    expect(declarations(".agent-minimap--rail", "contain")).toEqual([]);
  });

  it("keeps the thread, composer and usage sheets free of t3 tokens, borders and hairline rings", () => {
    for (const sheet of ["agentThread.css", "agentComposer.css", "agentUsage.css"] as const) {
      const source = readStyleSheet(agentModeSheetPath(sheet)).source.replace(
        /\/\*[\s\S]*?\*\//g,
        "",
      );
      expect(source, sheet).not.toContain("--t3-");
      expect(source, sheet).not.toMatch(/border(-(top|right|bottom|left|block|inline))?:\s*1px/);
      expect(source, sheet).not.toMatch(/border-color:/);
      expect(source, sheet).not.toMatch(/box-shadow:\s*(inset )?0 0 0 \d/);
      expect(source, sheet).not.toMatch(/var\(--agent-hairline/);
    }
  });

  it("keeps no header status styling behind after the status element left the header", () => {
    expect(css).not.toContain(".agent-thread-head__status");
  });

  it("centres the thread column on the T3 measure", () => {
    expect(winningDeclaration(".agent-session__body", "max-width")).toBe("768px");
    expect(winningDeclaration(".agent-session__body", "margin")).toBe("0 auto");
    expect(winningDeclaration(".agent-session", "padding")).toBe("12px 24px 8px");
  });

  it("puts the prompt back in a right-aligned raised bubble capped at 85% of the column", () => {
    expect(winningDeclaration(".agent-prompt", "justify-content")).toBe("flex-end");
    expect(winningDeclaration(".agent-prompt__body", "max-width")).toBe("85%");
    expect(declarations(".agent-prompt", "max-width")).toEqual([]);
    expect(winningDeclaration(".agent-prompt__body", "background")).toBe("var(--agent-raised)");
    expect(winningDeclaration(".agent-prompt__body", "box-shadow")).toBe(
      "var(--agent-shadow-raised)",
    );
    expect(winningDeclaration(".agent-prompt__body", "color")).toBe("var(--agent-text-strong)");
    expect(winningDeclaration(".agent-prompt__body", "border-radius")).toBe(
      "var(--agent-radius-xl)",
    );
    expect(token("--agent-radius-xl")).toBe("var(--codevo-r-xl)");
    expect(winningDeclaration(".agent-prompt__body", "padding")).toBe(
      "var(--agent-space-4) var(--agent-space-5)",
    );
    expect(declarations(".agent-prompt__body", "background").join(" ")).not.toMatch(
      /--agent-rail|--agent-shade|--codevo-side|--agent-well|--agent-code-background/,
    );
  });

  it("lets the prompt run to its full length instead of clamping it", () => {
    expect(winningDeclaration(".agent-prompt__body", "white-space")).toBe("pre-wrap");
    expect(winningDeclaration(".agent-prompt__body", "word-break")).toBe("break-word");
    expect(declarations(".agent-prompt__body", "-webkit-line-clamp")).toEqual([]);
    expect(declarations(".agent-prompt__body", "overflow")).toEqual([]);
    expect(css).not.toContain("agent-band");
    expect(css).not.toContain("agent-turn__sentinel");
  });

  it("gives every prompt and answer block 30px and every block inside an answer 12px", () => {
    expect(winningDeclaration(".agent-session__body", "gap")).toBe("var(--agent-turn-gap)");
    expect(winningDeclaration(".agent-turn-list", "gap")).toBe("var(--agent-turn-gap)");
    expect(winningDeclaration(".agent-turn", "gap")).toBe("var(--agent-turn-gap)");
    expect(turnGap()).toBe("30px");
    expect(winningDeclaration(".agent-answer", "gap")).toBe("var(--agent-space-4)");
    expect(winningDeclaration(".agent-turn__events", "gap")).toBe("var(--agent-space-4)");
    expect(space(4)).toBe("12px");
    expect(declarations(".agent-answer", "padding-bottom")).toEqual([]);
    expect(declarations(".agent-answer", "padding-left")).toEqual([]);
    expect(winningDeclaration(".agent-session__scroll", "overflow-anchor")).toBe("none");
  });

  it("sets the prompt and the turn head from the type ladder", () => {
    expect(winningDeclaration(".agent-prompt__body", "font-size")).toBe("var(--agent-fs-md)");
    expect(winningDeclaration(".agent-prompt__body", "line-height")).toBe("1.5");
    expect(winningDeclaration(".agent-turn__head", "font-size")).toBe("var(--agent-fs-xs)");
    expect(winningDeclaration(".agent-turn__head", "font-weight")).toBe("500");
    expect(winningDeclaration(".agent-turn__head", "color")).toBe("var(--agent-text-muted)");
    expect(winningDeclaration(".agent-turn__head", "gap")).toBe("var(--agent-space-3)");
    for (const selector of [".agent-turn__time", ".agent-turn__duration"]) {
      expect(winningDeclaration(selector, "font-family"), selector).toBe("var(--agent-mono)");
      expect(winningDeclaration(selector, "font-size"), selector).toBe("var(--agent-fs-2xs)");
      expect(winningDeclaration(selector, "color"), selector).toBe("var(--agent-text-subtle)");
    }
  });

  it("marks the turn head with an accent dot and pushes the duration to the far end", () => {
    expect(winningDeclaration(".agent-turn__spark", "width")).toBe("7px");
    expect(winningDeclaration(".agent-turn__spark", "height")).toBe("7px");
    expect(winningDeclaration(".agent-turn__spark", "border-radius")).toBe(
      "var(--agent-radius-pill)",
    );
    expect(winningDeclaration(".agent-turn__spark", "background")).toBe("var(--agent-accent)");
    expect(winningDeclaration(".agent-turn__duration", "margin-left")).toBe("auto");
  });

  it("reveals the prompt copy control on hover or focus like the other messages", () => {
    expect(winningDeclaration(".agent-message-copy", "opacity")).toBe("0");
    expect(winningDeclaration(".agent-prompt:hover .agent-message-copy", "opacity")).toBe("1");
    expect(winningDeclaration(".agent-prompt:focus-within .agent-message-copy", "opacity")).toBe(
      "1",
    );
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

  it("keeps tool rows, subagent rows and the work fold boxless with a hover-only radius", () => {
    for (const selector of [".agent-tool", ".agent-subagent", ".agent-subagents"]) {
      expect(declarations(selector, "box-shadow"), selector).toEqual([]);
      expect(winningDeclaration(selector, "background"), selector).toBe("transparent");
      expect(winningDeclaration(selector, "border-radius"), selector).toBe("7px");
      expect(winningDeclaration(selector, "padding"), selector).toBe("4px 8px");
      expect(winningDeclaration(`${selector}:hover`, "background"), selector).toBe(
        "var(--agent-hover)",
      );
    }
    expect(winningDeclaration(".agent-tool__status", "display")).toBe("none");
    expect(winningDeclaration(".agent-tool__status--bad", "display")).toBe("inline");
    expect(declarations(".agent-work", "border-bottom")).toEqual([]);
    expect(winningDeclaration(".agent-work__summary", "justify-content")).toBe("start");
    expect(winningDeclaration(".agent-work__summary", "border-radius")).toBe("7px");
    expect(winningDeclaration(".agent-work__summary:hover", "background")).toBe(
      "var(--agent-hover)",
    );
  });

  it("puts code blocks on the well tone and the changes summary on a raised card", () => {
    for (const selector of [".agent-raw__lines", ".agent-diff__text"]) {
      expect(winningDeclaration(selector, "border-radius"), selector).toBe(
        "var(--agent-radius-md)",
      );
      expect(declarations(selector, "box-shadow"), selector).toEqual([]);
    }
    expect(winningDeclaration(".agent-raw__lines", "background")).toBe(
      "var(--agent-code-background)",
    );
    expect(winningDeclaration(".agent-diff__text", "background")).toBe("var(--agent-well)");
    expect(winningDeclaration(".agent-changes", "background")).toBe("var(--agent-raised)");
    expect(winningDeclaration(".agent-changes", "box-shadow")).toBe("var(--agent-shadow-raised)");
    expect(winningDeclaration(".agent-changes", "border-radius")).toBe("var(--agent-radius-md)");
    expect(declarations(".agent-changes", "border-top")).toEqual([]);
    expect(declarations(".agent-files__row + .agent-files__row", "border-top")).toEqual([]);
  });

  it("declares every thread-body selector once, in the thread stylesheet", () => {
    for (const selector of [
      ".agent-turn",
      ".agent-turn-list",
      ".agent-prompt",
      ".agent-prompt__body",
      ".agent-turn__head",
      ".agent-answer",
      ".agent-turn__events",
      ".agent-work",
      ".agent-work__summary",
      ".agent-tool",
      ".agent-tool__name",
      ".agent-tool__input",
      ".agent-text",
      ".agent-text__paragraph",
      ".agent-reasoning",
      ".agent-raw",
      ".agent-subagents",
      ".agent-session__body",
    ]) {
      expect(RULES.filter((entry) => entry.selectors.includes(selector))).toHaveLength(1);
    }
    expect(winningDeclaration(".agent-answer", "gap")).toBe("var(--agent-space-4)");
    expect(winningDeclaration(".agent-turn__events", "gap")).toBe("var(--agent-space-4)");
  });

  it("hides the result microlabel and keeps no styling for unrendered blocks", () => {
    expect(winningDeclaration(".agent-finale .agent-microlabel", "display")).toBe("none");
    expect(winningDeclaration(".agent-finale .agent-microlabel--bad", "display")).toBe("inline");
    for (const selector of [
      ".agent-well",
      ".agent-well__head",
      ".agent-well__task",
      ".agent-well__stream",
      ".agent-session__head",
      ".agent-session__repo",
      ".agent-session__title",
      ".agent-session__status",
    ]) {
      expect(RULES.filter((entry) => entry.selectors.includes(selector))).toEqual([]);
    }
  });

  it("keeps the work fold legible on light themes", () => {
    for (const selector of [
      '.app-shell[data-theme="light"] .agent-work__counts',
      '.app-shell[data-theme="light"] .agent-work__chevron',
      '.app-shell[data-theme="catppuccinLatte"] .agent-work__counts',
      '.app-shell[data-theme="catppuccinLatte"] .agent-work__chevron',
      '.app-shell[data-theme="oneLight"] .agent-work__counts',
      '.app-shell[data-theme="oneLight"] .agent-work__chevron',
    ]) {
      expect(winningDeclaration(selector, "color")).toBe("var(--agent-text-muted)");
    }
    expect(css).toMatch(
      /\.app-shell\[data-theme="system"\] \.agent-work__counts,\s+\.app-shell\[data-theme="system"\] \.agent-work__chevron \{\s+color: var\(--agent-text-muted\);/,
    );
  });

  it("underlines the project in the empty-state question", () => {
    expect(winningDeclaration(".agent-empty__title", "font-size")).toBe("var(--codevo-fs-hero)");
    expect(winningDeclaration(".agent-empty__title", "font-weight")).toBe("400");
    expect(winningDeclaration(".agent-empty__title", "line-height")).toBe("1.2");
    expect(winningDeclaration(".agent-empty__project", "text-underline-offset")).toBe("6px");
    expect(winningDeclaration(".agent-empty__project", "text-decoration-color")).toBe(
      "color-mix(in srgb, currentColor 35%, transparent)",
    );
    expect(winningDeclaration(".agent-session__body--empty", "align-content")).toBe("end");
    expect(css).not.toContain(".agent-empty__figure");
    expect(css).not.toContain(".agent-empty__hint");
    expect(css).not.toContain(".agent-empty__chip");
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
    expect(winningDeclaration(".agent-icon-toggle", "width")).toBe("28px");
    expect(winningDeclaration(".agent-icon-toggle", "height")).toBe("28px");
    expect(winningDeclaration('.agent-icon-toggle[aria-pressed="true"]', "background")).toBe(
      "var(--agent-fill)",
    );
  });

  it("scopes markdown horizontal scrolling to the code body and table wrapper only", () => {
    const scrollers = RULES.filter((rule) => /overflow(-x)?\s*:/.test(rule.body)).flatMap(
      (rule) => rule.selectors,
    );
    const markdownScrollers = scrollers.filter((selector) => selector.includes(".agent-md__"));
    expect(markdownScrollers.sort()).toEqual([".agent-md__code-body", ".agent-md__table-scroll"]);
    expect(scrollers).not.toContain(".agent-text");
    expect(winningDeclaration(".agent-text", "min-width")).toBe("0");
    expect(winningDeclaration(".agent-md__code-body", "overflow-x")).toBe("auto");
    expect(winningDeclaration(".agent-md__table-scroll", "overflow-x")).toBe("auto");
  });

  it("fits a markdown table to the reading column and wraps every cell", () => {
    expect(declarations(".agent-md__table", "width")).toEqual([]);
    expect(declarations(".agent-md__table", "min-width")).toEqual([]);
    expect(winningDeclaration(".agent-md__table", "max-width")).toBe("100%");
    expect(declarations(".agent-md__th", "white-space")).toEqual([]);
    expect(declarations(".agent-md__td", "white-space")).toEqual([]);
    expect(winningDeclaration(".agent-md__th", "overflow-wrap")).toBe("break-word");
    expect(winningDeclaration(".agent-md__td", "overflow-wrap")).toBe("break-word");
    expect(winningDeclaration(".agent-md__td .agent-md__inline-code", "overflow-wrap")).toBe(
      "anywhere",
    );
    expect(winningDeclaration(".agent-md__td .agent-md__link", "overflow-wrap")).toBe("anywhere");
    expect(winningDeclaration(".agent-md__th", "vertical-align")).toBe("bottom");
    expect(winningDeclaration(".agent-md__td", "vertical-align")).toBe("top");
    for (const rule of RULES.filter((entry) =>
      entry.selectors.some((selector) => selector.includes(".agent-md__t")),
    )) {
      expect(rule.body, rule.selectors.join(",")).not.toMatch(/max-content|nowrap|table-layout/);
    }
  });

  it("keeps markdown chrome on the well and raised tones without side tone or z-index", () => {
    const markdownRules = RULES.filter((rule) =>
      rule.selectors.some((selector) => selector.includes(".agent-md__")),
    );
    for (const rule of markdownRules) {
      expect(rule.body, rule.selectors.join(",")).not.toMatch(/z-index/);
      expect(rule.body, rule.selectors.join(",")).not.toMatch(
        /--agent-rail|--agent-shade|--codevo-side|--agent-hairline/,
      );
    }
    expect(winningDeclaration(".agent-md__code-bar", "background")).toBe("var(--agent-raised)");
    expect(winningDeclaration(".agent-md__code-body", "background")).toBe(
      "var(--agent-code-background)",
    );
    expect(winningDeclaration(".agent-md__th", "background")).toBe("var(--agent-raised)");
    expect(winningDeclaration(".agent-md__quote", "background")).toBe("var(--agent-well)");
    expect(winningDeclaration(".agent-md__inline-code", "background")).toBe("var(--agent-well)");
    expect(winningDeclaration(".agent-md__heading--h1", "font-size")).toBe("var(--agent-fs-xl)");
    expect(winningDeclaration(".agent-md__heading--h2", "font-size")).toBe("var(--agent-fs-lg)");
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
