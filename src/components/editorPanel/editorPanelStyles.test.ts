import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = resolve(import.meta.dirname);
const SHEETS = [
  "editorPanel.css",
  "editorGutter.css",
  "editorWidgets.css",
  "editorTabs.css",
  "editorSurface.css",
];
const sheets = new Map(SHEETS.map((name) => [name, readFileSync(resolve(dir, name), "utf8")]));
const app = readFileSync(resolve(dir, "../../App.css"), "utf8");

function sheet(name: string): string {
  return sheets.get(name) ?? "";
}

describe("editor panel style contract", () => {
  it.each(SHEETS)("uses tokens only in %s: no hex, rgb or hsl colour literals", (name) => {
    expect(sheet(name)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sheet(name)).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });

  it.each(SHEETS)("references only --cv-* custom properties in %s", (name) => {
    const references = [...sheet(name).matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);
    const foreign = references.filter(
      (reference) => !reference?.startsWith("--cv-") && !reference?.startsWith("--vscode-"),
    );

    expect(foreign).toEqual([]);
  });

  it("keeps the mockup sizes", () => {
    expect(sheet("editorPanel.css")).toMatch(/\.cv-esub \{[^}]*height: 40px;/);
    expect(sheet("editorGutter.css")).toMatch(/\.editor-change-line \{[^}]*width: 3px !important;/);
    expect(sheet("editorWidgets.css")).toMatch(
      /\.find-widget:not\(\.replaceToggled\) \{[^}]*height: 36px;/,
    );
    expect(sheet("editorTabs.css")).toMatch(/\.editor-tab \{[^}]*height: 24px;/);
    expect(sheet("editorTabs.css")).toMatch(/\.editor-tab \{[^}]*max-width: 144px;/);
  });

  it("keeps the preview tab italic and the dirty dot on the canvas ring", () => {
    expect(sheet("editorTabs.css")).toMatch(/\.editor-tab\.preview \.tab-name \{[^}]*italic/);
    expect(sheet("editorTabs.css")).toMatch(/\.dirty-dot \{[^}]*var\(--cv-ring-canvas\)/);
  });

  it("colours tab git status like the Files tree and the Git list", () => {
    const tabs = sheet("editorTabs.css");

    expect(tabs).toMatch(/\.editor-tab-status-untracked[^{]*\{[^}]*var\(--cv-ok\)/);
    expect(tabs).toMatch(/\.editor-tab-status-modified \{[^}]*var\(--cv-warn\)/);
    expect(tabs).toMatch(/\.editor-tab-status-deleted[^{]*\{[^}]*var\(--cv-danger\)/);
  });

  it("paints the gutter and debug decorations with the editor tokens", () => {
    const gutter = sheet("editorGutter.css");

    expect(gutter).toMatch(/\.editor-change-line-modified \{[^}]*var\(--cv-git-mod\)/);
    expect(gutter).toMatch(/\.breakpoint-glyph-verified::before \{[^}]*var\(--cv-breakpoint\)/);
    expect(gutter).toMatch(/\.debug-stopped-line \{[^}]*var\(--cv-warn-soft\)/);
    expect(gutter).toMatch(/\.debug-inline-value \{[^}]*var\(--cv-fg-subtle\)/);
  });

  it("respects reduced motion for every transition", () => {
    for (const name of SHEETS) {
      if (!/transition:/.test(sheet(name))) continue;
      expect(sheet(name), name).toContain("prefers-reduced-motion: reduce");
    }
  });

  it("leaves no migrated editor rule behind in App.css", () => {
    for (const selector of [
      ".editor-tab",
      ".breadcrumb",
      ".tab-main",
      ".tab-close",
      ".dirty-dot",
      ".breakpoint-glyph",
      ".inline-breakpoint-marker",
      ".debug-inline-value",
      ".debug-stopped-line",
      ".editor-change-glyph",
      ".editor-change-line",
      ".bookmark-gutter-glyph",
      ".coverage-",
      ".suggest-widget",
      ".monaco-hover",
      ".action-widget",
      ".monaco-menu",
      ".editor-empty-overlay",
      "--vscode-",
    ]) {
      expect(app, selector).not.toContain(selector);
    }
    expect(app).not.toMatch(/^\.editor-panel \{/m);
    expect(app).not.toMatch(/^\.editor-loading-placeholder \{/m);
  });
});

const DRAWER_SHEETS = ["editorDrawer.css", "../debug/debug.css"];
const drawerSheets = new Map(
  DRAWER_SHEETS.map((name) => [name, readFileSync(resolve(dir, name), "utf8")]),
);

function drawerSheet(name: string): string {
  return drawerSheets.get(name) ?? "";
}

describe("editor drawer, Problems and debug style contract", () => {
  it.each(DRAWER_SHEETS)("uses tokens only in %s: no colour literals", (name) => {
    expect(drawerSheet(name)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(drawerSheet(name)).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });

  it.each(DRAWER_SHEETS)("references only --cv-* custom properties in %s", (name) => {
    const references = [...drawerSheet(name).matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);

    expect(references.filter((reference) => !reference?.startsWith("--cv-"))).toEqual([]);
  });

  it("keeps the mockup drawer, tab, row and side column sizes", () => {
    const drawer = drawerSheet("editorDrawer.css");
    const debug = drawerSheet("../debug/debug.css");

    expect(drawer).toMatch(/\.cv-edrawer__head \{[^}]*height: 36px;/);
    expect(drawer).toMatch(/\.cv-edrawer__tab \{[^}]*height: 24px;/);
    expect(drawer).toMatch(/\.cv-problems__file \{[^}]*height: 26px;/);
    expect(drawer).toMatch(
      /\.cv-problems__item \{[^}]*height: 26px;[^}]*padding: 0 var\(--cv-space-4\) 0 28px;/,
    );
    expect(drawer).toMatch(/\.cv-problems__item\[aria-current="true"\] \{[^}]*var\(--cv-tint-2\)/);
    expect(debug).toMatch(/\.cv-dside \{[^}]*width: 304px;/);
    expect(debug).toMatch(/\.cv-dside__head \{[^}]*height: 30px;/);
    expect(debug).toMatch(/\.cv-dside__dot \{[^}]*var\(--cv-breakpoint\)/);
  });

  it("sizes the drawer 224px, or 236px while debugging", async () => {
    const sizes = await import("./editorDrawerSize");

    expect(sizes.DEFAULT_EDITOR_DRAWER_HEIGHT).toBe(224);
    expect(sizes.DEBUG_EDITOR_DRAWER_HEIGHT).toBe(236);
  });

  it("respects reduced motion in the debug side column", () => {
    const debug = drawerSheet("../debug/debug.css");

    expect(debug).toContain("transition:");
    expect(debug).toContain("prefers-reduced-motion: reduce");
  });

  it("keeps legacy inline colour variables out of the debug components", () => {
    const sources = [
      "../DebugPanel.tsx",
      "../DebugConsolePanel.tsx",
      "../DebugVariableTree.tsx",
      "../DebugWatchesPanel.tsx",
      "../debug/DebugBreakpoints.tsx",
      "../debug/DebugCallStack.tsx",
      "../debug/DebugConsoleRegion.tsx",
      "../debug/DebugSectionsRegion.tsx",
      "../debug/DebugToolbarRegion.tsx",
    ];
    for (const source of sources) {
      expect(readFileSync(resolve(dir, source), "utf8"), source).not.toMatch(
        /var\(--(border-subtle|text-muted|background-active|status-error|panel-bg|surface-raised|selection-bg)/,
      );
    }
  });

  it("leaves no migrated Problems or panel-tab rule behind in App.css", () => {
    for (const selector of [".problems-", ".problem-row", ".bottom-panel-tabs"]) {
      expect(app, selector).not.toContain(selector);
    }
  });

  it("leaves no stale panel-tab rule in the terminal panel sheet", () => {
    expect(readFileSync(resolve(dir, "../terminalPanel.css"), "utf8")).not.toContain(
      ".bottom-panel-tabs",
    );
  });
});

describe("editor drawer header fit contract", () => {
  const drawer = readFileSync(resolve(dir, "editorDrawer.css"), "utf8");

  function block(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return drawer.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`))?.[1] ?? "";
  }

  it("keeps the drawer tabs at their natural width", () => {
    expect(block(".cv-edrawer__tabs")).toMatch(/flex: none;/);
    expect(block(".cv-edrawer__more")).toMatch(/flex: none;/);
  });

  it("lets only the view extras shrink so header actions and Close stay visible", () => {
    expect(block(".cv-edrawer__end")).toMatch(/min-width: 0;/);
    expect(block(".cv-edrawer__end > *")).toMatch(/flex: none;/);
    const extras = block(".cv-edrawer__end > .cv-edrawer__extras");
    expect(extras).toMatch(/flex: 0 1 auto;/);
    expect(extras).toMatch(/min-width: 0;/);
    expect(extras).toMatch(/overflow-x: auto;/);
  });

  it("collapses secondary Problems controls when the drawer header is narrow", () => {
    expect(block(".cv-edrawer__head")).toMatch(/container: cv-edrawer-head \/ inline-size;/);
    expect(drawer).toMatch(
      /@container cv-edrawer-head \(max-width: 720px\) \{[^@]*\.cv-problems__toolbar \.cv-problems__grouping,\s*\.cv-problems__toolbar \.cv-problems__package-filter \{\s*display: none;/,
    );
    expect(block(".cv-problems__filter")).toMatch(/flex: 0 1 180px;/);
  });

  it("shows the active package filter chip only while the package select is collapsed", () => {
    expect(block(".cv-problems__package-chip")).toMatch(/display: none;/);
    expect(drawer).toMatch(
      /@container cv-edrawer-head \(max-width: 720px\) \{[^@]*\.cv-problems__toolbar \.cv-problems__package-chip \{\s*display: inline-flex;/,
    );
  });
});
