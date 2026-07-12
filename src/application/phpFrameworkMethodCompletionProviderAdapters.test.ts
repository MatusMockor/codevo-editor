import { describe, expect, it, vi } from "vitest";
import {
  createPhpFrameworkMethodCompletionProviderAdapters,
  type PhpFrameworkMethodCompletionProviderAdapterDependencies,
} from "./phpFrameworkMethodCompletionProviderAdapters";

function makeDeps(
  overrides: Partial<PhpFrameworkMethodCompletionProviderAdapterDependencies> = {},
): PhpFrameworkMethodCompletionProviderAdapterDependencies {
  return {
    collectPhpLaravelRelationCompletionsForClass: vi.fn(async () => []),
    collectPhpMethodsForClass: vi.fn(async () => []),
    ensurePhpFrameworkSourceCollectionsLoaded: vi.fn(async () => undefined),
    frameworkRuntime: { hasProvider: () => true },
    resolvePhpClassReference: vi.fn(() => null),
    resolvePhpEloquentBuilderModelType: vi.fn(async () => null),
    resolvePhpExpressionType: vi.fn(async () => null),
    resolvePhpLaravelRelationPathOwnerType: vi.fn(async () => null),
    ...overrides,
  };
}

describe("phpFrameworkMethodCompletionProviderAdapters", () => {
  it.each([
    { activeProviderId: null, label: "generic" },
    { activeProviderId: "nette", label: "Nette" },
    { activeProviderId: "custom", label: "custom" },
  ])("keeps $label providers inert", async ({ activeProviderId }) => {
    const ensurePhpFrameworkSourceCollectionsLoaded = vi.fn(
      async () => undefined,
    );
    const frameworkRuntime = {
      hasProvider: vi.fn(
        (providerId: string) => providerId === activeProviderId,
      ),
      isLaravel: true,
    };
    const adapter = createPhpFrameworkMethodCompletionProviderAdapters(
      makeDeps({
        ensurePhpFrameworkSourceCollectionsLoaded,
        frameworkRuntime,
      }),
    );
    const request = {
      isRequestStillCurrent: () => true,
      position: { column: 1, lineNumber: 1 },
      source: "<?php",
    };

    await expect(adapter.routeActionCompletions(request)).resolves.toBeNull();
    await expect(adapter.relationStringCompletions(request)).resolves.toBeNull();
    adapter.ensureSourceCollectionsLoadedForAccess({
      accessContext: {
        prefix: "",
        receiverExpression: "$post",
        variableName: "$post",
      },
      rootPath: "/workspace",
      staticAccessContext: null,
    });

    expect(frameworkRuntime.hasProvider).toHaveBeenCalledWith("laravel");
    expect(ensurePhpFrameworkSourceCollectionsLoaded).not.toHaveBeenCalled();
  });

  it("selects the Laravel adapter by provider id", async () => {
    const frameworkRuntime = {
      hasProvider: vi.fn((providerId: string) => providerId === "laravel"),
    };
    const adapter = createPhpFrameworkMethodCompletionProviderAdapters(
      makeDeps({ frameworkRuntime }),
    );
    const source = "<?php\nRoute::get('/posts', [Missing::class, 'in']);";
    const prefixOffset = source.indexOf("'in") + "'in".length;
    const prefixSource = source.slice(0, prefixOffset);
    const prefixLines = prefixSource.split("\n");

    await expect(
      adapter.routeActionCompletions({
        isRequestStillCurrent: () => true,
        position: {
          column: (prefixLines[prefixLines.length - 1]?.length ?? 0) + 1,
          lineNumber: prefixLines.length,
        },
        source,
      }),
    ).resolves.toEqual([]);
    expect(frameworkRuntime.hasProvider).toHaveBeenCalledWith("laravel");
  });
});
