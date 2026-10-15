import { describe, expect, it } from "vitest";
import { parseCssRules, readStyleSheet } from "../../../cssContractTestSupport";

const sheet = "components/agentMode/rightPanel/files/agentFiles.css";
const rules = parseCssRules(readStyleSheet(sheet).source, sheet).rules;
const viewerSheet = "components/agentMode/rightPanel/fileViewer/fileViewer.css";
const viewerRules = parseCssRules(readStyleSheet(viewerSheet).source, viewerSheet).rules;

function declarations(selector: string): ReadonlyMap<string, string> {
  const rule = rules.find((candidate) => candidate.selector.replace(/\s+/g, " ") === selector);
  return new Map(
    rule?.declarations.map((declaration) => [declaration.property, declaration.value]) ?? [],
  );
}

function viewerDeclarations(selector: string): ReadonlyMap<string, string> {
  const rule = viewerRules.find(
    (candidate) => candidate.selector.replace(/\s+/g, " ") === selector,
  );
  return new Map(
    rule?.declarations.map((declaration) => [declaration.property, declaration.value]) ?? [],
  );
}

describe("files surface layout", () => {
  it("fills the surface with the tree and results, with no editor preview", () => {
    expect(declarations(".cv-files__results").get("flex")).toBe("1 1 auto");
    expect(declarations(".cv-files__results").has("width")).toBe(false);
    expect(
      rules
        .filter((rule) => /cv-files__(crumb|preview)/.test(rule.selector))
        .map((rule) => rule.selector),
    ).toEqual([]);
  });

  it("lays the viewer out in flow beside or instead of the tree, never as an overlay", () => {
    expect(declarations(".cv-files__column--main").get("flex")).toBe("1 1 auto");
    expect(declarations(".cv-files__column--tree").get("flex")).toBe("none");
    const viewer = new Map(
      viewerRules
        .find((rule) => rule.selector === ".cv-file-viewer")
        ?.declarations.map((item) => [item.property, item.value]) ?? [],
    );
    expect(viewer.get("flex")).toBe("1 1 auto");
    expect(viewer.get("min-height")).toBe("0");
    expect(
      [...rules, ...viewerRules]
        .filter((rule) =>
          rule.declarations.some(
            (item) => item.property === "position" && /absolute|fixed/.test(item.value),
          ),
        )
        .map((rule) => rule.selector),
    ).toEqual([]);
  });

  it("puts the tree column on the viewer's end side with a start-edge divider", () => {
    expect(declarations(".cv-files__column--tree").get("width")).toBe("260px");
    expect(declarations(".cv-files__column--tree").get("box-shadow")).toBe(
      "var(--cv-edge-start-divider)",
    );
    expect(declarations(".cv-files--narrow .cv-files__column--tree").get("width")).toBe("210px");
    expect(declarations(".cv-files--tight .cv-files__column--tree").get("width")).toBe("180px");
    expect(rules.some((rule) => rule.declarations.some((item) => item.property === "order"))).toBe(
      false,
    );
  });

  it("keeps the breadcrumb separator outside the clipped crumb", () => {
    const separator = viewerDeclarations(".cv-file-viewer__crumb-separator");
    expect(separator.get("flex")).toBe("none");
    expect(separator.has("overflow")).toBe(false);
    expect(viewerRules.filter((rule) => rule.selector.includes("::after"))).toEqual([]);
    expect(viewerDeclarations(".cv-file-viewer__crumb").get("flex-shrink")).toBe("100");
    expect(viewerDeclarations(".cv-file-viewer__crumb").get("min-width")).toBe("2.5em");
    expect(viewerDeclarations(".cv-file-viewer__head").get("padding-left")).toBe(
      "var(--cv-space-4)",
    );
  });

  it("clips the viewer header so its tools never spill over the tree", () => {
    const head = viewerDeclarations(".cv-file-viewer__head");
    expect(head.get("min-width")).toBe("0");
    expect(head.get("overflow")).toBe("hidden");
    expect(viewerDeclarations(".cv-file-viewer__notice").get("flex")).toBe("none");
  });

  it("pads a dim line-number gutter away from the edge and the code", () => {
    const gutter = viewerDeclarations(".cv-file-viewer__code .highlighted-code__gutter");
    expect(gutter.get("padding")).toBe("0 var(--cv-space-6) 0 var(--cv-space-5)");
    expect(gutter.get("color")).toBe("var(--cv-fg-disabled)");
    expect(gutter.has("background")).toBe(false);
    expect(gutter.has("box-shadow")).toBe(false);
    expect(viewerDeclarations(".cv-file-viewer__code").get("--file-viewer-line-height")).toBe(
      "22px",
    );
  });

  it("keeps viewer header toggles quiet with only a subtle active state", () => {
    const pressed = viewerDeclarations(
      '.cv-file-viewer__tools .cv-icon-button[aria-pressed="true"]',
    );
    expect(pressed.get("background")).toBe("var(--cv-tint-1)");
    expect(pressed.get("color")).toBe("var(--cv-fg)");
    expect(viewerDeclarations(".cv-file-viewer__crumb").get("color")).toBe("var(--cv-fg-subtle)");
    expect(viewerDeclarations(".cv-file-viewer__crumb-current").get("color")).toBe("var(--cv-fg)");
  });

  it("keeps the tree search field borderless at rest with no shortcut chip", () => {
    const search = declarations(".cv-files__search");
    expect(search.has("border")).toBe(false);
    expect(search.has("box-shadow")).toBe(false);
    expect(search.has("background")).toBe(false);
    expect(declarations(".cv-files__search:hover").size).toBe(0);
    expect(rules.some((rule) => rule.selector.includes(".cv-kbd"))).toBe(false);
  });

  it("keeps result file names whole and only shortens the directory", () => {
    expect(declarations(".cv-files__result-name").get("flex")).toBe("none");
    expect(declarations(".cv-files__result-name").has("overflow")).toBe(false);
    expect(declarations(".cv-files__result-dir").get("text-overflow")).toBe("ellipsis");
  });

  it("never offsets the editor overlay, which belongs to the Editor surface", () => {
    expect(
      rules
        .filter((rule) => rule.selector.includes('[data-slot="editor"]'))
        .map((rule) => rule.selector),
    ).toEqual([]);
  });
});

