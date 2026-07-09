import { describe, expect, it, vi } from "vitest";
import {
  createPhpFrameworkDiagnosticContextStrategyAdapters,
  type PhpFrameworkDiagnosticContextStrategyAdapterDependencies,
} from "./phpFrameworkDiagnosticContextStrategyAdapters";

function makeDeps(
  overrides: Partial<PhpFrameworkDiagnosticContextStrategyAdapterDependencies> = {},
): PhpFrameworkDiagnosticContextStrategyAdapterDependencies {
  return {
    ensurePhpFrameworkSourceCollectionsLoaded: vi.fn(async () => undefined),
    frameworkRuntime: { hasProvider: vi.fn(() => true) },
    phpClassHasLaravelDynamicWhere: vi.fn(async () => false),
    phpClassHasLaravelLocalScope: vi.fn(async () => false),
    resolvePhpEloquentBuilderModelType: vi.fn(async () => null),
    ...overrides,
  };
}

describe("phpFrameworkDiagnosticContextStrategyAdapters", () => {
  it("returns generic diagnostic behavior without the Laravel provider", async () => {
    const frameworkRuntime = {
      hasProvider: vi.fn(() => false),
      isLaravel: true,
    };
    const deps = makeDeps({
      frameworkRuntime,
      phpClassHasLaravelDynamicWhere: vi.fn(async () => true),
      phpClassHasLaravelLocalScope: vi.fn(async () => true),
      resolvePhpEloquentBuilderModelType: vi.fn(
        async () => "App\\Models\\Post",
      ),
    });
    const adapter = createPhpFrameworkDiagnosticContextStrategyAdapters(deps);

    await expect(
      adapter.memberMethodExists({
        methodName: "published",
        position: { column: 22, lineNumber: 2 },
        receiverExpression: "Post::query()",
        source: "<?php\nPost::query()->published();",
      }),
    ).resolves.toBe(false);
    await expect(
      adapter.staticMethodExists({
        className: "App\\Models\\Post",
        methodName: "published",
      }),
    ).resolves.toBe(false);
    expect(
      adapter.ensureFrameworkSourceCollectionsLoaded("/workspace"),
    ).toBeUndefined();
    expect(frameworkRuntime.hasProvider).toHaveBeenCalledWith("laravel");
    expect(deps.resolvePhpEloquentBuilderModelType).not.toHaveBeenCalled();
    expect(deps.phpClassHasLaravelLocalScope).not.toHaveBeenCalled();
    expect(deps.phpClassHasLaravelDynamicWhere).not.toHaveBeenCalled();
    expect(
      deps.ensurePhpFrameworkSourceCollectionsLoaded,
    ).not.toHaveBeenCalled();
  });

  it("delegates to Laravel diagnostic behavior when the Laravel provider is active", async () => {
    const deps = makeDeps({
      frameworkRuntime: {
        hasProvider: vi.fn((providerId) => providerId === "laravel"),
      },
      phpClassHasLaravelLocalScope: vi.fn(async () => true),
      resolvePhpEloquentBuilderModelType: vi.fn(
        async () => "App\\Models\\Post",
      ),
    });
    const adapter = createPhpFrameworkDiagnosticContextStrategyAdapters(deps);

    await expect(
      adapter.memberMethodExists({
        methodName: "published",
        position: { column: 22, lineNumber: 2 },
        receiverExpression: "Post::query()",
        source: "<?php\nPost::query()->published();",
      }),
    ).resolves.toBe(true);
    expect(deps.resolvePhpEloquentBuilderModelType).toHaveBeenCalled();
    expect(deps.phpClassHasLaravelLocalScope).toHaveBeenCalledWith(
      "App\\Models\\Post",
      "published",
    );
  });
});
