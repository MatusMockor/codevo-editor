import { describe, expect, it } from "vitest";
import {
  bladeComponentCompletionItems,
  bladeDirectiveCompletionItems,
} from "./bladeStaticCompletionItems";

describe("blade static completion items", () => {
  it("renders directive completions with @ labels", () => {
    expect(
      bladeDirectiveCompletionItems("if", { replaceEnd: 3, replaceStart: 1 }),
    ).toContainEqual({
      detail: "Blade directive",
      insertText: "if",
      kind: "directive",
      label: "@if",
      replaceEnd: 3,
      replaceStart: 1,
    });
  });

  it("filters component completions by prefix", () => {
    expect(
      bladeComponentCompletionItems(
        ["alert", "forms.input", "modal"],
        "fo",
        { replaceEnd: 8, replaceStart: 4 },
      ),
    ).toEqual([
      {
        detail: "Blade component",
        insertText: "forms.input",
        kind: "component",
        label: "forms.input",
        replaceEnd: 8,
        replaceStart: 4,
      },
    ]);
  });
});
