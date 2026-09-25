import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guards the "JetBrains classic" chrome the editor paints onto Monaco's built-in
 * popups (suggest/autocomplete, hover, context + code-action menu) so they read
 * as one visual family with the FileStructure palette (Slice 2). The popups are
 * rendered by Monaco inside `.app-shell[data-theme=...]` (no fixedOverflowWidgets),
 * so the chrome is theme-aware through our CSS variables rather than hardcoded.
 */
const appCss = readFileSync("src/App.css", "utf8");
const widgetCss = readFileSync("src/components/editorPanel/editorWidgets.css", "utf8");
const MONACO_DEFAULT_BLUES = /#(?:007acc|04395e|062f4a|094771|0e639c|264f78|006ab1)\b/i;

/** Returns the body of the FIRST CSS rule whose selector text matches. */
function ruleBody(css: string, selectorNeedle: string): string {
  const index = css.indexOf(selectorNeedle);
  if (index < 0) {
    throw new Error(`Missing CSS rule for selector ${selectorNeedle}`);
  }
  const bodyStart = css.indexOf("{", index);
  const bodyEnd = css.indexOf("}", bodyStart);
  if (bodyStart < 0 || bodyEnd < 0) {
    throw new Error(`Unterminated CSS rule for selector ${selectorNeedle}`);
  }
  return css.slice(bodyStart + 1, bodyEnd);
}

