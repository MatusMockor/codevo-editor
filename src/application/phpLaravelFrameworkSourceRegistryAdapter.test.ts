import { describe, expect, it, vi } from "vitest";
import {
  phpLaravelFrameworkSourceRegistryAdapter,
  phpLaravelFrameworkSourceRegistryProvider,
  phpLaravelFrameworkSourceRegistryProviderId,
} from "./phpLaravelFrameworkSourceRegistryAdapter";
import type { LaravelSourceRegistries } from "./useLaravelSourceRegistries";

const ROOT = "/workspace";
const OTHER_ROOT = "/other-workspace";
const MIGRATION_PATH = `${ROOT}/database/migrations/2026_07_05_000000_create_posts.php`;

function makeLaravelSources(): LaravelSourceRegistries {
  return {
    currentPhpLaravelSourceContext: vi.fn(() => ({
      signature: "active",
      workspaceSources: ["active"],
    })),
    currentPhpLaravelSourceContextForRoot: vi.fn((rootPath: string) => ({
      signature: rootPath === ROOT ? "m:root|p:root" : "m:other|p:other",
      workspaceSources:
        rootPath === ROOT ? ["root migration", "root provider"] : ["other"],
    })),
    ensurePhpLaravelMigrationSourcesLoaded: vi.fn(async () => undefined),
    ensurePhpLaravelProviderSourcesLoaded: vi.fn(async () => undefined),
    invalidatePhpLaravelMigrationSourcesForPath: vi.fn(),
    invalidatePhpLaravelProviderSourcesForPath: vi.fn(),
    resetPhpLaravelSourceRegistries: vi.fn(),
  };
}

describe("phpLaravelFrameworkSourceRegistryProvider", () => {
  it("keeps the Laravel provider id at the adapter boundary", () => {
    const laravelSources = makeLaravelSources();
    const adapter = phpLaravelFrameworkSourceRegistryAdapter(laravelSources);

    expect(adapter.providerId).toBe(phpLaravelFrameworkSourceRegistryProviderId);
  });

  it("reads Laravel source context for the requested root", () => {
    const laravelSources = makeLaravelSources();
    const provider = phpLaravelFrameworkSourceRegistryProvider(laravelSources);

    expect(provider.currentPhpFrameworkSourceContextForRoot(ROOT)).toEqual({
      signature: "m:root|p:root",
      workspaceSources: ["root migration", "root provider"],
    });
    expect(provider.currentPhpFrameworkSourceContextForRoot(OTHER_ROOT)).toEqual({
      signature: "m:other|p:other",
      workspaceSources: ["other"],
    });
    expect(
      laravelSources.currentPhpLaravelSourceContextForRoot,
    ).toHaveBeenCalledWith(ROOT);
    expect(
      laravelSources.currentPhpLaravelSourceContext,
    ).not.toHaveBeenCalled();
  });

  it("loads and invalidates Laravel source collections with an explicit root", async () => {
    const laravelSources = makeLaravelSources();
    const provider = phpLaravelFrameworkSourceRegistryProvider(laravelSources);

    await provider.ensurePhpFrameworkSourceCollectionsLoaded(ROOT);
    provider.invalidatePhpFrameworkSourcePathForRoot(ROOT, MIGRATION_PATH);

    expect(
      laravelSources.ensurePhpLaravelMigrationSourcesLoaded,
    ).toHaveBeenCalledWith(ROOT);
    expect(
      laravelSources.ensurePhpLaravelProviderSourcesLoaded,
    ).toHaveBeenCalledWith(ROOT);
    expect(
      laravelSources.invalidatePhpLaravelMigrationSourcesForPath,
    ).toHaveBeenCalledWith(ROOT, MIGRATION_PATH);
    expect(
      laravelSources.invalidatePhpLaravelProviderSourcesForPath,
    ).toHaveBeenCalledWith(ROOT, MIGRATION_PATH);
  });
});
