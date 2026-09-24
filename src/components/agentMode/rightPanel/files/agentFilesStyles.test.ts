import { describe, expect, it } from "vitest";
import { parseCssRules, readStyleSheet } from "../../../cssContractTestSupport";

const sheet = "components/agentMode/rightPanel/files/agentFiles.css";
const rules = parseCssRules(readStyleSheet(sheet).source, sheet).rules;

function declarations(selector: string): ReadonlyMap<string, string> {
  const rule = rules.find((candidate) => candidate.selector.replace(/\s+/g, " ") === selector);
  return new Map(
    rule?.declarations.map((declaration) => [declaration.property, declaration.value]) ?? [],
  );
}

describe("files surface layout", () => {
  it("scrolls the crumb path instead of clipping it", () => {
    expect(declarations(".cv-files__crumb-path").get("overflow-x")).toBe("auto");
    expect(declarations(".cv-files__crumbs").has("overflow")).toBe(false);
    expect(declarations(".cv-files__crumbs").has("text-overflow")).toBe(false);
  });

  it("keeps result file names whole and only shortens the directory", () => {
    expect(declarations(".cv-files__result-name").get("flex")).toBe("none");
    expect(declarations(".cv-files__result-name").has("overflow")).toBe(false);
    expect(declarations(".cv-files__result-dir").get("text-overflow")).toBe("ellipsis");
  });

  it("pushes the editor overlay below the search row and the crumbs", () => {
    const frame = '.workbench-frame[data-layout="agent"]';
    const editor = '> [data-slot="editor"]';
    const sub = '[data-slot="surface"] .cv-files__sub';
    const crumbs = '[data-slot="surface"] .cv-files__crumbs';
    expect(
      declarations(`${frame}:has(> ${sub}) ${editor}`).get("--agent-surface-header-height"),
    ).toBe("calc(var(--cv-topbar-h) + 40px)");
    expect(
      declarations(`${frame}:has(> ${crumbs}) ${editor}`).get("--agent-surface-header-height"),
    ).toBe("calc(var(--cv-topbar-h) + 36px)");
    expect(
      declarations(`${frame}:has(> ${sub}):has( > ${crumbs} ) ${editor}`).get(
        "--agent-surface-header-height",
      ),
    ).toBe("calc(var(--cv-topbar-h) + 76px)");
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
