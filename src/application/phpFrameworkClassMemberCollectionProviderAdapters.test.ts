import { describe, expect, it, vi } from "vitest";
import {
  createPhpFrameworkClassMemberCollectionProviderAdapters,
} from "./phpFrameworkClassMemberCollectionProviderAdapters";

describe("phpFrameworkClassMemberCollectionProviderAdapters", () => {
  it("uses the generic adapter when the runtime lacks the Laravel provider", () => {
    const frameworkRuntime = {
      hasProvider: vi.fn(() => false),
    };
    const resolvePhpFrameworkDeclaredType = vi.fn(() => "App\\Models\\Post");
    const adapter = createPhpFrameworkClassMemberCollectionProviderAdapters({
      frameworkRuntime,
      resolvePhpFrameworkDeclaredType,
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
    expect(resolvePhpFrameworkDeclaredType).not.toHaveBeenCalled();
  });

  it("selects Laravel by provider id", () => {
    const frameworkRuntime = {
      hasProvider: vi.fn((providerId: string) => providerId === "laravel"),
    };
    const adapter = createPhpFrameworkClassMemberCollectionProviderAdapters({
      frameworkRuntime,
      resolvePhpFrameworkDeclaredType: vi.fn(() => null),
    });

    expect(adapter.canCollectSyntheticMembers).toBe(true);
    expect(frameworkRuntime.hasProvider).toHaveBeenCalledWith("laravel");
  });

  it("uses the generic adapter for a non-Laravel framework runtime", () => {
    const adapter = createPhpFrameworkClassMemberCollectionProviderAdapters({
      frameworkRuntime: {
        hasProvider: (providerId: string) => providerId === "symfony",
      },
      resolvePhpFrameworkDeclaredType: vi.fn(() => null),
    });

    expect(adapter.canCollectSyntheticMembers).toBe(false);
  });
});
