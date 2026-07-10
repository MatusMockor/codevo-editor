import { describe, expect, it, vi } from "vitest";
import { phpFrameworkBuilderMagicExpressionTypeAdapters } from "./phpFrameworkBuilderMagicExpressionTypeAdapters";

describe("phpFrameworkBuilderMagicExpressionTypeAdapters", () => {
  it("selects an inert generic adapter without invoking predicates", async () => {
    const phpClassHasLaravelDynamicWhere = vi.fn(async () => true);
    const phpClassHasLaravelLocalScope = vi.fn(async () => true);
    const resolveBuilderModelType = vi.fn(async () => "App\\Models\\Post");
    const resolveReceiverModelTypeCandidate = vi.fn(
      async () => "App\\Models\\Post",
    );
    const adapter = phpFrameworkBuilderMagicExpressionTypeAdapters(false, {
      phpClassHasLaravelDynamicWhere,
      phpClassHasLaravelLocalScope,
    });

    await expect(
      adapter.methodCallType({
        methodName: "published",
        resolveBuilderModelType,
        resolveReceiverModelTypeCandidate,
      }),
    ).resolves.toBeNull();
    await expect(
      adapter.staticCallType({
        className: "App\\Models\\Post",
        methodName: "published",
      }),
    ).resolves.toBeNull();

    expect(resolveBuilderModelType).not.toHaveBeenCalled();
    expect(resolveReceiverModelTypeCandidate).not.toHaveBeenCalled();
    expect(phpClassHasLaravelLocalScope).not.toHaveBeenCalled();
    expect(phpClassHasLaravelDynamicWhere).not.toHaveBeenCalled();
  });

  it("selects the Laravel adapter when enabled", async () => {
    const phpClassHasLaravelLocalScope = vi.fn(async () => true);
    const adapter = phpFrameworkBuilderMagicExpressionTypeAdapters(true, {
      phpClassHasLaravelDynamicWhere: vi.fn(async () => false),
      phpClassHasLaravelLocalScope,
    });

    await expect(
      adapter.staticCallType({
        className: "App\\Models\\Post",
        methodName: "published",
      }),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
    expect(phpClassHasLaravelLocalScope).toHaveBeenCalledWith(
      "App\\Models\\Post",
      "published",
    );
  });
});
