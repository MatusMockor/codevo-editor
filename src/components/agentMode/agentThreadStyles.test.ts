import { describe, expect, it } from "vitest";
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

describe("agent thread T3 style contract", () => {
  it("drops the rule under the thread header and gives it the T3 bar height", () => {
    expect(winningDeclaration(".agent-thread-head", "border-bottom")).toBeNull();
    expect(winningDeclaration(".agent-thread-head", "border")).toBeNull();
    expect(winningDeclaration(".agent-thread-head", "min-height")).toBe("52px");
    expect(winningDeclaration(".agent-thread-head", "padding")).toBe("0 12px 0 16px");
  });

  it("keeps no header status styling behind after the status element left the header", () => {
    expect(css).not.toContain(".agent-thread-head__status");
  });

  it("centres the thread column on the T3 measure", () => {
    expect(winningDeclaration(".agent-session__body", "max-width")).toBe("768px");
    expect(winningDeclaration(".agent-session__body", "margin")).toBe("0 auto");
    expect(winningDeclaration(".agent-session", "padding")).toBe("12px 24px 8px");
  });

  it("renders the user message as an accent bubble", () => {
    expect(winningDeclaration(".agent-prompt", "max-width")).toBe("85%");
    expect(winningDeclaration(".agent-prompt__body", "background")).toBe("var(--agent-fill)");
    expect(winningDeclaration(".agent-prompt__body", "color")).toBe("var(--t3-accent-foreground)");
    expect(winningDeclaration(".agent-prompt__body", "border-radius")).toBe("var(--t3-radius-2xl)");
  });

  it("strips the frame from tool rows and the work fold", () => {
    expect(declarations(".agent-tool", "box-shadow")).toEqual([]);
    expect(winningDeclaration(".agent-tool", "background")).toBe("transparent");
    expect(winningDeclaration(".agent-tool", "padding")).toBe("4px 0");
    expect(winningDeclaration(".agent-tool__status", "display")).toBe("none");
    expect(winningDeclaration(".agent-tool__status--bad", "display")).toBe("inline");
    expect(declarations(".agent-work", "border-bottom")).toEqual([]);
    expect(winningDeclaration(".agent-work__summary", "justify-content")).toBe("start");
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

  it("gives the header actions the T3 outline metrics", () => {
    expect(winningDeclaration(".agent-split", "height")).toBe("24px");
    expect(winningDeclaration(".agent-split", "background")).toBe("var(--agent-outline-button-bg)");
    expect(winningDeclaration(".agent-split", "border-radius")).toBe("var(--agent-radius-sm)");
    expect(winningDeclaration(".agent-split", "box-shadow")).toBe("0 1px 2px rgba(0, 0, 0, 0.05)");
    expect(winningDeclaration(".agent-split__main:hover:not(:disabled)", "background")).toBe(
      "var(--agent-outline-button-hover)",
    );
    expect(winningDeclaration(".agent-icon-toggle", "width")).toBe("26px");
    expect(winningDeclaration(".agent-icon-toggle", "height")).toBe("26px");
    expect(winningDeclaration('.agent-icon-toggle[aria-pressed="true"]', "background")).toBe(
      "var(--agent-fill)",
    );
  });
});
