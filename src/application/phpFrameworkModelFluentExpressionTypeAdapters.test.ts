import { describe, expect, it } from "vitest";
import { createPhpFrameworkModelFluentExpressionTypeAdapters } from "./phpFrameworkModelFluentExpressionTypeAdapters";

describe("phpFrameworkModelFluentExpressionTypeAdapters", () => {
  it("selects the generic adapter without Laravel", () => {
    const adapter = createPhpFrameworkModelFluentExpressionTypeAdapters(false);

    expect(
      adapter.receiverMethodCallType({
        methodName: "load",
        receiverType: "App\\Models\\Post",
      }),
    ).toBeNull();
  });

  it("selects the Laravel adapter when Laravel is active", () => {
    const adapter = createPhpFrameworkModelFluentExpressionTypeAdapters(true);

    expect(
      adapter.receiverMethodCallType({
        methodName: "load",
        receiverType: "App\\Models\\Post",
      }),
    ).toBe("App\\Models\\Post");
  });
});
