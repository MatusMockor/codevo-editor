import { describe, expect, it } from "vitest";
import * as facade from "./phpFrameworkProviders";
import type { PhpFrameworkProvider } from "./phpFrameworkProviders";
import * as dispatch from "./phpFrameworkValidationDispatch";

describe("PHP framework validation dispatch", () => {
  it("preserves first-reference and ordered completion aggregation", () => {
    const position = { column: 6, lineNumber: 4 };
    const providers: readonly PhpFrameworkProvider[] = [
      { id: "inert", validation: { ruleReferenceAt: () => null } },
      {
        id: "primary",
        validation: {
          ruleCompletions: ({ prefix }) => [
            { insertText: "required", name: `${prefix}:required` },
          ],
          ruleReferenceAt: () => ({ position, prefix: "req" }),
        },
      },
      {
        id: "secondary",
        validation: {
          ruleCompletions: () => [
            { insertText: "required_if:", name: "required_if" },
          ],
          ruleReferenceAt: () => ({ position, prefix: "ignored" }),
        },
      },
    ];

    expect(
      dispatch.phpFrameworkValidationRuleReferenceAt(
        "<?php",
        position,
        providers,
      ),
    ).toEqual(
      facade.phpFrameworkValidationRuleReferenceAt(
        "<?php",
        position,
        providers,
      ),
    );
    expect(
      dispatch.phpFrameworkValidationRuleReferenceAt("", position, providers)
        ?.prefix,
    ).toBe("req");
    expect(
      dispatch.phpFrameworkValidationRuleCompletions("req", providers),
    ).toEqual(facade.phpFrameworkValidationRuleCompletions("req", providers));
    expect(
      dispatch.phpFrameworkValidationRuleCompletions("req", providers),
    ).toHaveLength(2);
    expect(
      dispatch.phpFrameworkValidationRuleReferenceAt("", position, []),
    ).toBeNull();
  });
});
