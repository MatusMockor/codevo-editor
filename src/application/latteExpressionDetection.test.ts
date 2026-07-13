import { describe, expect, it } from "vitest";
import {
  hasUnclosedStringLiteral,
  isLatteMemberReferenceAt,
  latteExpressionCompletionTargetAt,
  latteMemberReferenceAt,
  latteVariableNameAt,
} from "./latteExpressionDetection";

function offsetAfter(source: string, needle: string): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`missing needle: ${needle}`);
  }

  return index + needle.length;
}

describe("latteExpressionCompletionTargetAt", () => {
  it("detects member completion and normalizes receiver chains", () => {
    const source = "{$invoice ?-> customer -> na}";
    const target = latteExpressionCompletionTargetAt(
      source,
      offsetAfter(source, "na"),
    );

    expect(target).toEqual({
      kind: "member",
      member: {
        end: offsetAfter(source, "na"),
        prefix: "na",
        receiverExpression: "$invoice->customer",
        start: offsetAfter(source, "na") - 2,
        variableName: "invoice",
      },
    });
  });

  it("detects filter completion but rejects logical-or", () => {
    const filterSource = "{=$name|upp}";
    expect(
      latteExpressionCompletionTargetAt(
        filterSource,
        offsetAfter(filterSource, "upp"),
      ),
    ).toMatchObject({
      filter: { prefix: "upp" },
      kind: "filter",
    });

    const logicalOrSource = "{if $left ||}";
    expect(
      latteExpressionCompletionTargetAt(
        logicalOrSource,
        offsetAfter(logicalOrSource, "||"),
      ),
    ).toBeNull();
  });

  it("detects variable completion outside member chains", () => {
    const source = "{if $inv}";
    const target = latteExpressionCompletionTargetAt(
      source,
      offsetAfter(source, "$inv"),
    );

    expect(target).toEqual({
      kind: "variable",
      variable: {
        end: offsetAfter(source, "$inv"),
        prefix: "inv",
        start: source.indexOf("$inv"),
      },
    });
  });

  it("detects member completion inside an n:if attribute value", () => {
    const source = '<span n:if="$user->isAc">x</span>';
    const target = latteExpressionCompletionTargetAt(
      source,
      offsetAfter(source, "isAc"),
    );

    expect(target).toEqual({
      kind: "member",
      member: {
        end: offsetAfter(source, "isAc"),
        prefix: "isAc",
        receiverExpression: "$user",
        start: offsetAfter(source, "isAc") - 4,
        variableName: "user",
      },
    });
  });

  it("detects variable completion inside an n:foreach attribute value", () => {
    const source = '<tr n:foreach="$ite as $item">x</tr>';
    const target = latteExpressionCompletionTargetAt(
      source,
      offsetAfter(source, "$ite"),
    );

    expect(target).toEqual({
      kind: "variable",
      variable: {
        end: offsetAfter(source, "$ite"),
        prefix: "ite",
        start: source.indexOf("$ite"),
      },
    });
  });

  it("does not offer expression completions inside an n:href attribute value", () => {
    const source = '<a n:href="Product:sh">x</a>';

    expect(
      latteExpressionCompletionTargetAt(source, offsetAfter(source, "Product")),
    ).toBeNull();
  });

  it("does not offer expression completions inside string literals", () => {
    const source = `{var $label = 'hello |upp $invoice->na'}`;

    expect(
      latteExpressionCompletionTargetAt(source, offsetAfter(source, "|upp")),
    ).toBeNull();
    expect(
      latteExpressionCompletionTargetAt(source, offsetAfter(source, "->na")),
    ).toBeNull();
  });
});

describe("latte variable and member reference detection", () => {
  it("finds the variable name under the cursor for definition navigation", () => {
    const source = "{if $invoice}";

    expect(latteVariableNameAt(source, offsetAfter(source, "$inv"))).toBe(
      "invoice",
    );
  });

  it("does not treat member names as variable references", () => {
    const source = "{$invoice->name}";

    expect(latteVariableNameAt(source, offsetAfter(source, "name"))).toBeNull();
  });

  it("finds member references for definition fallback blocking and navigation", () => {
    const source = "{$invoice->customer->name}";
    const offset = offsetAfter(source, "na");

    expect(isLatteMemberReferenceAt(source, offset)).toBe(true);
    expect(latteMemberReferenceAt(source, offset)).toEqual({
      memberName: "name",
      receiverExpression: "$invoice->customer",
      variableName: "invoice",
    });
  });

  it("does not resolve a variable through an attribute opener masked by a comment", () => {
    const source = '{* <div n:if="$cond> *} hello $world <div class="box">';

    expect(latteVariableNameAt(source, offsetAfter(source, "$wor"))).toBeNull();
  });

  it("finds the variable name inside an n:if attribute value", () => {
    const source = '<div n:if="$invoice">x</div>';

    expect(latteVariableNameAt(source, offsetAfter(source, "$inv"))).toBe(
      "invoice",
    );
  });

  it("finds member references inside an n:foreach attribute value", () => {
    const source = '<tr n:foreach="$invoice->items as $item">x</tr>';
    const offset = offsetAfter(source, "->ite");

    expect(latteMemberReferenceAt(source, offset)).toEqual({
      memberName: "items",
      receiverExpression: "$invoice",
      variableName: "invoice",
    });
  });
});

describe("hasUnclosedStringLiteral", () => {
  it("tracks escaped quotes", () => {
    expect(hasUnclosedStringLiteral(`$a = "unterminated`)).toBe(true);
    expect(hasUnclosedStringLiteral(`$a = "escaped \\" quote"`)).toBe(false);
  });
});
