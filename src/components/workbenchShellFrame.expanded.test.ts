import { describe, expect, it } from "vitest";
import {
  TOKEN_SHEETS,
  buildTokenTable,
  collectBorderViolations,
  parseAllStyleSheets,
  type CssRule,
} from "./cssContractTestSupport";
import {
  EMPTY_WORKBENCH_FRAME_EDITOR_REPORTS,
  MAX_WORKBENCH_FRAME_EDITOR_REPORTS,
  nextWorkbenchFrameEditorReports,
  workbenchFrameEditorState,
} from "./workbenchFrameEditorReport";

const SHELL_SHEET = "components/workbenchShellFrame.css";
const SURFACE_SHEET = "components/agentMode/agentSurface.css";
const STATUS_BAR_SHEET = "components/agentMode/agentStatusBar.css";
const MAXIMIZED = '.workbench-frame[data-layout="agent"][data-right-panel="maximized"]';
const DOCKED_TREE_BESIDE_DOCUMENT = `${MAXIMIZED}[data-tree="visible"]:not([data-editor="empty"])`;

const parsed = parseAllStyleSheets();
const shell = parsed.rules.filter((rule) => rule.sheet === SHELL_SHEET);
const surface = parsed.rules.filter((rule) => rule.sheet === SURFACE_SHEET);
const tokenTable = buildTokenTable(
  parsed.rules.filter((rule) => (TOKEN_SHEETS as readonly string[]).includes(rule.sheet)),
);

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

function rulesFor(rules: readonly CssRule[], selector: string): readonly CssRule[] {
  const wanted = compact(selector);
  return rules.filter((rule) => rule.context.length === 0 && compact(rule.selector) === wanted);
}

function declarations(rules: readonly CssRule[], selector: string): ReadonlyMap<string, string> {
  const matches = rulesFor(rules, selector);
  expect(matches.length, `Missing rule ${selector}`).toBeGreaterThan(0);
  const values = new Map<string, string>();
  for (const rule of matches) {
    for (const declaration of rule.declarations) {
      values.set(declaration.property, compact(declaration.value));
    }
  }
  return values;
}

function ruleIndex(rules: readonly CssRule[], selector: string): number {
  const wanted = compact(selector);
  return rules.findIndex((rule) => rule.context.length === 0 && compact(rule.selector) === wanted);
}

