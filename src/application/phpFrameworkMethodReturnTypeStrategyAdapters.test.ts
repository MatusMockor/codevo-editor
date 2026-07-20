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
    isWorkspaceCurrent: () => true,
    readPhpClassSource: vi.fn(async () => ""),
    resolvePhpClassSourcePaths: vi.fn(async () => []),
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
    await expect(
      adapter.resolveDeclaredMethodReturnType({
        callExpression: "$row->ref('users')",
        declaringClassName: "App\\Row",
        lateStaticClassName: "App\\Row",
        methodName: "ref",
        methodReturnExpressions: [],
        rawReturnType: "ActiveRow",
        resolvedReturnType: "App\\ActiveRow",
        resolveTypeReference: (typeName) => typeName,
      }),
    ).resolves.toBe("App\\ActiveRow");
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
    const types = {
      activeRowType: "App\\Generated\\ActiveRow\\UsersActiveRow",
      selectionType: "App\\Generated\\Selection\\UsersSelection",
    };
    const sources: Record<string, string> = {
      "App\\UsersRepository": `<?php
use App\\Generated\\ActiveRow\\UsersActiveRow;
use App\\Generated\\Repository\\UsersRepositoryTrait;
use App\\Generated\\Selection\\UsersSelection;
class UsersRepository { use UsersRepositoryTrait; protected string $tableName = 'users'; }`,
      [types.activeRowType]: "<?php abstract class UsersActiveRow {}",
      [types.selectionType]: "<?php abstract class UsersSelection {}",
    };
    const resolvePhpClassSourcePaths = vi.fn(async (className: string) =>
      sources[className] ? [`/${className}.php`] : [],
    );
    const adapter = createPhpFrameworkMethodReturnTypeStrategyAdapters(
      makeDeps({
        frameworkRuntime: {
          hasProvider: () => true,
          supports: (capability) => capability === "netteDatabaseSemantics",
        },
        readPhpClassSource: vi.fn(
          async (_path, className) => sources[className] ?? "",
        ),
        resolvePhpClassSourcePaths,
      }),
    );

    await expect(
      adapter.knownClassMethodReturnType({
        className: "App\\UsersRepository",
        methodName: "findBy",
      }),
    ).resolves.toBe("App\\Generated\\ActiveRow\\UsersActiveRow|null");
    expect(resolvePhpClassSourcePaths).toHaveBeenCalledWith(
      "App\\UsersRepository",
    );
  });
});
