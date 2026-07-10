import { describe, expect, it } from "vitest";
import { phpLaravelModelFluentExpressionTypeAdapter } from "./phpLaravelModelFluentExpressionTypeAdapter";

describe("phpLaravelModelFluentExpressionTypeAdapter", () => {
  it.each(["load", "LOAD"])(
    "returns the exact receiver type for the %s model fluent method",
    (methodName) => {
      expect(
        phpLaravelModelFluentExpressionTypeAdapter.receiverMethodCallType({
          methodName,
          receiverType: "App\\Models\\Post",
        }),
      ).toBe("App\\Models\\Post");
    },
  );

  it("returns null for an absent receiver", () => {
    expect(
      phpLaravelModelFluentExpressionTypeAdapter.receiverMethodCallType({
        methodName: "load",
        receiverType: null,
      }),
    ).toBeNull();
  });

  it("returns null for a non-fluent method", () => {
    expect(
      phpLaravelModelFluentExpressionTypeAdapter.receiverMethodCallType({
        methodName: "save",
        receiverType: "App\\Models\\Post",
      }),
    ).toBeNull();
  });
});
