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
    frameworkRuntime: {
      hasProvider: vi.fn(() => true),
      supports: vi.fn(() => true),
    },
    phpClassHasDynamicBuilderFinder: vi.fn(async () => false),
    phpClassHasNamedBuilderScope: vi.fn(async () => false),
    resolvePhpFrameworkBuilderModelType: vi.fn(async () => null),
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
        supports: vi.fn((_capability: string) => false),
      };
      const deps = makeDeps({
        frameworkRuntime,
        phpClassHasDynamicBuilderFinder: vi.fn(async () => true),
        phpClassHasNamedBuilderScope: vi.fn(async () => true),
        resolvePhpFrameworkBuilderModelType: vi.fn(
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
      expect(frameworkRuntime.supports).toHaveBeenCalledWith(
        "eloquentModelSemantics",
      );
      expect(frameworkRuntime.hasProvider).not.toHaveBeenCalled();
      expect(deps.resolvePhpFrameworkBuilderModelType).not.toHaveBeenCalled();
      expect(deps.phpClassHasNamedBuilderScope).not.toHaveBeenCalled();
      expect(deps.phpClassHasDynamicBuilderFinder).not.toHaveBeenCalled();
      expect(
        deps.ensurePhpFrameworkSourceCollectionsLoaded,
      ).not.toHaveBeenCalled();
    },
  );

  it("activates Laravel diagnostic behavior from Eloquent model semantics", async () => {
    const frameworkRuntime = {
      hasProvider: vi.fn((providerId: string) => providerId === "laravel"),
      supports: vi.fn((capability: string) =>
        capability === "eloquentModelSemantics"
      ),
      profile: "nette",
    };
    const phpClassHasDynamicBuilderFinder = vi.fn(async () => false);
    const phpClassHasNamedBuilderScope = vi.fn(async () => true);
    const resolvePhpFrameworkBuilderModelType = vi.fn(
      async () => "App\\Models\\Post",
    );
    const deps = makeDeps({
      frameworkRuntime,
      phpClassHasDynamicBuilderFinder,
      phpClassHasNamedBuilderScope,
      resolvePhpFrameworkBuilderModelType,
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
    expect(deps.resolvePhpFrameworkBuilderModelType).toHaveBeenCalled();
    expect(deps.phpClassHasNamedBuilderScope).toHaveBeenCalledWith(
      "App\\Models\\Post",
      "published",
    );
    expect(deps.phpClassHasDynamicBuilderFinder).toHaveBeenCalledWith(
      "App\\Models\\Post",
      "published",
    );
    expect(
      resolvePhpFrameworkBuilderModelType.mock.invocationCallOrder[0],
    ).toBeLessThan(phpClassHasNamedBuilderScope.mock.invocationCallOrder[0]);
    expect(
      phpClassHasNamedBuilderScope.mock.invocationCallOrder[0],
    ).toBeLessThan(phpClassHasDynamicBuilderFinder.mock.invocationCallOrder[0]);
    expect(
      deps.ensurePhpFrameworkSourceCollectionsLoaded,
    ).toHaveBeenCalledWith("/workspace");
    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "eloquentModelSemantics",
    );
    expect(frameworkRuntime.hasProvider).not.toHaveBeenCalled();
    expect(frameworkRuntime.profile).toBe("nette");
  });
});
