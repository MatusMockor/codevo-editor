import { describe, expect, it } from "vitest";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  latteFilterCompletions,
  latteFunctionCompletionContextAt,
  latteFunctionCompletions,
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

describe("latteFunctionCompletionContextAt", () => {
  it("detects a partial function name inside a known tag expression", () => {
    const source = "{if divisi}";
    const offset = source.indexOf("divisi") + "divisi".length;

    expect(latteFunctionCompletionContextAt(source, offset)).toEqual({
      end: offset,
      prefix: "divisi",
      start: source.indexOf("divisi"),
    });
  });

  it("detects a partial function name after an operator in an expression", () => {
    const source = "{$total + mon}";
    const offset = source.indexOf("mon") + "mon".length;

    expect(latteFunctionCompletionContextAt(source, offset)).toEqual({
      end: offset,
      prefix: "mon",
      start: source.indexOf("mon"),
    });
  });

  it("ignores filter, variable, member, and static prefixes", () => {
    const filterSource = "{$total|mon}";
    const variableSource = "{if $mon}";
    const memberSource = "{$order->mon}";
    const staticSource = "{if Helpers::mon}";

    for (const source of [
      filterSource,
      variableSource,
      memberSource,
      staticSource,
    ]) {
      const offset = source.indexOf("mon") + "mon".length;

      expect(latteFunctionCompletionContextAt(source, offset)).toBeNull();
    }
  });

  it("ignores empty prefixes, strings, and positions outside expressions", () => {
    const emptySource = "{if }";
    const stringSource = "{if $label === 'mon'}";
    const htmlSource = "<p>mon</p>";

    expect(
      latteFunctionCompletionContextAt(emptySource, "{if ".length),
    ).toBeNull();
    expect(
      latteFunctionCompletionContextAt(
        stringSource,
        stringSource.indexOf("mon") + 3,
      ),
    ).toBeNull();
    expect(
      latteFunctionCompletionContextAt(htmlSource, htmlSource.indexOf("mon") + 3),
    ).toBeNull();
  });

  it("does not treat the tag name itself as a function prefix", () => {
    const source = "{foreach}";
    const offset = "{fore".length;

    expect(latteFunctionCompletionContextAt(source, offset)).toBeNull();
  });
});

describe("latteFunctionCompletions", () => {
  it("offers builtin functions and appends project functions with details", () => {
    expect(
      latteFunctionCompletions({ end: 8, prefix: "", start: 4 }, 3, [
        "money",
      ]),
    ).toEqual([
      {
        detail: "Latte function",
        insertText: "clamp",
        kind: "filter",
        label: "clamp",
        replaceEnd: 8,
        replaceStart: 4,
      },
      {
        detail: "Latte function",
        insertText: "divisibleBy",
        kind: "filter",
        label: "divisibleBy",
        replaceEnd: 8,
        replaceStart: 4,
      },
      {
        detail: "Latte function",
        insertText: "even",
        kind: "filter",
        label: "even",
        replaceEnd: 8,
        replaceStart: 4,
      },
    ]);
  });

  it("shows resolved callable signatures for project functions", () => {
    expect(
      latteFunctionCompletions({ end: 8, prefix: "mon", start: 5 }, 10, [
        {
          callable: {
            className: "App\\Latte\\AppLatteExtension",
            declaringClassName: "App\\Latte\\AppLatteExtension",
            methodName: "formatMoney",
            parameters: "float $value",
            returnType: "string",
          },
          name: "money",
        },
      ]),
    ).toEqual([
      {
        detail: "App\\Latte\\AppLatteExtension::formatMoney(float $value): string",
        insertText: "money",
        kind: "filter",
        label: "money",
        replaceEnd: 8,
        replaceStart: 5,
      },
    ]);
  });

  it("keeps the builtin detail when a project function re-registers a builtin", () => {
    expect(
      latteFunctionCompletions({ end: 6, prefix: "clamp", start: 1 }, 10, [
        "clamp",
      ]),
    ).toEqual([
      {
        detail: "Latte function",
        insertText: "clamp",
        kind: "filter",
        label: "clamp",
        replaceEnd: 6,
        replaceStart: 1,
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
