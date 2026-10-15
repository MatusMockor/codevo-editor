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
