import { describe, expect, it, vi } from "vitest";
import {
  createPhpFrameworkContextualMemberDefinitionNavigationAdapters,
  type PhpFrameworkContextualMemberDefinitionNavigationContribution,
} from "./phpFrameworkContextualMemberDefinitionNavigationAdapters";
import type { PhpFrameworkContextualMemberDefinitionNavigationAdapter } from "./phpFrameworkContextualMemberDefinitionNavigationAdapter";

function makeActiveAdapter(): PhpFrameworkContextualMemberDefinitionNavigationAdapter {
  return {
    dynamicWhereDefinition: vi.fn(async () => ({ opened: false })),
    localScopeMethodName: vi.fn(() => "scopePublished"),
    relationStringDefinition: vi.fn(async () => ({ opened: false })),
    requestMethodDefinitionHint: vi.fn(() => null),
    staticBuilderTargetClassName: vi.fn(() => "App\\Models\\Post"),
    supportsBuilderModelNavigation: vi.fn(() => true),
  };
}

function makeProviderContribution(
  providerId = "laravel",
): PhpFrameworkContextualMemberDefinitionNavigationContribution {
  return {
    createAdapter: vi.fn(() => makeActiveAdapter()),
    providerId,
  };
}

describe("phpFrameworkContextualMemberDefinitionNavigationAdapters", () => {
  it("returns an inert generic adapter without resolving provider targets", async () => {
    const providerContribution = makeProviderContribution();
    const adapter =
      createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
        providerContributions: [providerContribution],
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
    expect(providerContribution.createAdapter).not.toHaveBeenCalled();
  });

  it("uses an explicit runtime provider as the authoritative activation", () => {
    const hasProvider = vi.fn(() => false);
    const adapter =
      createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
        frameworkRuntime: { hasProvider },
        isLaravelFrameworkActive: true,
        providerContributions: [makeProviderContribution()],
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
        providerContributions: [makeProviderContribution()],
      });

    expect(adapter.supportsBuilderModelNavigation()).toBe(true);
  });

  it("falls back to the legacy flag when no runtime exists", () => {
    const adapter =
      createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
        isLaravelFrameworkActive: true,
        providerContributions: [makeProviderContribution()],
      });

    expect(adapter.supportsBuilderModelNavigation()).toBe(true);
  });

  it("ignores inactive provider contributions", () => {
    const providerContribution = makeProviderContribution("nette");
    const adapter =
      createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
        frameworkRuntime: {
          hasProvider: (providerId) => providerId === "laravel",
        },
        providerContributions: [providerContribution],
      });

    expect(adapter.supportsBuilderModelNavigation()).toBe(false);
    expect(providerContribution.createAdapter).not.toHaveBeenCalled();
  });
});
