import { describe, expect, it, vi } from "vitest";
import {
  createPhpFrameworkClassMemberCollectionProviderAdapters,
} from "./phpFrameworkClassMemberCollectionProviderAdapters";

describe("phpFrameworkClassMemberCollectionProviderAdapters", () => {
  it("uses the generic adapter when the runtime lacks the Laravel provider", () => {
    const frameworkRuntime = {
      hasProvider: vi.fn(() => false),
      supports: vi.fn(() => false),
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
    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "eloquentModelSemantics",
    );
    expect(frameworkRuntime.hasProvider).not.toHaveBeenCalled();
    expect(resolvePhpFrameworkDeclaredType).not.toHaveBeenCalled();
  });

  it("selects Laravel by Eloquent model semantics", () => {
    const frameworkRuntime = {
      hasProvider: vi.fn((providerId: string) => providerId === "laravel"),
      supports: vi.fn((capability: string) =>
        capability === "eloquentModelSemantics"
      ),
    };
    const adapter = createPhpFrameworkClassMemberCollectionProviderAdapters({
      frameworkRuntime,
      resolvePhpFrameworkDeclaredType: vi.fn(() => null),
    });

    expect(adapter.canCollectSyntheticMembers).toBe(true);
    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "eloquentModelSemantics",
    );
    expect(frameworkRuntime.hasProvider).not.toHaveBeenCalled();
  });

  it("uses the generic adapter for a non-Laravel framework runtime", () => {
    const adapter = createPhpFrameworkClassMemberCollectionProviderAdapters({
      frameworkRuntime: {
        hasProvider: (providerId: string) => providerId === "symfony",
        supports: () => false,
      },
      resolvePhpFrameworkDeclaredType: vi.fn(() => null),
    });

    expect(adapter.canCollectSyntheticMembers).toBe(false);
  });
});