describe("files git markers", () => {
  it("colours new files alike whether they are staged or untracked", () => {
    const added = rules.find((rule) => rule.selector.includes(".cv-files .tree-row-status-added"));
    expect(added?.selector).toContain(".cv-files .tree-row-status-untracked");
    expect(added?.declarations.find((item) => item.property === "color")?.value).toBe(
      "var(--cv-ok)",
    );
  });
});

describe("files tree typography", () => {
  const appSheet = "agentApp.css";
  const appRules = parseCssRules(readStyleSheet(appSheet).source, appSheet).rules;
  const app = (selector: string): ReadonlyMap<string, string> =>
    new Map(
      appRules
        .find((rule) => rule.selector.replace(/\s+/g, " ") === selector)
        ?.declarations.map((item) => [item.property, item.value]) ?? [],
    );

  it("sets the tree in the UI font at the sidebar thread size, not the code font", () => {
    expect(app(".file-tree").get("font-family")).toBe("var(--cv-font-ui)");
    expect(app(".file-tree").get("font-size")).toBe("var(--cv-t-sm)");
    expect(app(".tree-row").get("font")).toBe("inherit");
  });

  it("highlights rows subtly across the full width with rounded corners", () => {
    expect(app(".tree-row").get("border-radius")).toBe("var(--cv-r-control)");
    expect(app(".tree-row.active").get("background")).toBe("var(--cv-row-active)");
    expect(app(".tree-row:hover").get("background")).toBe("var(--cv-row-hover)");
    expect(app(".tree-row").get("grid-template-columns")).toBe("16px minmax(0, 1fr) auto auto");
  });
});
