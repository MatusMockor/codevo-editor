import { describe, expect, it, vi } from "vitest";
import {
  activePhpFrameworkSourceRegistryProviders,
  type PhpFrameworkSourceRegistryAdapter,
} from "./phpFrameworkSourceRegistryAdapters";
import type { PhpFrameworkSourceRegistryProvider } from "./usePhpFrameworkSourceRegistries";

function provider(
  signature: string,
): PhpFrameworkSourceRegistryProvider {
  return {
    currentPhpFrameworkSourceContextForRoot: () => ({
      signature,
      workspaceSources: [],
    }),
    ensurePhpFrameworkSourceCollectionsLoaded: async () => {},
    invalidatePhpFrameworkSourcePathForRoot: () => {},
    resetPhpFrameworkSourceRegistries: () => {},
  };
}

function adapter(
  providerId: string,
  signature: string,
): PhpFrameworkSourceRegistryAdapter {
  return {
    providerId,
    provider: provider(signature),
  };
}

describe("activePhpFrameworkSourceRegistryProviders", () => {
  it("selects Laravel by provider identity without consulting a profile", () => {
    const hasProvider = vi.fn((providerId: string) => providerId === "laravel");

    const selected = activePhpFrameworkSourceRegistryProviders(
      { hasProvider },
      [adapter("laravel", "laravel")],
    );

    expect(selected.map((item) =>
      item.currentPhpFrameworkSourceContextForRoot("/workspace").signature,
    )).toEqual(["laravel"]);
    expect(hasProvider).toHaveBeenCalledWith("laravel");
  });

  it("does not select Laravel for generic or Nette providers", () => {
    const laravelAdapter = adapter("laravel", "laravel");

    expect(
      activePhpFrameworkSourceRegistryProviders(
        { hasProvider: () => false },
        [laravelAdapter],
      ),
    ).toEqual([]);
    expect(
      activePhpFrameworkSourceRegistryProviders(
        { hasProvider: (providerId) => providerId === "nette" },
        [laravelAdapter],
      ),
    ).toEqual([]);
  });

  it("preserves registry order when multiple contributors are active", () => {
    const selected = activePhpFrameworkSourceRegistryProviders(
      { hasProvider: () => true },
      [adapter("first", "first"), adapter("second", "second")],
    );

    expect(selected.map((item) =>
      item.currentPhpFrameworkSourceContextForRoot("/workspace").signature,
    )).toEqual(["first", "second"]);
  });
});
