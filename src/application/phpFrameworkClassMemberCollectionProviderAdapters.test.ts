import { describe, expect, it, vi } from "vitest";
import {
  createPhpFrameworkClassMemberCollectionProviderAdapters,
} from "./phpFrameworkClassMemberCollectionProviderAdapters";

describe("phpFrameworkClassMemberCollectionProviderAdapters", () => {
  it("treats an explicit generic runtime as authoritative over the legacy flag", () => {
    const frameworkRuntime = {
      hasProvider: vi.fn(() => false),
    };
    const resolvePhpDeclaredType = vi.fn(() => "App\\Models\\Post");
    const adapter = createPhpFrameworkClassMemberCollectionProviderAdapters({
      frameworkRuntime,
      isLaravelFrameworkActive: true,
      resolvePhpDeclaredType,
    });

    expect(adapter.canCollectSyntheticMembers).toBe(false);
    expect(
      adapter.dynamicWhereMethods({
        className: "App\\Models\\User",
        options: { isStatic: true },
        source: "<?php",
      }),
    ).toEqual([]);
    expect(
      adapter.relationCompletions({
        className: "App\\Models\\User",
        source: "<?php",
      }),
    ).toEqual([]);
    expect(frameworkRuntime.hasProvider).toHaveBeenCalledWith("laravel");
    expect(resolvePhpDeclaredType).not.toHaveBeenCalled();
  });

  it("selects Laravel by provider id even when the legacy flag is false", () => {
    const frameworkRuntime = {
      hasProvider: vi.fn((providerId: string) => providerId === "laravel"),
    };
    const adapter = createPhpFrameworkClassMemberCollectionProviderAdapters({
      frameworkRuntime,
      isLaravelFrameworkActive: false,
      resolvePhpDeclaredType: vi.fn(() => null),
    });

    expect(adapter.canCollectSyntheticMembers).toBe(true);
    expect(frameworkRuntime.hasProvider).toHaveBeenCalledWith("laravel");
  });

  it("preserves the legacy Laravel fallback without an explicit runtime", () => {
    const adapter = createPhpFrameworkClassMemberCollectionProviderAdapters({
      isLaravelFrameworkActive: true,
      resolvePhpDeclaredType: vi.fn(() => null),
    });

    expect(adapter.canCollectSyntheticMembers).toBe(true);
  });

  it("uses the generic adapter without runtime or legacy Laravel state", () => {
    const adapter = createPhpFrameworkClassMemberCollectionProviderAdapters({
      resolvePhpDeclaredType: vi.fn(() => null),
    });

    expect(adapter.canCollectSyntheticMembers).toBe(false);
  });
});
