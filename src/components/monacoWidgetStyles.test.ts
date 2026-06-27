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

  it("tints the selected suggest row with the shared accent-soft token", () => {
    const body = ruleBody(
      appCss,
      ".monaco-editor .suggest-widget .monaco-list .monaco-list-row.focused",
    );
    expect(body).toContain("var(--color-accent-soft)");
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

  it("declares a --symbol-keyword role for every theme block", () => {
    // Slice 2 shipped the other --symbol-* roles for 10 themes; the suggest
    // widget adds the keyword kind, so the role must exist everywhere too.
    const selectors = [
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
    ];
    for (const selector of selectors) {
      const start = appCss.indexOf(selector + " {");
      expect(start, `missing theme block ${selector}`).toBeGreaterThan(-1);
      const block = appCss.slice(start, appCss.indexOf("}", start));
      expect(block, `${selector} missing --symbol-keyword`).toContain(
        "--symbol-keyword:",
      );
    }
  });
});
