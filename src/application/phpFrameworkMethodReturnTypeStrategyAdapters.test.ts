import { describe, expect, it, vi } from "vitest";
import {
  createPhpFrameworkMethodReturnTypeStrategyAdapters,
  type PhpFrameworkMethodReturnTypeStrategyAdapterDependencies,
} from "./phpFrameworkMethodReturnTypeStrategyAdapters";

function makeDeps(
  overrides: Partial<PhpFrameworkMethodReturnTypeStrategyAdapterDependencies> = {},
): PhpFrameworkMethodReturnTypeStrategyAdapterDependencies {
  return {
    frameworkRuntime: { hasProvider: (providerId) => providerId === "laravel" },
    resolvePhpEloquentBuilderModelType: vi.fn(
      async () => null as string | null,
    ),
    resolvePhpLaravelProjectMorphMapModelType: vi.fn(
      async () => null as string | null,
    ),
    ...overrides,
  };
}

describe("phpFrameworkMethodReturnTypeStrategyAdapters", () => {
  it("returns generic return-type strategy without the Laravel provider", async () => {
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const resolvePhpLaravelProjectMorphMapModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const frameworkRuntime = {
      hasProvider: vi.fn((_providerId: string) => false),
    };
    const adapter = createPhpFrameworkMethodReturnTypeStrategyAdapters(
      makeDeps({
        frameworkRuntime,
        resolvePhpEloquentBuilderModelType,
        resolvePhpLaravelProjectMorphMapModelType,
      }),
    );

    expect(frameworkRuntime.hasProvider).toHaveBeenCalledWith("laravel");
    expect(
      adapter.facadeTargetClassName("Illuminate\\Support\\Facades\\Cache"),
    ).toBeNull();
    await expect(
      adapter.methodCallReturnType({
        methodName: "first",
        ownerSource: "<?php\n$query->first();",
        receiverExpression: "$query",
        receiverType: "Illuminate\\Database\\Eloquent\\Builder",
      }),
    ).resolves.toBeNull();
    await expect(
      adapter.declaredReturnTypeOverride({
        methodReturnExpressions: ["$this->morphTo()"],
        returnType: "MorphTo",
      }),
    ).resolves.toBeNull();
    expect(
      adapter.staticCallReturnType({
        className: "App\\Models\\Post",
        methodName: "findOrFail",
      }),
    ).toBeNull();
    expect(resolvePhpEloquentBuilderModelType).not.toHaveBeenCalled();
    expect(resolvePhpLaravelProjectMorphMapModelType).not.toHaveBeenCalled();
  });

  it("keeps a Laravel profile without the Laravel provider generic", async () => {
    const resolvePhpLaravelProjectMorphMapModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const frameworkRuntime = {
      hasProvider: vi.fn((_providerId: string) => false),
      isLaravel: true,
      profile: "laravel" as const,
    };
    const adapter = createPhpFrameworkMethodReturnTypeStrategyAdapters(
      makeDeps({
        frameworkRuntime,
        resolvePhpLaravelProjectMorphMapModelType,
      }),
    );

    await expect(
      adapter.declaredReturnTypeOverride({
        methodReturnExpressions: ["$this->morphTo()"],
        returnType: "MorphTo",
      }),
    ).resolves.toBeNull();
    expect(resolvePhpLaravelProjectMorphMapModelType).not.toHaveBeenCalled();
  });

  it("delegates to the Laravel strategy when the Laravel provider is active", async () => {
    const resolvePhpLaravelProjectMorphMapModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const adapter = createPhpFrameworkMethodReturnTypeStrategyAdapters(
      makeDeps({
        frameworkRuntime: {
          hasProvider: (providerId: string) => providerId === "laravel",
        },
        resolvePhpLaravelProjectMorphMapModelType,
      }),
    );

    expect(
      adapter.facadeTargetClassName("Illuminate\\Support\\Facades\\Cache"),
    ).toBe("Illuminate\\Cache\\CacheManager");
    await expect(
      adapter.declaredReturnTypeOverride({
        methodReturnExpressions: ["$this->morphTo()"],
        returnType: "MorphTo",
      }),
    ).resolves.toBe(
      "Illuminate\\Database\\Eloquent\\Relations\\MorphTo<App\\Models\\Post>",
    );
  });
});