describe("expanded editing shell layout contract", () => {
  it("parses the frame and surface sheets without issues", () => {
    expect(parsed.issues).toEqual([]);
    expect(shell.length).toBeGreaterThan(0);
    expect(surface.length).toBeGreaterThan(0);
  });

  it("sizes the tree 210 px docked, 300 px maximized and 0 px when hidden, in that order", () => {
    const tokens = declarations(shell, ".app-shell");
    expect(tokens.get("--agent-surface-header-height")).toBe("40px");
    expect(tokens.get("--agent-surface-tree-width")).toBe("210px");
    expect(tokens.get("--agent-surface-editor-gutter")).toBe("8px");
    expect(
      declarations(shell, '.workbench-frame[data-right-panel="maximized"]').get(
        "--agent-surface-tree-width",
      ),
    ).toBe("300px");
    expect(
      declarations(shell, '.workbench-frame[data-tree="hidden"]').get("--agent-surface-tree-width"),
    ).toBe("0px");
    expect(ruleIndex(shell, '.workbench-frame[data-tree="hidden"]')).toBeGreaterThan(
      ruleIndex(shell, '.workbench-frame[data-right-panel="maximized"]'),
    );
  });

  it("builds the maximized grid as rail, centre and a docked tree column", () => {
    expect(declarations(shell, MAXIMIZED).get("grid-template-columns")).toBe(
      compact("var(--agent-rail-track) minmax(0, 1fr) var(--agent-surface-tree-width)"),
    );

    const surfaceSlot = declarations(shell, `${MAXIMIZED} > [data-slot="surface"]`);
    expect(surfaceSlot.get("grid-column")).toBe("2/4");
    expect(surfaceSlot.get("grid-row")).toBe("1");

    const editorSlot = declarations(shell, `${MAXIMIZED} > [data-slot="editor"]`);
    expect(editorSlot.get("grid-column")).toBe("2");
    expect(editorSlot.get("grid-row")).toBe("1");
    expect(editorSlot.get("padding")).toBe(
      compact(
        "var(--agent-surface-header-height) 0 var(--agent-surface-editor-gutter) var(--agent-surface-editor-gutter)",
      ),
    );
    expect(editorSlot.get("clip-path")).toBe(
      compact(
        "inset(var(--agent-surface-header-height) 0 var(--agent-surface-editor-gutter) var(--agent-surface-editor-gutter) round var(--codevo-r-lg))",
      ),
    );

    const bottomSlot = declarations(shell, `${MAXIMIZED} > [data-slot="bottom"]`);
    expect(bottomSlot.get("grid-column")).toBe("2/4");
    expect(bottomSlot.get("grid-row")).toBe("2");
    expect(bottomSlot.get("background")).toBe("var(--codevo-canvas)");
    expect(bottomSlot.get("border-radius")).toBe(
      compact("var(--codevo-r-lg) var(--codevo-r-lg) 0 0"),
    );
    expect(bottomSlot.get("margin-left")).toBe("var(--agent-surface-editor-gutter)");
  });

  it("runs the docked tree full height beside an open document with the bottom panel under the editor only", () => {
    expect(
      declarations(shell, `${DOCKED_TREE_BESIDE_DOCUMENT} > [data-slot="surface"]`).get("grid-row"),
    ).toBe("1/-1");
    expect(
      declarations(shell, `${DOCKED_TREE_BESIDE_DOCUMENT} > [data-slot="bottom"]`).get(
        "grid-column",
      ),
    ).toBe("2");
  });

  it("keeps the docked editor overlay padded by the tree and painted on the canvas tone", () => {
    const editorSlot = declarations(
      shell,
      '.workbench-frame[data-layout="agent"] > [data-slot="editor"]',
    );
    expect(editorSlot.get("padding-top")).toBe("var(--agent-surface-header-height)");
    expect(editorSlot.get("padding-left")).toBe("var(--agent-surface-tree-width)");
    expect(editorSlot.get("background")).toBe("var(--codevo-canvas)");
    expect(editorSlot.get("background-clip")).toBe("content-box");
    expect(editorSlot.get("clip-path")).toBe(
      compact("inset(var(--agent-surface-header-height) 0 0 var(--agent-surface-tree-width))"),
    );
  });

  it("hides the editor overlay only while no document is open and a tree is showing", () => {
    const treeOnly =
      '.workbench-frame[data-layout="agent"][data-editor="empty"][data-tree="visible"] > [data-slot="editor"]';
    expect(declarations(shell, treeOnly).get("display")).toBe("none");
    expect(
      rulesFor(
        shell,
        '.workbench-frame[data-layout="agent"][data-editor="empty"] > [data-slot="editor"]',
      ),
    ).toEqual([]);
    expect(rulesFor(shell, '.workbench-frame[data-editor="empty"] > [data-slot="editor"]')).toEqual(
      [],
    );

    const tree = declarations(
      surface,
      '.workbench-frame[data-editor="empty"][data-tree="visible"] .agent-surface-tree',
    );
    expect(tree.get("flex")).toBe("11auto");
    expect(tree.get("width")).toBe("auto");
    expect(
      declarations(
        surface,
        '.workbench-frame[data-editor="empty"][data-tree="visible"] .agent-surface__editor-slot',
      ).get("display"),
    ).toBe("none");
    expect(
      rulesFor(surface, '.workbench-frame[data-editor="empty"] .agent-surface__editor-slot'),
    ).toEqual([]);
  });

  it("docks the tree right only in the maximized state", () => {
    expect(declarations(surface, ".agent-surface__files").has("flex-direction")).toBe(false);
    expect(
      declarations(
        surface,
        '.workbench-frame[data-right-panel="maximized"] .agent-surface__files',
      ).get("flex-direction"),
    ).toBe("row-reverse");
    expect(declarations(surface, ".agent-surface-tree").get("width")).toBe(
      "var(--agent-surface-tree-width)",
    );
  });

  it("paints the surfaces with tone steps only", () => {
    const owned = parsed.rules.filter((rule) =>
      [SHELL_SHEET, SURFACE_SHEET, STATUS_BAR_SHEET].includes(rule.sheet),
    );
    expect(collectBorderViolations(owned, tokenTable)).toEqual([]);
    expect(declarations(surface, ".agent-surface").get("background")).toBe("var(--codevo-side)");
    expect(declarations(surface, ".agent-surface-tree").get("background")).toBe(
      "var(--codevo-side)",
    );
    expect(declarations(surface, ".agent-surface__editor-slot").get("background")).toBe(
      "var(--codevo-canvas)",
    );
  });
});

