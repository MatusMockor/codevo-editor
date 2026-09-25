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
import {
  WORKBENCH_FRAME_EDITOR_SLOT_ATTRIBUTE,
  WORKBENCH_FRAME_EDITOR_YIELD_SELECTOR,
} from "./workbenchShellPlacement";

const SHELL_SHEET = "components/workbenchShellFrame.css";
const SURFACE_SHEET = "components/agentMode/agentSurface.css";
const MAXIMIZED = '.workbench-frame[data-layout="agent"][data-right-panel="maximized"]';

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

describe("expanded editing shell layout contract", () => {
  it("caps restored terminal height at three quarters of the window in every agent placement", () => {
    expect(
      declarations(shell, '.workbench-frame[data-layout="agent"]').get(
        "--agent-bottom-panel-height",
      ),
    ).toBe(
      "min(var(--agent-bottom-panel-requested,var(--agent-bottom-panel-committed)),var(--agent-bottom-panel-limit,75vh))",
    );
    expect(
      declarations(shell, '.workbench-frame[data-layout="agent"]').get("grid-template-rows"),
    ).toBe("minmax(0,1fr)var(--agent-bottom-panel-height)");
    expect(declarations(shell, MAXIMIZED).has("grid-template-rows")).toBe(false);
  });

  it("parses the frame and surface sheets without issues", () => {
    expect(parsed.issues).toEqual([]);
    expect(shell.length).toBeGreaterThan(0);
    expect(surface.length).toBeGreaterThan(0);
  });

  it("declares the surface header height and editor gutter without a tree column token", () => {
    const tokens = declarations(shell, ".app-shell");
    expect(tokens.get("--agent-surface-header-height")).toBe("var(--cv-topbar-h)");
    expect(tokens.get("--agent-surface-editor-gutter")).toBe("8px");
    expect([...tokens.keys()].filter((name) => name.includes("tree"))).toEqual([]);
    expect(parsed.rules.some((rule) => rule.selector.includes("data-tree"))).toBe(false);
  });

  it("builds the maximized grid as rail and centre", () => {
    expect(declarations(shell, MAXIMIZED).get("grid-template-columns")).toBe(
      compact("var(--agent-rail-track) minmax(0, 1fr)"),
    );

    const surfaceSlot = declarations(shell, `${MAXIMIZED} > [data-slot="surface"]`);
    expect(surfaceSlot.get("grid-column")).toBe("2");
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
        "inset(var(--agent-surface-header-height) 0 var(--agent-surface-editor-gutter) var(--agent-surface-editor-gutter) round var(--cv-r-group))",
      ),
    );

    const bottomSlot = declarations(shell, `${MAXIMIZED} > [data-slot="bottom"]`);
    expect(bottomSlot.get("grid-column")).toBe("2");
    expect(bottomSlot.get("grid-row")).toBe("2");
    expect(bottomSlot.get("background")).toBe("var(--cv-canvas)");
    expect(bottomSlot.get("border-radius")).toBe(
      compact("var(--cv-r-group) var(--cv-r-group) 0 0"),
    );
    expect(bottomSlot.get("margin-left")).toBe("var(--agent-surface-editor-gutter)");
  });

  it("keeps the docked editor overlay below the panel header and painted on the canvas tone", () => {
    const editorSlot = declarations(
      shell,
      '.workbench-frame[data-layout="agent"] > [data-slot="editor"]',
    );
    expect(editorSlot.get("padding-top")).toBe("var(--agent-surface-header-height)");
    expect(editorSlot.has("padding-left")).toBe(false);
    expect(editorSlot.get("background")).toBe("var(--cv-canvas)");
    expect(editorSlot.get("background-clip")).toBe("content-box");
    expect(editorSlot.get("clip-path")).toBe(
      compact("inset(var(--agent-surface-header-height) 0 0 0)"),
    );
  });

  it("keeps the editor overlay for an empty editor and lets the Files tree fill its surface", () => {
    expect(
      rulesFor(
        shell,
        '.workbench-frame[data-layout="agent"][data-editor="empty"][data-tree="visible"] > [data-slot="editor"]',
      ),
    ).toEqual([]);
    expect(rulesFor(shell, '.workbench-frame[data-editor="empty"] > [data-slot="editor"]')).toEqual(
      [],
    );
    const tree = declarations(surface, ".agent-surface-tree");
    expect(tree.get("flex")).toBe("11auto");
    expect(tree.has("width")).toBe(false);
    expect(
      rulesFor(
        surface,
        '.workbench-frame[data-editor="empty"][data-tree="visible"] .agent-surface-tree',
      ),
    ).toEqual([]);
    expect(rulesFor(surface, ".agent-surface__editor-slot")).toEqual([]);
  });

  it("yields the editor overlay whenever the surface panel hosts no editor slot", () => {
    expect(
      declarations(shell, `${WORKBENCH_FRAME_EDITOR_YIELD_SELECTOR} > [data-slot="editor"]`).get(
        "display",
      ),
    ).toBe("none");
    expect(WORKBENCH_FRAME_EDITOR_YIELD_SELECTOR).toContain(
      `.agent-surface[${WORKBENCH_FRAME_EDITOR_SLOT_ATTRIBUTE}="none"]`,
    );
  });

  it("never reverses the Files surface when maximized", () => {
    expect(declarations(surface, ".agent-surface__files").has("flex-direction")).toBe(false);
    expect(
      rulesFor(surface, '.workbench-frame[data-right-panel="maximized"] .agent-surface__files'),
    ).toEqual([]);
  });

  it("paints the surfaces with tone steps only", () => {
    const owned = parsed.rules.filter((rule) => [SHELL_SHEET, SURFACE_SHEET].includes(rule.sheet));
    expect(collectBorderViolations(owned, tokenTable)).toEqual([]);
    expect(declarations(surface, ".agent-surface").get("background")).toBe("var(--cv-canvas)");
    expect(declarations(surface, ".agent-surface-tree").get("background")).toBe("var(--cv-canvas)");
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

  it("drops the rail track before the editor column collapses", () => {
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
    expect(declarations(shell, MAXIMIZED).get("background")).toBe("var(--cv-canvas)");
  });
});

describe("dialog, toast and terminal chrome", () => {
  it("resolve only palette tokens so portaled surfaces never go transparent", () => {
    const sheets = new Set([
      "components/ExternalFileConflict.css",
      "components/DirtyCloseDecisionDialogHost.css",
      "components/QuickInputDialogHost.css",
      "components/terminalPanel.css",
      "components/toastNotification.css",
      "components/fileTypeGlyph.css",
    ]);
    const legacy = parseAllStyleSheets()
      .rules.filter((rule) => sheets.has(rule.sheet))
      .flatMap((rule) =>
        rule.declarations.map((declaration) => `${rule.sheet} ${declaration.value}`),
      )
      .filter((entry) => /var\(--(?:color|codevo|agent)-/.test(entry));

    expect(legacy).toEqual([]);
  });
});
