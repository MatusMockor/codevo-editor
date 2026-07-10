import { describe, expect, it, vi } from "vitest";
import {
  createPhpFrameworkContextualMemberDefinitionNavigationAdapters,
  type PhpFrameworkContextualMemberDefinitionNavigationAdaptersOptions,
} from "./phpFrameworkContextualMemberDefinitionNavigationAdapters";

function makeLaravelDependencies() {
  return {
    openDirectPhpMethodTarget: vi.fn(async () => false),
    openPhpLaravelDynamicWhereTarget: vi.fn(async () => false),
    resolvePhpEloquentBuilderModelType: vi.fn(async () => null),
    resolvePhpExpressionType: vi.fn(async () => null),
    resolvePhpLaravelRelationPathOwnerType: vi.fn(async () => null),
  } satisfies NonNullable<
    PhpFrameworkContextualMemberDefinitionNavigationAdaptersOptions["laravelDependencies"]
  >;
}

describe("phpFrameworkContextualMemberDefinitionNavigationAdapters", () => {
  it("returns an inert generic adapter without resolving Laravel targets", async () => {
    const laravelDependencies = makeLaravelDependencies();
    const adapter =
      createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
        laravelDependencies,
      });

    expect(adapter.supportsBuilderModelNavigation()).toBe(false);
    expect(
      adapter.requestMethodDefinitionHint("Illuminate\\Http\\Request", "input"),
    ).toBeNull();
    expect(adapter.localScopeMethodName("published")).toBeNull();
    expect(adapter.staticBuilderTargetClassName("where")).toBeNull();
    await expect(
      adapter.dynamicWhereDefinition({
        className: "App\\Models\\Post",
        isRequestStillCurrent: () => true,
        methodName: "whereTitle",
      }),
    ).resolves.toEqual({ opened: false });
    await expect(
      adapter.relationStringDefinition({
        context: {
          className: "App\\Models\\Post",
          kind: "laravelRelationString",
          methodName: "with",
          receiverExpression: null,
          relationName: "author",
        },
        isRequestStillCurrent: () => true,
        position: { column: 1, lineNumber: 1 },
        source: "<?php",
      }),
    ).resolves.toEqual({ opened: false });
    expect(
      laravelDependencies.openPhpLaravelDynamicWhereTarget,
    ).not.toHaveBeenCalled();
    expect(
      laravelDependencies.resolvePhpLaravelRelationPathOwnerType,
    ).not.toHaveBeenCalled();
  });

  it("uses an explicit runtime provider as the authoritative activation", () => {
    const hasProvider = vi.fn(() => false);
    const adapter =
      createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
        frameworkRuntime: { hasProvider },
        isLaravelFrameworkActive: true,
      });

    expect(hasProvider).toHaveBeenCalledWith("laravel");
    expect(adapter.supportsBuilderModelNavigation()).toBe(false);
  });

  it("selects Laravel from an explicit runtime provider", () => {
    const adapter =
      createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
        frameworkRuntime: {
          hasProvider: (providerId) => providerId === "laravel",
        },
        isLaravelFrameworkActive: false,
        laravelDependencies: makeLaravelDependencies(),
      });

    expect(adapter.supportsBuilderModelNavigation()).toBe(true);
  });

  it("falls back to the legacy flag when no runtime exists", () => {
    const adapter =
      createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
        isLaravelFrameworkActive: true,
        laravelDependencies: makeLaravelDependencies(),
      });

    expect(adapter.supportsBuilderModelNavigation()).toBe(true);
  });
});
