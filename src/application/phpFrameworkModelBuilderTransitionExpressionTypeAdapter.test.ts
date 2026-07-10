import { describe, expect, it, vi } from "vitest";
import { genericPhpFrameworkModelBuilderTransitionExpressionTypeAdapter } from "./phpFrameworkModelBuilderTransitionExpressionTypeAdapter";

describe("genericPhpFrameworkModelBuilderTransitionExpressionTypeAdapter", () => {
  it("is inert without invoking semantic callbacks", async () => {
    const resolveCollectionTerminalModelType = vi.fn(
      async () => "App\\Models\\CollectionTerminal",
    );
    const resolveModelFactoryModelType = vi.fn(
      async () => "App\\Models\\Factory",
    );
    const resolveBuilderTerminalModelType = vi.fn(
      async () => "App\\Models\\BuilderTerminal",
    );
    const resolveBuilderModelType = vi.fn(
      async () => "App\\Models\\Builder",
    );
    const resolveCollectionModelType = vi.fn(
      async () => "App\\Models\\Collection",
    );

    await expect(
      genericPhpFrameworkModelBuilderTransitionExpressionTypeAdapter.methodCallType(
        {
          methodName: "first",
          resolveCollectionTerminalModelType,
          resolveModelFactoryModelType,
          resolveBuilderTerminalModelType,
          resolveBuilderModelType,
          resolveCollectionModelType,
        },
      ),
    ).resolves.toBeNull();
    await expect(
      genericPhpFrameworkModelBuilderTransitionExpressionTypeAdapter.staticCallType(
        {
          className: "App\\Models\\Post",
          methodName: "query",
        },
      ),
    ).resolves.toBeNull();

    expect(resolveCollectionTerminalModelType).not.toHaveBeenCalled();
    expect(resolveModelFactoryModelType).not.toHaveBeenCalled();
    expect(resolveBuilderTerminalModelType).not.toHaveBeenCalled();
    expect(resolveBuilderModelType).not.toHaveBeenCalled();
    expect(resolveCollectionModelType).not.toHaveBeenCalled();
  });
});
