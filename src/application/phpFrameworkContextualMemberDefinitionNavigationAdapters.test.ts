import { describe, expect, it, vi } from "vitest";
import { createPhpFrameworkContextualMemberDefinitionNavigationAdapters } from "./phpFrameworkContextualMemberDefinitionNavigationAdapters";

describe("phpFrameworkContextualMemberDefinitionNavigationAdapters", () => {
  it("returns the generic adapter without Laravel activation", () => {
    const adapter =
      createPhpFrameworkContextualMemberDefinitionNavigationAdapters({});

    expect(adapter.supportsBuilderModelNavigation()).toBe(false);
    expect(
      adapter.requestMethodDefinitionHint(
        "Illuminate\\Http\\Request",
        "input",
      ),
    ).toBeNull();
    expect(adapter.localScopeMethodName("published")).toBeNull();
    expect(
      adapter.dynamicWhereTargetClassName("App\\Models\\Post"),
    ).toBeNull();
    expect(adapter.staticBuilderTargetClassName("where")).toBeNull();
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
      });

    expect(adapter.supportsBuilderModelNavigation()).toBe(true);
  });

  it("falls back to the legacy flag when no runtime exists", () => {
    const adapter =
      createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
        isLaravelFrameworkActive: true,
      });

    expect(adapter.supportsBuilderModelNavigation()).toBe(true);
  });
});
