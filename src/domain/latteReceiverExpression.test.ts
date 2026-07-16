import { describe, expect, it } from "vitest";
import {
  latteExpressionLexicalStateAtEnd,
  latteReceiverMemberCompletionAt,
  latteReceiverMemberReferenceAt,
} from "./latteReceiverExpression";

describe("latteReceiverMemberCompletionAt", () => {
  it("parses method chains with balanced nested arguments and trivia", () => {
    const source = `$api ?-> getHandler(translate("a)", nested([1, 2]), /* ) */ $x)) -> sum`;

    expect(latteReceiverMemberCompletionAt(source, source.length)).toEqual({
      memberSpan: { end: source.length, start: source.length - 3 },
      prefix: "sum",
      receiverExpression:
        '$api->getHandler(translate("a)", nested([1, 2]), /* ) */ $x))',
      variableName: "api",
    });
  });

  it("parses repeated array offsets before a member", () => {
    const source = `$payments[$paymentId]["current"] -> variable_symbol`;

    expect(latteReceiverMemberCompletionAt(source, source.length)).toEqual({
      memberSpan: {
        end: source.length,
        start: source.indexOf("variable_symbol"),
      },
      prefix: "variable_symbol",
      receiverExpression: '$payments[$paymentId]["current"]',
      variableName: "payments",
    });
  });

  it("supports an incomplete final member", () => {
    expect(latteReceiverMemberCompletionAt("$payment->", 10)).toEqual({
      memberSpan: { end: 10, start: 10 },
      prefix: "",
      receiverExpression: "$payment",
      variableName: "payment",
    });
  });

  it("targets the innermost chain ending at the cursor", () => {
    const source = "$outer->map($inner->na";

    expect(latteReceiverMemberCompletionAt(source, source.length)).toMatchObject({
      prefix: "na",
      receiverExpression: "$inner",
      variableName: "inner",
    });
  });

  it("keeps malformed trailing postfix strict for completion", () => {
    const source = "$x->good()->next(";

    expect(latteReceiverMemberCompletionAt(source, source.length)).toBeNull();
  });

  it.each([
    "$service->$member",
    "$service->$member->name",
    "$service->{member}",
    "$service->call(",
    "$service[missing->name",
    "$service->name]",
    "Factory::make()->name",
    "Factory::$member->name",
    "helper()->name",
    "($service)->name",
    '"$service->name',
    "/* $service->name",
    "$service->// name",
    "$service-># name",
  ])("rejects unsupported or malformed receiver: %s", (source) => {
    expect(latteReceiverMemberCompletionAt(source, source.length)).toBeNull();
  });

  it("bounds receiver length, nesting depth, segments and candidates", () => {
    const tooManySegments = `$root${"[0]".repeat(65)}->name`;
    const tooDeep = `$root->call(${"(".repeat(17)}1${")".repeat(17)})->name`;
    const tooLong = `$root${" ".repeat(2_001)}->name`;
    const tooManyCandidates = `${Array.from(
      { length: 64 },
      (_, index) => `$v${index}`,
    ).join(";")};$last->na`;

    expect(
      latteReceiverMemberCompletionAt(tooManySegments, tooManySegments.length),
    ).toBeNull();
    expect(latteReceiverMemberCompletionAt(tooDeep, tooDeep.length)).toBeNull();
    expect(latteReceiverMemberCompletionAt(tooLong, tooLong.length)).toBeNull();
    expect(
      latteReceiverMemberCompletionAt(
        tooManyCandidates,
        tooManyCandidates.length,
      ),
    ).toBeNull();
  });
});

describe("latteReceiverMemberReferenceAt", () => {
  it("returns exact half-open spans for each method in a real chain shape", () => {
    const source = "$api->getEndpoint()->getMethod()";
    const getMethodStart = source.indexOf("getMethod");

    expect(
      latteReceiverMemberReferenceAt(source, getMethodStart + 2),
    ).toEqual({
      memberName: "getMethod",
      memberSpan: { end: getMethodStart + 9, start: getMethodStart },
      receiverExpression: "$api->getEndpoint()",
      variableName: "api",
    });
    expect(
      latteReceiverMemberReferenceAt(source, getMethodStart + 9),
    ).toBeNull();
  });

  it("targets a member on an offset receiver inside an outer call", () => {
    const source = "$presenter->open($payments[$paymentId]->user->public_name)";
    const start = source.indexOf("public_name");

    expect(latteReceiverMemberReferenceAt(source, start + 3)).toMatchObject({
      memberName: "public_name",
      receiverExpression: "$payments[$paymentId]->user",
      variableName: "payments",
    });
  });

  it("preserves completed references before a malformed trailing postfix", () => {
    const source = "$x->good()->next(";
    const goodStart = source.indexOf("good");
    const nextStart = source.indexOf("next");

    expect(latteReceiverMemberReferenceAt(source, goodStart + 1)).toEqual({
      memberName: "good",
      memberSpan: { end: goodStart + 4, start: goodStart },
      receiverExpression: "$x",
      variableName: "x",
    });
    expect(latteReceiverMemberReferenceAt(source, nextStart + 1)).toBeNull();
  });
});

describe("latteExpressionLexicalStateAtEnd", () => {
  it("ignores quotes inside comments", () => {
    expect(latteExpressionLexicalStateAtEnd('$x /* " */ -> name')).toBe(
      "code",
    );
    expect(latteExpressionLexicalStateAtEnd("$x // ' quote")).toBe(
      "comment",
    );
  });
});
