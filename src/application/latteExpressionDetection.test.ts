import { describe, expect, it } from "vitest";
import {
  hasUnclosedStringLiteral,
  isLatteMemberReferenceAt,
  latteExpressionCompletionTargetAt,
  latteExpressionNavigationAt,
  latteFilterReferenceAt,
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

  it.each([
    '<label n:name="$cont[\'from\']">From</label>',
    "<label n:name='$cont[\"from\"]'>From</label>",
    "<label n:name=$cont[from]>From</label>",
  ])("detects variable completion inside a dynamic n:name value: %s", (source) => {
    const target = latteExpressionCompletionTargetAt(
      source,
      offsetAfter(source, "$cont"),
    );

    expect(target).toEqual({
      kind: "variable",
      variable: {
        end: offsetAfter(source, "$cont"),
        prefix: "cont",
        start: source.indexOf("$cont"),
      },
    });
  });

  it.each([
    '{* <label n:name="$cont[\'from\']">From</label> *}',
    '<!-- <label n:name="$cont[from]">From</label> -->',
    'example n:name="$cont[from]" in plain text',
    '<div title=\'example n:name="$cont[from]"\'>Text</div>',
    '<label n:name=$cont">From</label>',
    '<label data-n:name="$cont[\'from\']">From</label>',
    '<label n:name-extra="$cont[\'from\']">From</label>',
  ])("rejects non-attribute dynamic n:name lookalikes: %s", (source) => {
    expect(
      latteExpressionCompletionTargetAt(source, offsetAfter(source, "$cont")),
    ).toBeNull();
  });

  it.each([
    '<label n:name="field">Field</label>',
    "<label n:name='field'>Field</label>",
    "<label n:name=field>Field</label>",
  ])("keeps static n:name values out of generic completion: %s", (source) => {
    expect(
      latteExpressionCompletionTargetAt(source, offsetAfter(source, "field")),
    ).toBeNull();
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

  it("finds only the variable in a dynamic n:name array access", () => {
    const source = '<label n:name="$container[\'from\']">From</label>';

    expect(latteVariableNameAt(source, offsetAfter(source, "$cont"))).toBe(
      "container",
    );
    expect(latteVariableNameAt(source, offsetAfter(source, "from"))).toBeNull();
    expect(latteMemberReferenceAt(source, offsetAfter(source, "from"))).toBeNull();
  });

  it("finds an unquoted n:name variable at its opening dollar offset", () => {
    const source = "<label n:name=$container[from]>From</label>";

    expect(latteVariableNameAt(source, source.indexOf("$"))).toBe("container");
  });
});

describe("latte filter reference detection", () => {
  it("finds a filter name under the cursor for definition navigation", () => {
    const source = "{$createdAt|UserDate|noescape}";

    expect(latteFilterReferenceAt(source, offsetAfter(source, "User"))).toEqual({
      name: "UserDate",
    });
    expect(
      latteFilterReferenceAt(source, offsetAfter(source, "noesc")),
    ).toEqual({
      name: "noescape",
    });
  });

  it("rejects logical-or and strings when resolving filter references", () => {
    expect(latteFilterReferenceAt("{if $left || $right}", 11)).toBeNull();
    expect(
      latteFilterReferenceAt(
        `{var $label = 'created|UserDate'}`,
        offsetAfter(`{var $label = 'created|UserDate'}`, "User"),
      ),
    ).toBeNull();
  });
});

describe("latteExpressionNavigationAt", () => {
  it("returns the variable view for a variable reference", () => {
    const source = "{if $invoice}";

    expect(
      latteExpressionNavigationAt(source, offsetAfter(source, "$inv")),
    ).toEqual({ memberReference: null, variableName: "invoice" });
  });

  it("returns the member view for a member reference", () => {
    const source = "{$invoice->customer->name}";

    expect(
      latteExpressionNavigationAt(source, offsetAfter(source, "na")),
    ).toEqual({
      memberReference: {
        memberName: "name",
        receiverExpression: "$invoice->customer",
        variableName: "invoice",
      },
      variableName: null,
    });
  });

  it("returns empty views outside latte expression context", () => {
    const source = "<div>$invoice</div>";

    expect(
      latteExpressionNavigationAt(source, offsetAfter(source, "$inv")),
    ).toEqual({ memberReference: null, variableName: null });
  });

  it("returns the member view inside an n:foreach attribute value", () => {
    const source = '<tr n:foreach="$invoice->items as $item">x</tr>';

    expect(
      latteExpressionNavigationAt(source, offsetAfter(source, "->ite")),
    ).toEqual({
      memberReference: {
        memberName: "items",
        receiverExpression: "$invoice",
        variableName: "invoice",
      },
      variableName: null,
    });
  });
});

describe("hasUnclosedStringLiteral", () => {
  it("tracks escaped quotes", () => {
    expect(hasUnclosedStringLiteral(`$a = "unterminated`)).toBe(true);
    expect(hasUnclosedStringLiteral(`$a = "escaped \\" quote"`)).toBe(false);
  });
});
