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

  it("renders the user message as a raised bubble", () => {
    expect(winningDeclaration(".agent-prompt", "max-width")).toBe("85%");
    expect(winningDeclaration(".agent-prompt__body", "background")).toBe("var(--agent-raised)");
    expect(winningDeclaration(".agent-prompt__body", "box-shadow")).toBe(
      "var(--agent-shadow-raised)",
    );
    expect(winningDeclaration(".agent-prompt__body", "color")).toBe("var(--agent-text-strong)");
    expect(winningDeclaration(".agent-prompt__body", "border-radius")).toBe(
      "var(--agent-radius-lg)",
    );
    expect(winningDeclaration(".agent-prompt__body", "font-size")).toBe("var(--agent-fs-md)");
    expect(winningDeclaration(".agent-prompt__body", "line-height")).toBe("1.5");
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
      ".agent-prompt__body",
      ".agent-session__body",
    ]) {
      expect(RULES.filter((entry) => entry.selectors.includes(selector))).toHaveLength(1);
    }
    expect(winningDeclaration(".agent-turn", "gap")).toBe("16px");
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
