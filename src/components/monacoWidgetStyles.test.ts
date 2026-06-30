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
  const themeSelector =
    /(^|\n)(\s*(?::root|\.app-shell\[data-theme="[^"]+"\])\s*)\{/g;
  let match: RegExpExecArray | null;
  while ((match = themeSelector.exec(css)) !== null) {
    const selector = match[2].trim();
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

function expectDeclarationUsesVar(
  body: string,
  property: string,
  variable: string,
): void {
  expect(body).toMatch(
    new RegExp(`${escapeRegExp(property)}:\\s*var\\(${escapeRegExp(variable)}\\)`),
  );
}

describe("Monaco widget chrome (JetBrains classic)", () => {
  it("rounds and shadows the suggest widget with shared design tokens", () => {
    const body = ruleBody(appCss, ".monaco-editor .suggest-widget,");
    expect(body).toContain("border-radius");
    expect(body).toContain("box-shadow");
  });

  it("rounds the hover widget so it matches the suggest popup", () => {
    const body = ruleBody(appCss, ".monaco-editor .monaco-hover,");
    expect(body).toContain("border-radius");
  });

  it("rounds the context / code-action menu so it matches the popups", () => {
    const body = ruleBody(appCss, ".monaco-menu .monaco-action-bar");
    expect(body).toContain("border-radius");
  });

  it("rounds and shadows the code-action widget (Cmd+.) like the popups", () => {
    // The lightbulb / Cmd+. list is Monaco's newer `.action-widget`, a DIFFERENT
    // DOM from `.monaco-menu` (it ships its own actionWidget.css with a 5px radius
    // and a blue --vscode-editorActionList-focusBackground selection). Without an
    // override it falls back to Monaco's default chrome, so pin our JetBrains look.
    const body = ruleBody(appCss, ".monaco-editor .action-widget,");
    expect(body).toContain("border-radius");
    expect(body).toContain("box-shadow");
    expect(body).toContain("var(--color-modal)");
    expect(body).toContain("var(--color-border-strong)");
  });

  it("reads the code-action group headers as quiet uppercase section labels", () => {
    // Quick Fix... / Refactor... group rows separate the action categories; give
    // them the same quiet uppercase section-label treatment the other JetBrains
    // chrome uses so the categories read at a glance above the prioritised rows.
    const body = ruleBody(
      appCss,
      ".monaco-editor .action-widget .monaco-list-row.group-header,",
    );
    expect(body).toContain("var(--color-text-muted)");
    expect(body).toContain("text-transform: uppercase");
    expect(body).toContain("letter-spacing");
  });

  it("tints the focused code-action row with accent-soft, not Monaco blue", () => {
    // Monaco focuses the row via `.monaco-list-row.action.focused` using its blue
    // --vscode-editorActionList-focusBackground; recolor it to our soft accent so
    // the selected Quick Fix / Extract row matches the suggest rows on every theme.
    const body = ruleBody(
      appCss,
      ".monaco-editor .action-widget .monaco-list .monaco-list-row.action.focused",
    );
    expect(body).toContain("var(--color-accent-soft)");
    expect(body).toContain("var(--color-text-strong)");
  });

  it("tints the selected suggest row with the shared accent-soft token", () => {
    const body = ruleBody(
      appCss,
      ".monaco-editor .suggest-widget .monaco-list .monaco-list-row.focused",
    );
    expect(body).toContain("var(--color-accent-soft)");
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

  it("pins Monaco widget surface variables to theme-aware chrome tokens", () => {
    // Monaco reads these --vscode-* variables for the popup surfaces. Bundled
    // Shiki themes ship none of the matching theme tokens, so pinning them here
    // (to our --color-* tokens) keeps every theme's popups consistent.
    const body = ruleBody(appCss, ".app-shell .monaco-editor,");
    const surfaceBindings: Array<[string, string]> = [
      ["--vscode-editorSuggestWidget-background", "--color-modal"],
      ["--vscode-editorSuggestWidget-border", "--color-border-strong"],
      ["--vscode-editorHoverWidget-background", "--color-modal"],
      ["--vscode-menu-background", "--color-modal"],
      ["--vscode-menu-selectionBackground", "--color-accent-soft"],
    ];
    for (const [vscodeVar, token] of surfaceBindings) {
      expect(body, `${vscodeVar} should bind to ${token}`).toContain(
        `${vscodeVar}: var(${token})`,
      );
    }
  });

  it("keeps focused widget states and popup surfaces on theme variables", () => {
    const surfaceBody = ruleBody(appCss, ".app-shell .monaco-editor,");
    const themeAwareBindings: Array<[string, string]> = [
      ["--vscode-editorSuggestWidget-selectedBackground", "--color-accent-soft"],
      ["--vscode-editorHoverWidget-background", "--color-modal"],
      ["--vscode-editorHoverWidget-border", "--color-border-strong"],
      ["--vscode-menu-selectionBackground", "--color-accent-soft"],
      ["--vscode-editorActionList-focusBackground", "--color-accent-soft"],
    ];
    for (const [property, variable] of themeAwareBindings) {
      expectDeclarationUsesVar(surfaceBody, property, variable);
    }

    const focusedSelectors: Array<[string, Array<[string, string]>]> = [
      [
        ".monaco-editor .suggest-widget .monaco-list .monaco-list-row.focused",
        [["background", "--color-accent-soft"]],
      ],
      [
        ".monaco-menu\n  .monaco-action-bar.vertical\n  .action-item.focused\n  .action-menu-item",
        [["background", "--color-accent-soft"]],
      ],
      [
        ".monaco-editor .action-widget .monaco-list .monaco-list-row.action.focused",
        [
          ["background-color", "--color-accent-soft"],
          ["color", "--color-text-strong"],
        ],
      ],
    ];

    for (const [selector, declarations] of focusedSelectors) {
      const body = ruleBody(appCss, selector);
      for (const [property, variable] of declarations) {
        expectDeclarationUsesVar(body, property, variable);
      }
      expect(body, `${selector} should not hardcode Monaco default colors`).not
        .toMatch(/#(?:007acc|04395e|062f4a|094771|0e639c|264f78|006ab1)\b/i);
    }
  });
});

describe("Monaco suggest-widget kind icon recolor", () => {
  // Monaco renders completion kinds as codicons inside the suggest widget; its
  // own rule colors them via `.monaco-editor .codicon.codicon-symbol-method`.
  // We override the same icons under `.suggest-widget` so they read with the
  // exact FileStructure --symbol-* roles for every theme at once.
  const kindToSymbolVar: Array<[string, string]> = [
    ["symbol-method", "--symbol-method"],
    ["symbol-function", "--symbol-function"],
    ["symbol-property", "--symbol-property"],
    ["symbol-field", "--symbol-property"],
    ["symbol-constant", "--symbol-const"],
    ["symbol-enum-member", "--symbol-const"],
    ["symbol-class", "--symbol-class"],
    ["symbol-interface", "--symbol-interface"],
    ["symbol-enum", "--symbol-enum"],
    ["symbol-variable", "--symbol-variable"],
    ["symbol-keyword", "--symbol-keyword"],
    // Laravel "magic" completion categories ride distinct Monaco kinds so the
    // suggest list reads as PhpStorm-style groups: relations use Field (already
    // mapped to --symbol-property above), magic query scopes use Function, and
    // dynamic where<Attribute>() magic uses Event. Recolor the Laravel value /
    // view glyphs (Value/File kinds) and the Event glyph so every category is
    // told apart by colour, not only by sortText order.
    ["symbol-event", "--symbol-enum"],
    ["symbol-value", "--symbol-const"],
    ["symbol-file", "--symbol-interface"],
  ];

  it("recolors each suggest kind icon from the matching --symbol-* variable", () => {
    for (const [codicon, symbolVar] of kindToSymbolVar) {
      // Anchor on `::before {` so `symbol-enum` does not also match the longer
      // `symbol-enum-member` rule (which intentionally uses --symbol-const).
      const selector = `.monaco-editor .suggest-widget .codicon-${codicon}::before`;
      const index = appCss.indexOf(selector);
      expect(index, `missing suggest recolor for ${codicon}`).toBeGreaterThan(
        -1,
      );
      // The color must come from the theme-aware symbol variable, not a literal.
      const body = appCss.slice(index, appCss.indexOf("}", index));
      expect(body, `${codicon} should use ${symbolVar}`).toContain(
        `var(${symbolVar})`,
      );
    }
  });

  it("keeps the completion category qualifier readable beside each row", () => {
    // PhpStorm-style grouping leans on the per-row category text our provider
    // packs into `label.description` ("relation - ...", "scope - ...", "magic
    // where - ..."). Monaco renders it as the right-aligned `.label-description`
    // inside the suggest row; pin it to a theme-aware muted token so the category
    // reads as a quiet qualifier on every theme instead of inheriting Monaco's
    // baked-in detail colour.
    const selector =
      ".monaco-editor .suggest-widget .monaco-list .monaco-list-row .label-description";
    const index = appCss.indexOf(selector);
    expect(index, "missing suggest label-description rule").toBeGreaterThan(-1);
    const body = appCss.slice(index, appCss.indexOf("}", index));
    expect(body).toContain("var(--color-text-muted)");
  });

  it("colours the code-action widget icons (quickfix / refactor) consistently", () => {
    // The Cmd+. list shows a lightbulb (quickfix) / wrench (refactor) codicon per
    // row. Tie those glyphs to a theme-aware token so they read consistently on
    // every theme rather than inheriting Monaco's default action-list colour.
    const selector =
      ".monaco-editor .action-widget .monaco-list .monaco-list-row .codicon::before";
    const index = appCss.indexOf(selector);
    expect(index, "missing action-widget codicon rule").toBeGreaterThan(-1);
    const body = appCss.slice(index, appCss.indexOf("}", index));
    expect(body).toMatch(/color:\s*var\(--color-/);
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
        expect(body, `${selector} missing ${variable}`).toContain(
          `${variable}:`,
        );
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
    const body = ruleBody(
      appCss,
      ".editor-change-popover-icon-button:hover,",
    );
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
