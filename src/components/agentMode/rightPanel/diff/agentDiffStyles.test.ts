import { describe, expect, it } from "vitest";
import { parseCssRules, readStyleSheet } from "../../../cssContractTestSupport";

const sheet = "components/agentMode/rightPanel/diff/agentDiff.css";
const rules = parseCssRules(readStyleSheet(sheet).source, sheet).rules;

function declarations(selector: string): ReadonlyMap<string, string> {
  const rule = rules.find((candidate) => candidate.selector === selector);
  return new Map(
    rule?.declarations.map((declaration) => [declaration.property, declaration.value]) ?? [],
  );
}

describe("diff layout never clips code (B4)", () => {
  it("scrolls hunks horizontally", () => {
    expect(declarations(".cv-diff-hunk").get("overflow-x")).toBe("auto");
    expect(declarations(".cv-diff-hunk").has("overflow")).toBe(false);
  });

  it("sizes rows to their content without wrap and to the panel with wrap", () => {
    expect(declarations(".cv-diff-grid").get("width")).toBe("max-content");
    expect(declarations(".cv-diff-grid").get("min-width")).toBe("100%");
    expect(declarations('.cv-diff[data-wrap="true"] .cv-diff-code').get("white-space")).toBe(
      "pre-wrap",
    );
    expect(declarations('.cv-diff[data-wrap="true"] .cv-diff-code').get("overflow-wrap")).toBe(
      "anywhere",
    );
  });

  it("never hides overflowing code cells or file names", () => {
    for (const rule of rules) {
      if (!/cv-diff-(code|cell|grid|hunk)|cv-diff-file__name/.test(rule.selector)) continue;
      const overflow = rule.declarations.find((declaration) => declaration.property === "overflow");
      expect(overflow?.value ?? "visible", rule.selector).not.toBe("hidden");
      const textOverflow = rule.declarations.find(
        (declaration) => declaration.property === "text-overflow",
      );
      expect(textOverflow, rule.selector).toBeUndefined();
    }
  });

  it("lets a long file name wrap instead of clipping it", () => {
    expect(declarations(".cv-diff-file__name").get("overflow-wrap")).toBe("anywhere");
  });
});

describe("replacement body fills the diff surface (P1-2)", () => {
  it("turns the files column into a clipped flex column for the legacy Monaco diff", () => {
    const replacement = declarations(".cv-diff__files--replacement");
    expect(replacement.get("display")).toBe("flex");
    expect(replacement.get("flex-direction")).toBe("column");
    expect(replacement.get("min-height")).toBe("0");
    expect(replacement.get("overflow")).toBe("hidden");
  });

  it("keeps a stretching chain from the diff surface down to the files column", () => {
    expect(declarations(".cv-diff").get("flex")).toBe("1");
    expect(declarations(".cv-diff").get("min-height")).toBe("0");
    expect(declarations(".cv-diff__body").get("flex")).toBe("1");
    expect(declarations(".cv-diff__body").get("min-height")).toBe("0");
    expect(declarations(".cv-diff__files").get("flex")).toBe("1");
  });

  it("lets the legacy diff grow inside the replacement column", () => {
    const legacySheet = "components/agentMode/agentSurface.css";
    const legacy = parseCssRules(readStyleSheet(legacySheet).source, legacySheet).rules.find(
      (rule) => rule.selector === ".agent-surface-diff" && rule.context.length === 0,
    );
    const values = new Map(legacy?.declarations.map((item) => [item.property, item.value]) ?? []);
    expect(values.get("flex")).toBe("1 1 auto");
    expect(values.get("min-height")).toBe("0");
  });
});

describe("narrow diff panel (QA P2-a)", () => {
  it("makes the diff surface its own inline-size container", () => {
    expect(declarations(".cv-diff").get("container-type")).toBe("inline-size");
    expect(declarations(".cv-diff").get("container-name")).toBe("cv-diff");
  });

  it("drops the file tree below the split width before measurement settles", () => {
    const narrowTree = rules.find(
      (rule) =>
        rule.selector === ".cv-diff-tree" &&
        rule.context.includes("@container cv-diff (max-width: 519px)"),
    );
    expect(
      narrowTree?.declarations.find((declaration) => declaration.property === "display")?.value,
    ).toBe("none");
  });
});
