import { describe, expect, it } from "vitest";
import { parseAllStyleSheets, selectorParts } from "../cssContractTestSupport";

const THREAD_SHEET = "components/agentMode/agentThread.css";
const PROGRAMMATIC_FOCUS_TARGETS = [
  ".agent-session__scroll:focus-visible",
  ".agent-queued-list:focus-visible",
] as const;

const rules = parseAllStyleSheets().rules.filter(
  (rule) => rule.sheet === THREAD_SHEET && rule.context.length === 0,
);

function declarationsFor(selector: string): ReadonlyArray<{ property: string; value: string }> {
  return rules
    .filter((rule) => selectorParts(rule.selector).includes(selector))
    .flatMap((rule) => rule.declarations);
}

describe("agent session programmatic focus targets", () => {
  it.each(PROGRAMMATIC_FOCUS_TARGETS)("suppresses the global focus ring on %s", (selector) => {
    const shadows = declarationsFor(selector).filter(
      (declaration) => declaration.property === "box-shadow",
    );

    expect(shadows.map((declaration) => declaration.value)).toEqual(["none"]);
  });
});
