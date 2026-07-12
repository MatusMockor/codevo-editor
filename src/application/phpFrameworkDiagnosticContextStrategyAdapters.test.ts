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
  it.each([
    { activeProviderId: null, label: "generic" },
    { activeProviderId: "nette", label: "Nette" },
    { activeProviderId: "custom", label: "custom" },
  ])(
    "returns generic diagnostic behavior for $label providers",
    async ({ activeProviderId }) => {
      const frameworkRuntime = {
        hasProvider: vi.fn(
          (providerId: string) => providerId === activeProviderId,
        ),
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
    },
  );

  it("activates Laravel diagnostic behavior from provider identity", async () => {
    const frameworkRuntime = {
      hasProvider: vi.fn((providerId: string) => providerId === "laravel"),
      isLaravel: false,
      profile: "nette",
    };
    const phpClassHasLaravelDynamicWhere = vi.fn(async () => false);
    const phpClassHasLaravelLocalScope = vi.fn(async () => true);
    const resolvePhpEloquentBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const deps = makeDeps({
      frameworkRuntime,
      phpClassHasLaravelDynamicWhere,
      phpClassHasLaravelLocalScope,
      resolvePhpEloquentBuilderModelType,
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
    expect(
      adapter.ensureFrameworkSourceCollectionsLoaded("/workspace"),
    ).toBeUndefined();
    expect(deps.resolvePhpEloquentBuilderModelType).toHaveBeenCalled();
    expect(deps.phpClassHasLaravelLocalScope).toHaveBeenCalledWith(
      "App\\Models\\Post",
      "published",
    );
    expect(deps.phpClassHasLaravelDynamicWhere).toHaveBeenCalledWith(
      "App\\Models\\Post",
      "published",
    );
    expect(
      resolvePhpEloquentBuilderModelType.mock.invocationCallOrder[0],
    ).toBeLessThan(phpClassHasLaravelLocalScope.mock.invocationCallOrder[0]);
    expect(
      phpClassHasLaravelLocalScope.mock.invocationCallOrder[0],
    ).toBeLessThan(phpClassHasLaravelDynamicWhere.mock.invocationCallOrder[0]);
    expect(
      deps.ensurePhpFrameworkSourceCollectionsLoaded,
    ).toHaveBeenCalledWith("/workspace");
    expect(frameworkRuntime.hasProvider).toHaveBeenCalledWith("laravel");
    expect(frameworkRuntime.profile).toBe("nette");
  });
});
