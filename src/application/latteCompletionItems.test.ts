import { describe, expect, it } from "vitest";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  latteFilterCompletions,
  latteMemberCompletionItem,
  latteTagCompletions,
} from "./latteCompletionItems";

function method(
  overrides: Partial<PhpMethodCompletion> = {},
): PhpMethodCompletion {
  return {
    declaringClassName: "App\\Model\\Invoice",
    name: "total",
    parameters: "",
    returnType: "Money",
    ...overrides,
  };
}

describe("latteTagCompletions", () => {
  it("filters tags by prefix, caps results and preserves replacement range", () => {
    expect(latteTagCompletions("fo", 10, 14, 2)).toEqual([
      {
        detail: "Latte tag",
        insertText: "foreach",
        kind: "tag",
        label: "foreach",
        replaceEnd: 14,
        replaceStart: 11,
      },
      {
        detail: "Latte tag",
        insertText: "for",
        kind: "tag",
        label: "for",
        replaceEnd: 14,
        replaceStart: 11,
      },
    ]);
  });
});

describe("latteFilterCompletions", () => {
  it("appends project filter names after builtins with a distinct detail", () => {
    expect(
      latteFilterCompletions(
        {
          end: 23,
          prefix: "user",
          start: 19,
        },
        10,
        ["gravatar", "userDate"],
      ),
    ).toEqual([
      {
        detail: "Project Latte filter",
        insertText: "userDate",
        kind: "filter",
        label: "userDate",
        replaceEnd: 23,
        replaceStart: 19,
      },
    ]);
  });

  it("keeps the builtin detail when a project filter re-registers a builtin name", () => {
    const completions = latteFilterCompletions(
      {
        end: 5,
        prefix: "date",
        start: 1,
      },
      10,
      ["date"],
    );

    expect(completions).toEqual([
      {
        detail: "Latte filter",
        insertText: "date",
        kind: "filter",
        label: "date",
        replaceEnd: 5,
        replaceStart: 1,
      },
    ]);
  });

  it("shows resolved callable signatures for project filters", () => {
    expect(
      latteFilterCompletions(
        { end: 8, prefix: "pri", start: 5 },
        10,
        [
          {
            callable: {
              className: "App\\Helpers\\PriceHelper",
              declaringClassName: "App\\Helpers\\PriceHelper",
              methodName: "process",
              parameters: "float $price, ?string $currency = null",
              returnType: "string",
            },
            name: "price",
          },
        ],
      ),
    ).toEqual([
      {
        detail:
          "App\\Helpers\\PriceHelper::process(float $price, ?string $currency = null): string",
        insertText: "price",
        kind: "filter",
        label: "price",
        replaceEnd: 8,
        replaceStart: 5,
      },
    ]);
  });

  it("filters filters by prefix, caps results and preserves replacement range", () => {
    expect(
      latteFilterCompletions(
        {
          end: 21,
          prefix: "lo",
          start: 19,
        },
        1,
      ),
    ).toEqual([
      {
        detail: "Latte filter",
        insertText: "localDate",
        kind: "filter",
        label: "localDate",
        replaceEnd: 21,
        replaceStart: 19,
      },
    ]);
  });
});

describe("latteMemberCompletionItem", () => {
  it("formats method completions with parameters and return type", () => {
    expect(
      latteMemberCompletionItem(
        method({ name: "calculate", parameters: "int $precision" }),
        4,
        8,
      ),
    ).toEqual({
      detail: "App\\Model\\Invoice::calculate(int $precision): Money",
      insertText: "calculate()",
      kind: "member",
      label: "calculate",
      replaceEnd: 8,
      replaceStart: 4,
    });
  });

  it("uses explicit insert text when provided", () => {
    expect(
      latteMemberCompletionItem(
        method({ insertText: "calculate(${1:$precision})", name: "calculate" }),
        4,
        8,
      ).insertText,
    ).toBe("calculate(${1:$precision})");
  });

  it("formats properties and relations without adding call parentheses", () => {
    expect(
      latteMemberCompletionItem(
        method({ kind: "property", name: "number", returnType: "string" }),
        1,
        6,
      ),
    ).toMatchObject({
      detail: "App\\Model\\Invoice::number: string",
      insertText: "number",
      kind: "member",
      label: "number",
    });
    expect(
      latteMemberCompletionItem(
        method({ kind: "relation", name: "items", returnType: "Collection" }),
        1,
        6,
      ),
    ).toMatchObject({
      detail: "App\\Model\\Invoice::items: Collection",
      insertText: "items",
    });
  });
});
