import { describe, expect, it, vi } from "vitest";
import { activePhpFrameworkSemanticAdapter } from "./phpFrameworkSemanticAdapterRegistry";

describe("phpFrameworkSemanticAdapterRegistry", () => {
  it("returns the fallback when no provider contribution is active", () => {
    const fallback = { name: "generic" };
    const inactiveAdapter = { name: "inactive" };
    const createAdapter = vi.fn(() => inactiveAdapter);
    const frameworkRuntime = {
      hasProvider: vi.fn(() => false),
    };

    const adapter = activePhpFrameworkSemanticAdapter(
      frameworkRuntime,
      [{ providerId: "laravel", createAdapter }],
      fallback,
    );

    expect(adapter).toBe(fallback);
    expect(frameworkRuntime.hasProvider).toHaveBeenCalledWith("laravel");
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("returns the first active provider contribution", () => {
    const fallback = { name: "generic" };
    const laravelAdapter = { name: "laravel" };
    const netteAdapter = { name: "nette" };
    const createLaravelAdapter = vi.fn(() => laravelAdapter);
    const createNetteAdapter = vi.fn(() => netteAdapter);
    const queriedProviderIds: string[] = [];

    const adapter = activePhpFrameworkSemanticAdapter(
      {
        hasProvider: (providerId) => {
          queriedProviderIds.push(providerId);
          return providerId === "laravel" || providerId === "nette";
        },
      },
      [
        { providerId: "laravel", createAdapter: createLaravelAdapter },
        { providerId: "nette", createAdapter: createNetteAdapter },
      ],
      fallback,
    );

    expect(adapter).toBe(laravelAdapter);
    expect(queriedProviderIds).toEqual(["laravel"]);
    expect(createLaravelAdapter).toHaveBeenCalledOnce();
    expect(createNetteAdapter).not.toHaveBeenCalled();
  });
});