describe("workbenchFrameEditorReport", () => {
  it("starts empty and reports documents while any mounted group holds one", () => {
    let reports = EMPTY_WORKBENCH_FRAME_EDITOR_REPORTS;
    expect(workbenchFrameEditorState(reports)).toBe("empty");

    reports = nextWorkbenchFrameEditorReports(reports, "a", "empty");
    expect(workbenchFrameEditorState(reports)).toBe("empty");

    reports = nextWorkbenchFrameEditorReports(reports, "b", "documents");
    expect(workbenchFrameEditorState(reports)).toBe("documents");

    reports = nextWorkbenchFrameEditorReports(reports, "b", null);
    expect(workbenchFrameEditorState(reports)).toBe("empty");

    reports = nextWorkbenchFrameEditorReports(reports, "a", null);
    expect(workbenchFrameEditorState(reports)).toBe("empty");
    expect(reports.size).toBe(0);
  });

  it("keeps the same map for a repeated report and an unknown removal", () => {
    const reports = nextWorkbenchFrameEditorReports(
      EMPTY_WORKBENCH_FRAME_EDITOR_REPORTS,
      "a",
      "empty",
    );
    expect(nextWorkbenchFrameEditorReports(reports, "a", "empty")).toBe(reports);
    expect(nextWorkbenchFrameEditorReports(reports, "missing", null)).toBe(reports);
  });

  it("stays bounded past the group cap and fails toward showing the editor", () => {
    let reports = EMPTY_WORKBENCH_FRAME_EDITOR_REPORTS;
    for (let index = 0; index < MAX_WORKBENCH_FRAME_EDITOR_REPORTS; index += 1) {
      reports = nextWorkbenchFrameEditorReports(reports, `group-${index}`, "empty");
    }
    expect(reports.size).toBe(MAX_WORKBENCH_FRAME_EDITOR_REPORTS);
    expect(nextWorkbenchFrameEditorReports(reports, "overflow-empty", "empty")).toBe(reports);

    const withDocuments = nextWorkbenchFrameEditorReports(reports, "overflow", "documents");
    expect(withDocuments.size).toBe(MAX_WORKBENCH_FRAME_EDITOR_REPORTS);
    expect(withDocuments.get("overflow")).toBe("documents");
    expect(workbenchFrameEditorState(withDocuments)).toBe("documents");

    let allDocuments = EMPTY_WORKBENCH_FRAME_EDITOR_REPORTS;
    for (let index = 0; index < MAX_WORKBENCH_FRAME_EDITOR_REPORTS; index += 1) {
      allDocuments = nextWorkbenchFrameEditorReports(allDocuments, `group-${index}`, "documents");
    }
    expect(nextWorkbenchFrameEditorReports(allDocuments, "overflow", "documents")).toBe(
      allDocuments,
    );
  });

  it("keeps the center track while overlaying the surface and editor at the viewport right edge", () => {
    const overlay = '.workbench-frame[data-layout="agent"][data-right-panel="overlay"]';
    expect(declarations(shell, overlay).get("grid-template-columns")).toBe(
      "var(--agent-rail-track)minmax(var(--agent-center-min-width),1fr)0",
    );
    expect(declarations(shell, `${overlay} .agent-mode__grid`).get("grid-template-rows")).toBe(
      "minmax(0,1fr)var(--agent-bottom-panel-height)",
    );
    expect(declarations(shell, `${overlay} .agent-mode__center`).get("grid-column")).toBe("2");
    expect(declarations(shell, `${overlay} .agent-mode__center`).get("grid-row")).toBe("1");
    const slots = `${overlay} > [data-slot="surface"], ${overlay} > [data-slot="editor"]`;
    const placement = declarations(shell, slots);
    expect(placement.get("position")).toBe("absolute");
    expect(placement.get("right")).toBe("0");
    expect(placement.get("width")).toBe("var(--agent-right-panel-width)");
    expect(placement.get("grid-column")).toBe("auto");
    expect(placement.get("grid-row")).toBe("auto");
    expect(declarations(shell, `${overlay} > [data-slot="surface"]`).get("z-index")).toBe("2");
    expect(declarations(shell, `${overlay} > [data-slot="editor"]`).get("z-index")).toBe("3");
  });

  it("narrows the docked tree and drops the rail track before the editor column collapses", () => {
    const compactRules = parsed.rules.filter(
      (rule) =>
        rule.sheet === SHELL_SHEET &&
        rule.context.length === 1 &&
        rule.context[0] === "@media (max-width: 900px)",
    );
    const compact = compactRules.find(
      (rule) =>
        rule.selector ===
        '.workbench-frame[data-layout="agent"][data-right-panel="maximized"]:not([data-tree="hidden"])',
    );
    expect(compact?.declarations).toEqual([
      { property: "--agent-surface-tree-width", value: "210px" },
    ]);

    const narrowRules = parsed.rules.filter(
      (rule) =>
        rule.sheet === SHELL_SHEET &&
        rule.context.length === 1 &&
        rule.context[0] === "@media (max-width: 720px)",
    );
    const narrow = narrowRules.find((rule) =>
      rule.selector.includes('[data-right-panel="maximized"]'),
    );
    expect(narrow?.selector).toContain('[data-right-panel="docked"]');
    expect(narrow?.declarations).toEqual([{ property: "--agent-rail-track", value: "0px" }]);
    expect(declarations(shell, MAXIMIZED).get("background")).toBe("var(--codevo-side)");
  });
});
