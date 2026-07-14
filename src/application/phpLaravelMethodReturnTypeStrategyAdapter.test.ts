import { describe, expect, it, vi } from "vitest";
import {
  createPhpLaravelMethodReturnTypeStrategyAdapter,
  type PhpLaravelMethodReturnTypeStrategyAdapterDependencies,
} from "./phpLaravelMethodReturnTypeStrategyAdapter";

function makeAdapter(
  overrides: Partial<PhpLaravelMethodReturnTypeStrategyAdapterDependencies> = {},
) {
  return createPhpLaravelMethodReturnTypeStrategyAdapter({
    resolvePhpEloquentBuilderModelType: vi.fn(
      async () => null as string | null,
    ),
    resolvePhpFrameworkProjectMorphMapModelType: vi.fn(
      async () => null as string | null,
    ),
    ...overrides,
  });
}

describe("phpLaravelMethodReturnTypeStrategyAdapter", () => {
  it("maps Laravel facades to their target classes", () => {
    const adapter = makeAdapter();

    expect(
      adapter.facadeTargetClassName("\\Illuminate\\Support\\Facades\\Cache"),
    ).toBe("Illuminate\\Cache\\CacheManager");
    expect(adapter.facadeTargetClassName("App\\Support\\Cache")).toBeNull();
  });

  it("uses the project morph map for declared MorphTo methods returning morphTo", async () => {
    const resolvePhpFrameworkProjectMorphMapModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const adapter = makeAdapter({ resolvePhpFrameworkProjectMorphMapModelType });

    await expect(
      adapter.declaredReturnTypeOverride({
        methodReturnExpressions: ["$this->morphTo()"],
        returnType: "\\Illuminate\\Database\\Eloquent\\Relations\\MorphTo",
      }),
    ).resolves.toBe(
      "Illuminate\\Database\\Eloquent\\Relations\\MorphTo<App\\Models\\Post>",
    );
    expect(resolvePhpFrameworkProjectMorphMapModelType).toHaveBeenCalledTimes(1);
  });

  it("uses the project morph map for morphTo method-call expressions", async () => {
    const resolvePhpFrameworkProjectMorphMapModelType = vi.fn(
      async () => "App\\Models\\Video",
    );
    const adapter = makeAdapter({ resolvePhpFrameworkProjectMorphMapModelType });

    await expect(
      adapter.methodCallReturnType({
        methodName: "morphTo",
        ownerSource: "<?php\n",
        receiverExpression: "$this",
        receiverType: "App\\Models\\Comment",
      }),
    ).resolves.toBe(
      "Illuminate\\Database\\Eloquent\\Relations\\MorphTo<App\\Models\\Video>",
    );
    expect(resolvePhpFrameworkProjectMorphMapModelType).toHaveBeenCalledTimes(1);
  });

  it("resolves Eloquent builder terminal methods through the builder model resolver", async () => {
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const adapter = makeAdapter({ resolvePhpEloquentBuilderModelType });

    await expect(
      adapter.methodCallReturnType({
        methodName: "first",
        ownerSource: "<?php\n$query->first();",
        receiverExpression: "$query",
        receiverType: "Illuminate\\Database\\Eloquent\\Builder",
      }),
    ).resolves.toBe("App\\Models\\Post");
    expect(resolvePhpEloquentBuilderModelType).toHaveBeenCalledWith(
      "<?php\n$query->first();",
      { column: 1, lineNumber: 1 },
      "$query",
    );
  });

  it("returns the class name for static terminal methods", () => {
    const adapter = makeAdapter();

    expect(
      adapter.staticCallReturnType({
        className: "App\\Models\\Post",
        methodName: "findOrFail",
      }),
    ).toBe("App\\Models\\Post");
    expect(
      adapter.staticCallReturnType({
        className: null,
        methodName: "findOrFail",
      }),
    ).toBeNull();
  });
});
