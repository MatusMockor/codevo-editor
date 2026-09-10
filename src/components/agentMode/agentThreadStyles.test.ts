import { describe, expect, it } from "vitest";
import { readStyleSheet } from "../cssContractTestSupport";
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

function bandBleed(): string {
  return token("--agent-band-bleed");
}

function revealInset(): number {
  return Number.parseInt(token("--agent-band-reveal-inset"), 10);
}

describe("agent thread Airy style contract", () => {
  it("drops the rule under the thread header and gives it the 48px bar height", () => {
    expect(winningDeclaration(".agent-thread-head", "border-bottom")).toBeNull();
    expect(winningDeclaration(".agent-thread-head", "border")).toBeNull();
    expect(winningDeclaration(".agent-thread-head", "box-shadow")).toBeNull();
    expect(winningDeclaration(".agent-thread-head", "min-height")).toBe("48px");
    expect(winningDeclaration(".agent-thread-head", "padding")).toBe("0 12px 0 18px");
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

  it("retires the raised bubble now that imported prompts are ledger bands", () => {
    for (const selector of [".agent-prompt", ".agent-prompt__body", ".agent-prompt__meta"]) {
      expect(RULES.filter((entry) => entry.selectors.includes(selector))).toEqual([]);
    }
    expect(css).not.toContain(".agent-prompt");
  });

  it("paints the ledger band on its own recessed tone, never on the side or well tone", () => {
    expect(winningDeclaration(".agent-band", "background")).toBe("var(--agent-band-surface)");
    expect(winningDeclaration(".agent-band", "color")).toBe("var(--agent-text-strong)");
    expect(declarations(".agent-band", "background").join(" ")).not.toMatch(
      /--agent-rail|--agent-shade|--codevo-side|--agent-well|--agent-code-background/,
    );
    expect(winningDeclaration(".agent-band--pinned", "box-shadow")).toBe(
      "var(--agent-shadow-raised)",
    );
    expect(declarations(".agent-band", "box-shadow")).toEqual([]);
  });

  it("never lets the pinned state change anything that affects the band height", () => {
    const pinnedProperties = RULES.filter((entry) =>
      entry.selectors.some((selector) => selector.includes(".agent-band--pinned")),
    ).flatMap((entry) => [...entry.body.matchAll(/(?:^|;)\s*([-a-z]+)\s*:/g)].map((m) => m[1]));

    expect([...new Set(pinnedProperties)].sort()).toEqual([
      "box-shadow",
      "opacity",
      "pointer-events",
    ]);
    expect(winningDeclaration(".agent-session__scroll", "overflow-anchor")).toBe("none");
  });

  it("sticks the band to the top of its own turn and runs it past the reading column", () => {
    expect(winningDeclaration(".agent-band", "position")).toBe("sticky");
    expect(winningDeclaration(".agent-band", "top")).toBe("0");
    expect(winningDeclaration(".agent-band", "z-index")).toBe("1");
    expect(winningDeclaration(".agent-band", "margin")).toBe(
      "0 calc(var(--agent-band-bleed) * -1) var(--agent-space-4)",
    );
    expect(winningDeclaration(".agent-band", "padding")).toBe(
      "var(--agent-space-4) var(--agent-band-bleed)",
    );
    expect(winningDeclaration(".agent-session", "padding")).toBe("12px 24px 8px");
    expect(bandBleed()).toBe("24px");
  });

  it("lays the band out as gutter, prompt and one tool track from the ladder", () => {
    expect(winningDeclaration(".agent-band", "grid-template-columns")).toBe(
      "calc(var(--agent-band-indent) - var(--agent-space-3)) minmax(0, 1fr) auto",
    );
    expect(winningDeclaration(".agent-band", "column-gap")).toBe("var(--agent-space-3)");
    expect(declarations(".agent-band", "row-gap")).toEqual([]);
    expect(winningDeclaration(".agent-band", "align-items")).toBe("baseline");
    expect(winningDeclaration(".agent-band__tools", "grid-column")).toBe("3");
    expect(winningDeclaration(".agent-band__tools", "display")).toBe("inline-flex");
    expect(winningDeclaration(".agent-band__tools", "gap")).toBe("var(--agent-space-2)");
    for (const selector of [".agent-band__expand", ".agent-band__jump", ".agent-band__meta"]) {
      expect(declarations(selector, "grid-column"), selector).toEqual([]);
    }
  });

  it("sets the prompt and the ordinal from the type ladder", () => {
    expect(winningDeclaration(".agent-band__text", "font-size")).toBe("var(--agent-fs-lg)");
    expect(winningDeclaration(".agent-band__text", "font-weight")).toBe("500");
    expect(winningDeclaration(".agent-band__text", "line-height")).toBe("1.45");
    expect(winningDeclaration(".agent-band__number", "font-family")).toBe("var(--agent-mono)");
    expect(winningDeclaration(".agent-band__number", "font-size")).toBe("var(--agent-fs-2xs)");
    expect(winningDeclaration(".agent-band__number", "font-weight")).toBe("600");
    expect(winningDeclaration(".agent-band__number", "letter-spacing")).toBe(
      "var(--agent-tracking-label)",
    );
    expect(winningDeclaration(".agent-band__number", "color")).toBe("var(--agent-text-subtle)");
    expect(
      winningDeclaration(".agent-turn-list > .agent-turn:last-child .agent-band__number", "color"),
    ).toBe("var(--agent-accent)");
  });

  it("marks the gutter with a dot when the ordinal is withheld", () => {
    expect(winningDeclaration(".agent-band__mark", "width")).toBe("6px");
    expect(winningDeclaration(".agent-band__mark", "height")).toBe("6px");
    expect(winningDeclaration(".agent-band__mark", "border-radius")).toBe(
      "var(--agent-radius-pill)",
    );
    expect(winningDeclaration(".agent-band__mark", "background")).toBe("var(--agent-text-subtle)");
    expect(winningDeclaration(".agent-band__mark", "align-self")).toBe("start");
    expect(winningDeclaration(".agent-band__mark", "margin-top")).toBe("var(--agent-space-3)");
  });

  it("reveals the band tools on hover or focus like the other rows", () => {
    expect(winningDeclaration(".agent-band__expand", "opacity")).toBe("0");
    expect(winningDeclaration(".agent-band__meta", "opacity")).toBe("0");
    expect(winningDeclaration(".agent-band:hover .agent-band__expand", "opacity")).toBe("1");
    expect(winningDeclaration(".agent-band:focus-within .agent-band__jump", "opacity")).toBe("1");
    expect(winningDeclaration(".agent-band:hover .agent-message-copy", "opacity")).toBe("1");
    expect(winningDeclaration(".agent-band:focus-within .agent-message-copy", "opacity")).toBe("1");
  });

  it("clamps the band to two lines at all times and only an explicit expand undoes it", () => {
    expect(winningDeclaration(".agent-band__text", "grid-column")).toBe("2");
    expect(winningDeclaration(".agent-band__text", "-webkit-line-clamp")).toBe("2");
    expect(winningDeclaration(".agent-band__text", "overflow")).toBe("hidden");
    expect(winningDeclaration(".agent-band__text", "white-space")).toBe("pre-wrap");
    expect(declarations(".agent-band--pinned .agent-band__text", "-webkit-line-clamp")).toEqual([]);
    expect(
      winningDeclaration(".agent-band--expanded .agent-band__text", "-webkit-line-clamp"),
    ).toBe("none");
    expect(winningDeclaration(".agent-band--expanded .agent-band__text", "overflow")).toBe(
      "visible",
    );
    expect(winningDeclaration(".agent-band__jump", "opacity")).toBe("0");
    expect(winningDeclaration(".agent-band__jump", "pointer-events")).toBe("none");
    expect(winningDeclaration(".agent-band--pinned .agent-band__jump", "opacity")).toBe("1");
    expect(winningDeclaration(".agent-band--pinned .agent-band__jump", "pointer-events")).toBe(
      "auto",
    );
  });

  it("clears the pinned band when a find hit or an event is revealed", () => {
    expect(winningDeclaration(".agent-find__hit", "scroll-margin-top")).toBe(
      "var(--agent-band-reveal-inset)",
    );
    expect(winningDeclaration(".agent-answer [data-agent-event]", "scroll-margin-top")).toBe(
      "var(--agent-band-reveal-inset)",
    );
    expect(revealInset()).toBeGreaterThanOrEqual(68);
    expect(winningDeclaration(".agent-session__reveal-slack", "height")).toBe(
      "var(--agent-band-reveal-inset)",
    );
    expect(winningDeclaration(".agent-session__reveal-slack", "margin-top")).toBe(
      "calc(var(--agent-turn-gap) * -1)",
    );
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
      ".agent-band",
      ".agent-band__text",
      ".agent-session__reveal-slack",
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
    expect(winningDeclaration(".agent-answer", "gap")).toBe("16px");
    expect(winningDeclaration(".agent-turn__events", "gap")).toBe("12px");
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
    expect(winningDeclaration(".agent-empty__title", "font-size")).toBe("28px");
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
    expect(winningDeclaration(".agent-split", "height")).toBe("28px");
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
    expect(winningDeclaration(".agent-menu__item", "min-height")).toBe("30px");
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
