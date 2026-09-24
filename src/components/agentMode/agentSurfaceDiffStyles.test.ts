import { describe, expect, it } from "vitest";
import { parseCssRules, readStyleSheet } from "../cssContractTestSupport";

const sheet = "components/agentMode/agentSurface.css";
const rules = parseCssRules(readStyleSheet(sheet).source, sheet).rules;
const NARROW = "@container agent-surface-diff (max-width: 520px)";

function declarations(selector: string, context: string | null): ReadonlyMap<string, string> {
  const rule = rules.find(
    (candidate) =>
      candidate.selector === selector &&
      (context === null ? candidate.context.length === 0 : candidate.context.includes(context)),
  );
  return new Map(
    rule?.declarations.map((declaration) => [declaration.property, declaration.value]) ?? [],
  );
}

describe("legacy working-tree diff at narrow widths (B4)", () => {
  it("makes the diff its own inline-size container", () => {
    const root = declarations(".agent-surface-diff", null);
    expect(root.get("container-type")).toBe("inline-size");
    expect(root.get("container-name")).toBe("agent-surface-diff");
  });

  it("stacks the file list above the preview instead of squeezing two columns", () => {
    expect(declarations(".agent-surface-diff__body", NARROW).get("grid-template-columns")).toBe(
      "minmax(0, 1fr)",
    );
    expect(declarations(".agent-surface-diff__list", NARROW).has("max-height")).toBe(true);
  });
});
