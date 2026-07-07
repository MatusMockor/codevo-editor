import { describe, expect, it } from "vitest";
import {
  BLADE_BUILT_IN_VARIABLES,
  bladeVariableCompletionItems,
} from "./bladeVariableCompletionItems";

describe("bladeVariableCompletionItems", () => {
  it("includes built-in Blade variables with type hints", () => {
    expect(BLADE_BUILT_IN_VARIABLES.map((variable) => variable.name)).toEqual([
      "$errors",
      "$loop",
    ]);
  });

  it("filters variables by prefix and renders display type details", () => {
    const completions = bladeVariableCompletionItems(
      [
        {
          detail: "foreach item",
          name: "$invoice",
          typeHint: "Invoice",
          valueExpression: null,
          valueOffset: null,
        },
        {
          detail: "Laravel Blade variable",
          name: "$errors",
          typeHint: "ViewErrorBag",
          valueExpression: null,
          valueOffset: null,
        },
      ],
      "in",
      { replaceEnd: 7, replaceStart: 4 },
    );

    expect(completions).toEqual([
      {
        detail: "foreach item · Invoice",
        insertText: "$invoice",
        kind: "variable",
        label: "$invoice",
        replaceEnd: 7,
        replaceStart: 4,
      },
    ]);
  });
});
