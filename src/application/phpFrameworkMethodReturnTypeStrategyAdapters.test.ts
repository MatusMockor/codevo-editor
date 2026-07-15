import { describe, expect, it, vi } from "vitest";
import {
  createPhpFrameworkMethodReturnTypeStrategyAdapters,
  type PhpFrameworkMethodReturnTypeStrategyAdapterDependencies,
} from "./phpFrameworkMethodReturnTypeStrategyAdapters";

function makeDeps(
  overrides: Partial<PhpFrameworkMethodReturnTypeStrategyAdapterDependencies> = {},
): PhpFrameworkMethodReturnTypeStrategyAdapterDependencies {
  return {
    frameworkRuntime: {
      hasProvider: (providerId) => providerId === "laravel",
      supports: (capability) => capability === "eloquentModelSemantics",
    },
    netteDatabaseTypeResolver: {
      resolveClassTypes: vi.fn(async () => null),
      resolveTableType: vi.fn(async () => null),
    },
    resolvePhpFrameworkBuilderModelType: vi.fn(
      async () => null as string | null,
    ),
    resolvePhpFrameworkProjectMorphMapModelType: vi.fn(
      async () => null as string | null,
    ),
    ...overrides,
  };
}

describe("phpFrameworkMethodReturnTypeStrategyAdapters", () => {
  it("returns generic return-type strategy without the Laravel provider", async () => {
    const resolvePhpFrameworkBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const resolvePhpFrameworkProjectMorphMapModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const frameworkRuntime = {
      hasProvider: vi.fn((_providerId: string) => false),
      supports: vi.fn((_capability: string) => false),
    };
    const adapter = createPhpFrameworkMethodReturnTypeStrategyAdapters(
      makeDeps({
        frameworkRuntime,
        resolvePhpFrameworkBuilderModelType,
        resolvePhpFrameworkProjectMorphMapModelType,
      }),
    );

    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "eloquentModelSemantics",
    );
    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "netteDatabaseSemantics",
    );
    expect(frameworkRuntime.hasProvider).not.toHaveBeenCalled();
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
    expect(resolvePhpFrameworkBuilderModelType).not.toHaveBeenCalled();
    expect(resolvePhpFrameworkProjectMorphMapModelType).not.toHaveBeenCalled();
  });

  it("keeps a Laravel profile without the Laravel provider generic", async () => {
    const resolvePhpFrameworkProjectMorphMapModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const frameworkRuntime = {
      hasProvider: vi.fn((_providerId: string) => false),
      supports: vi.fn((_capability: string) => false),
      isLaravel: true,
      profile: "laravel" as const,
    };
    const adapter = createPhpFrameworkMethodReturnTypeStrategyAdapters(
      makeDeps({
        frameworkRuntime,
        resolvePhpFrameworkProjectMorphMapModelType,
      }),
    );

    await expect(
      adapter.declaredReturnTypeOverride({
        methodReturnExpressions: ["$this->morphTo()"],
        returnType: "MorphTo",
      }),
    ).resolves.toBeNull();
    expect(resolvePhpFrameworkProjectMorphMapModelType).not.toHaveBeenCalled();
  });

  it("delegates to the Laravel strategy when Eloquent model semantics are active", async () => {
    const resolvePhpFrameworkProjectMorphMapModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const adapter = createPhpFrameworkMethodReturnTypeStrategyAdapters(
      makeDeps({
        frameworkRuntime: {
          hasProvider: (providerId: string) => providerId === "laravel",
          supports: (capability) => capability === "eloquentModelSemantics",
        },
        resolvePhpFrameworkProjectMorphMapModelType,
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

  it("delegates concrete repository returns to the Nette database strategy", async () => {
    const netteDatabaseTypeResolver = {
      resolveClassTypes: vi.fn(async () => ({
        activeRowType: "App\\Generated\\ActiveRow\\UsersActiveRow",
        selectionType: "App\\Generated\\Selection\\UsersSelection",
      })),
      resolveTableType: vi.fn(async () => null),
    };
    const adapter = createPhpFrameworkMethodReturnTypeStrategyAdapters(
      makeDeps({
        frameworkRuntime: {
          hasProvider: () => true,
          supports: (capability) => capability === "netteDatabaseSemantics",
        },
        netteDatabaseTypeResolver,
      }),
    );

    await expect(
      adapter.knownClassMethodReturnType({
        className: "App\\UsersRepository",
        methodName: "findBy",
      }),
    ).resolves.toBe("App\\Generated\\ActiveRow\\UsersActiveRow|null");
    expect(netteDatabaseTypeResolver.resolveClassTypes).toHaveBeenCalledWith(
      "App\\UsersRepository",
    );
  });
});
