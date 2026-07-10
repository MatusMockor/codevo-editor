import { describe, expect, it, vi } from "vitest";
import { createPhpFrameworkModelBuilderTransitionExpressionTypeAdapters } from "./phpFrameworkModelBuilderTransitionExpressionTypeAdapters";

describe("createPhpFrameworkModelBuilderTransitionExpressionTypeAdapters", () => {
  it("selects an inert generic adapter", async () => {
    const resolveCollectionTerminalModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const adapter =
      createPhpFrameworkModelBuilderTransitionExpressionTypeAdapters(false);

    await expect(
      adapter.methodCallType({
        methodName: "first",
        resolveCollectionTerminalModelType,
        resolveModelFactoryModelType: vi.fn(async () => null),
        resolveBuilderTerminalModelType: vi.fn(async () => null),
        resolveBuilderModelType: vi.fn(async () => null),
        resolveCollectionModelType: vi.fn(async () => null),
      }),
    ).resolves.toBeNull();
    expect(resolveCollectionTerminalModelType).not.toHaveBeenCalled();
  });

  it("selects the Laravel adapter when enabled", async () => {
    const resolveCollectionTerminalModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const adapter =
      createPhpFrameworkModelBuilderTransitionExpressionTypeAdapters(true);

    await expect(
      adapter.methodCallType({
        methodName: "first",
        resolveCollectionTerminalModelType,
        resolveModelFactoryModelType: vi.fn(async () => null),
        resolveBuilderTerminalModelType: vi.fn(async () => null),
        resolveBuilderModelType: vi.fn(async () => null),
        resolveCollectionModelType: vi.fn(async () => null),
      }),
    ).resolves.toBe("App\\Models\\Post");
    expect(resolveCollectionTerminalModelType).toHaveBeenCalledOnce();
  });
});
