import { describe, expect, it } from "vitest";
import {
  phpNormalizeReceiverExpression,
  phpSimpleVariableName,
} from "./phpReceiverExpressions";

describe("phpReceiverExpressions", () => {
  it("normalizes PHP receiver operators without changing argument strings", () => {
    expect(
      phpNormalizeReceiverExpression(
        " Album :: query() -> whereNull('parent id') -> first() ",
      ),
    ).toBe("Album::query()->whereNull('parent id')->first()");
    expect(
      phpNormalizeReceiverExpression(
        " $user ? -> profile ?-> getName('display name') ",
      ),
    ).toBe("$user?->profile?->getName('display name')");
  });

  it("extracts simple variable receivers only", () => {
    expect(phpSimpleVariableName("$request")).toBe("request");
    expect(phpSimpleVariableName("$query->whereNull('parent_id')")).toBeNull();
    expect(phpSimpleVariableName("$user?->profile")).toBeNull();
  });
});
