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
});

describe("hasUnclosedStringLiteral", () => {
  it("tracks escaped quotes", () => {
    expect(hasUnclosedStringLiteral(`$a = "unterminated`)).toBe(true);
    expect(hasUnclosedStringLiteral(`$a = "escaped \\" quote"`)).toBe(false);
  });
});