function themeBlocks(css: string): Array<{ selector: string; body: string }> {
  const blocks: Array<{ selector: string; body: string }> = [];
  const themeSelector = /(^|\n)(\s*(?::root|\.app-shell\[data-theme="[^"]+"\])\s*)\{/g;
  let match: RegExpExecArray | null;
  while ((match = themeSelector.exec(css)) !== null) {
    const selector = match[2].trim();
    let precedingIndex = match.index - 1;
    while (precedingIndex >= 0 && /\s/.test(css[precedingIndex] ?? "")) {
      precedingIndex -= 1;
    }
    if (css[precedingIndex] === ",") {
      continue;
    }
    const bodyStart = css.indexOf("{", match.index);
    const bodyEnd = css.indexOf("}", bodyStart);
    if (bodyStart < 0 || bodyEnd < 0) {
      throw new Error(`Unterminated theme block for selector ${selector}`);
    }
    blocks.push({
      selector,
      body: css.slice(bodyStart + 1, bodyEnd),
    });
  }
  return blocks;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expectDeclarationUsesVar(body: string, property: string, variable: string): void {
  expect(body).toMatch(
    new RegExp(`${escapeRegExp(property)}:\\s*var\\(${escapeRegExp(variable)}\\)`),
  );
}

describe("Monaco widget chrome", () => {
  const popupChrome = ruleBody(widgetCss, ".app-shell .monaco-editor .monaco-hover,");

  it.each([
    ".app-shell .monaco-editor .suggest-widget,",
    ".app-shell .monaco-editor .suggest-details,",
    ".app-shell .monaco-editor .find-widget,",
    ".app-shell .monaco-editor .rename-box,",
    ".app-shell .action-widget {",
  ])("rounds and shadows %s with the shared popover chrome", (selector) => {
    expect(ruleBody(widgetCss, selector)).toBe(popupChrome);
    expectDeclarationUsesVar(popupChrome, "border-radius", "--cv-r-card");
    expectDeclarationUsesVar(popupChrome, "background", "--cv-popover");
    expectDeclarationUsesVar(popupChrome, "box-shadow", "--cv-shadow-pop");
    expect(popupChrome).toMatch(/border:\s*0;/);
  });

  it("rounds the context menu items inside Monaco's menu bar", () => {
    const body = ruleBody(
      widgetCss,
      ".app-shell .monaco-menu .monaco-action-bar.vertical .action-item .action-menu-item {",
    );
    expectDeclarationUsesVar(body, "border-radius", "--cv-r-sm");
  });

  it("reads the code-action group headers as quiet uppercase section labels", () => {
    const body = ruleBody(widgetCss, ".app-shell .action-widget .monaco-list-row.group-header {");
    expectDeclarationUsesVar(body, "color", "--cv-fg-muted");
    expect(body).toContain("text-transform: uppercase");
    expect(body).toContain("letter-spacing");
  });

  it("tints the focused code-action row with the tint token, not Monaco blue", () => {
    const body = ruleBody(
      widgetCss,
      ".app-shell .action-widget .monaco-list .monaco-list-row.action.focused:not(.option-disabled) {",
    );
    expectDeclarationUsesVar(body, "background-color", "--cv-tint-3");
    expectDeclarationUsesVar(body, "color", "--cv-fg-strong");
    expect(body).not.toMatch(MONACO_DEFAULT_BLUES);
  });

  it("tints the selected suggest row with the shared tint token", () => {
    const body = ruleBody(
      widgetCss,
      ".app-shell .monaco-editor .suggest-widget .monaco-list .monaco-list-row.focused {",
    );
    expectDeclarationUsesVar(body, "background", "--cv-tint-3");
    expectDeclarationUsesVar(body, "color", "--cv-fg-strong");
  });

  it("gives the FileStructure active row a rounded, inset accent fill", () => {
    // The Cmd+R structure palette uses `.quick-open-result active`. The shared
    // command-palette rule fills the row edge-to-edge, which reads as an ugly
    // square full-width bar inside the structure popup. Scope a JetBrains-classic
    // active row here: soft accent fill, rounded corners and a small horizontal
    // inset so it floats off the palette edges like the other widgets.
    const body = ruleBody(appCss, ".file-structure .quick-open-result.active");
    expect(body).toContain("var(--color-accent-soft)");
    expect(body).toContain("border-radius");
    // Inset from the palette edges so the fill is not full-width.
    expect(body).toMatch(/margin(-inline|-left|-right|-inline-start)?:/);
  });

  it("pins Monaco widget surface variables to palette chrome tokens", () => {
    const body = ruleBody(widgetCss, ".app-shell .monaco-editor,");
    const surfaceBindings: Array<[string, string]> = [
      ["--vscode-editorSuggestWidget-background", "--cv-popover"],
      ["--vscode-editorSuggestWidget-selectedBackground", "--cv-tint-3"],
      ["--vscode-editorSuggestWidget-selectedForeground", "--cv-fg-strong"],
      ["--vscode-editorHoverWidget-background", "--cv-popover"],
      ["--vscode-editorWidget-background", "--cv-popover"],
      ["--vscode-menu-background", "--cv-popover"],
      ["--vscode-menu-selectionBackground", "--cv-tint-3"],
      ["--vscode-editorActionList-background", "--cv-popover"],
      ["--vscode-editorActionList-focusBackground", "--cv-tint-3"],
      ["--vscode-editorActionList-focusForeground", "--cv-fg-strong"],
    ];
    for (const [property, variable] of surfaceBindings) {
      expectDeclarationUsesVar(body, property, variable);
    }
    for (const border of [
      "--vscode-editorSuggestWidget-border",
      "--vscode-editorHoverWidget-border",
      "--vscode-editorWidget-border",
      "--vscode-menu-border",
    ]) {
      expect(body, `${border} is drawn by the shadow ring instead`).toMatch(
        new RegExp(`${escapeRegExp(border)}:\\s*transparent;`),
      );
    }
    expect(body).not.toMatch(MONACO_DEFAULT_BLUES);
  });

  it("keeps the focused context-menu row on the tint token", () => {
    const body = ruleBody(
      widgetCss,
      ".app-shell .monaco-menu .monaco-action-bar.vertical .action-item.focused .action-menu-item {",
    );
    expectDeclarationUsesVar(body, "background", "--cv-tint-3");
    expect(body).not.toMatch(MONACO_DEFAULT_BLUES);
  });
});

describe("Monaco suggest-widget kind icon recolor", () => {
  const kindToSyntaxVar: Array<[string, string]> = [
    ["symbol-method", "--cv-syn-kw"],
    ["symbol-constructor", "--cv-syn-kw"],
    ["symbol-function", "--cv-syn-kw"],
    ["symbol-keyword", "--cv-syn-kw"],
    ["symbol-event", "--cv-syn-kw"],
    ["symbol-property", "--cv-syn-num"],
    ["symbol-field", "--cv-syn-num"],
    ["symbol-constant", "--cv-syn-num"],
    ["symbol-enum-member", "--cv-syn-num"],
    ["symbol-value", "--cv-syn-num"],
    ["symbol-class", "--cv-accent"],
    ["symbol-struct", "--cv-accent"],
    ["symbol-interface", "--cv-accent"],
    ["symbol-enum", "--cv-accent"],
    ["symbol-file", "--cv-syn-str"],
    ["symbol-variable", "--cv-fg-muted"],
  ];

  it("recolors each suggest kind icon from the matching palette syntax token", () => {
    for (const [codicon, variable] of kindToSyntaxVar) {
      const selector = `.app-shell .monaco-editor .suggest-widget .codicon-${codicon}::before`;
      const index =
        widgetCss.indexOf(`${selector},`) >= 0
          ? widgetCss.indexOf(`${selector},`)
          : widgetCss.indexOf(`${selector} {`);
      expect(index, `missing suggest recolor for ${codicon}`).toBeGreaterThan(-1);
      const body = widgetCss.slice(widgetCss.indexOf("{", index), widgetCss.indexOf("}", index));
      expect(body, `${codicon} should use ${variable}`).toContain(`color: var(${variable})`);
    }
  });

  it("keeps the completion category qualifier readable beside each row", () => {
    const body = ruleBody(
      widgetCss,
      ".app-shell .monaco-editor .suggest-widget .monaco-list .monaco-list-row .label-description,",
    );
    expectDeclarationUsesVar(body, "color", "--cv-fg-muted");
  });

  it("colours the code-action widget icons (quickfix / refactor) consistently", () => {
    const body = ruleBody(
      widgetCss,
      ".app-shell .action-widget .monaco-list .monaco-list-row .codicon::before {",
    );
    expectDeclarationUsesVar(body, "color", "--cv-fg-muted");
    const focused = ruleBody(
      widgetCss,
      ".monaco-list-row.action.focused:not(.option-disabled)\n  .codicon::before {",
    );
    expectDeclarationUsesVar(focused, "color", "--cv-fg-strong");
  });

  it("keeps the Monaco widget sheet free of colour literals", () => {
    expect(widgetCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(widgetCss).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });

  it("declares required widget and symbol variables in every theme block", () => {
    const requiredThemeVariables = [
      "--color-accent-soft",
      "--color-modal",
      "--color-border-strong",
      "--symbol-method",
      "--symbol-property",
      "--symbol-const",
      "--symbol-class",
      "--symbol-interface",
      "--symbol-enum",
      "--symbol-function",
      "--symbol-trait",
      "--symbol-variable",
      "--symbol-keyword",
    ];

    const blocks = themeBlocks(appCss);
    expect(blocks.map(({ selector }) => selector)).toEqual([
      ":root",
      '.app-shell[data-theme="light"]',
      '.app-shell[data-theme="ayuMirage"]',
      '.app-shell[data-theme="materialDeepOcean"]',
      '.app-shell[data-theme="oneDarkPro"]',
      '.app-shell[data-theme="dracula"]',
      '.app-shell[data-theme="catppuccinMocha"]',
      '.app-shell[data-theme="darkPlus"]',
      '.app-shell[data-theme="catppuccinLatte"]',
      '.app-shell[data-theme="oneLight"]',
      '.app-shell[data-theme="system"]',
    ]);

    for (const { selector, body } of blocks) {
      for (const variable of requiredThemeVariables) {
        expect(body, `${selector} missing ${variable}`).toContain(`${variable}:`);
      }
    }
  });
});

/**
 * Final visual pass on the gutter change/rollback popover and the Git "Local
 * Changes" panel. Both are app-owned DOM (not Monaco widgets), so the chrome is
 * theme-aware through our --color-* / --change-* tokens. These guards lock the
 * JetBrains-classic hover/spacing polish so it survives future edits.
 */
describe("Gutter rollback popover + Git Local Changes polish", () => {
  it("fills the popover nav buttons on hover for a tactile JetBrains feel", () => {
    // The Previous/Next/Close + Revert buttons only recolored their border on
    // hover, which reads flat. Add a soft accent fill so hover matches the git
    // toolbar buttons and feels clickable across every theme.
    const body = ruleBody(appCss, ".editor-change-popover-icon-button:hover,");
    expect(body).toContain("background");
    expect(body).toMatch(/var\(--change-popover-soft\)|var\(--color-hover\)/);
  });

  it("gives the popover buttons a motion-token hover transition", () => {
    const body = ruleBody(
      appCss,
      ".editor-change-popover-icon-button,\n.editor-change-popover-action {",
    );
    expect(body).toContain("transition");
  });

  it("tints the active Git change row icon so it stays legible on the accent fill", () => {
    // The active row paints --color-accent-soft behind a status-tinted glyph; on
    // some themes the warm/red glyph clashes with the fill. Pin the active row's
    // icon + status letter to the active-text token so the selection reads clean.
    const body = ruleBody(
      appCss,
      ".git-change-row-wrapper.active .git-change-row .git-change-status-icon",
    );
    expect(body).toContain("var(--color-active-text)");
  });

  it("keeps the Local Changes count pill tabular and theme-aware", () => {
    const body = ruleBody(appCss, ".git-changes-summary {");
    expect(body).toContain("font-variant-numeric: tabular-nums");
    expect(body).toContain("var(--color-accent)");
  });
});
