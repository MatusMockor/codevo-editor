import { describe, expect, it, vi } from "vitest";
import {
  phpNetteFrameworkSourceRegistryAdapter,
  phpNetteFrameworkSourceRegistryProvider,
  phpNetteFrameworkSourceRegistryProviderId,
} from "./phpNetteFrameworkSourceRegistryAdapter";
import type { NetteSourceRegistries } from "./useNetteSourceRegistries";

const ROOT = "/workspace";
const NEON_PATH = `${ROOT}/config/config.neon`;

function makeNetteSources(): NetteSourceRegistries {
  return {
    currentPhpNetteSourceContextForRoot: vi.fn((rootPath: string) => ({
      signature: rootPath === ROOT ? "neon:root" : "neon:other",
      workspaceSources: rootPath === ROOT ? ["root neon"] : ["other neon"],
    })),
    ensurePhpNetteNeonConfigSourcesLoaded: vi.fn(async () => undefined),
    invalidatePhpNetteNeonConfigSourcesForPath: vi.fn(),
    resetPhpNetteSourceRegistries: vi.fn(),
  };
}

describe("phpNetteFrameworkSourceRegistryProvider", () => {
  it("keeps the Nette provider id at the adapter boundary", () => {
    const adapter = phpNetteFrameworkSourceRegistryAdapter(makeNetteSources());

    expect(adapter.providerId).toBe(phpNetteFrameworkSourceRegistryProviderId);
  });

  it("reads Nette source context for the requested root", () => {
    const netteSources = makeNetteSources();
    const provider = phpNetteFrameworkSourceRegistryProvider(netteSources);

    expect(provider.currentPhpFrameworkSourceContextForRoot(ROOT)).toEqual({
      signature: "neon:root",
      workspaceSources: ["root neon"],
    });
    expect(netteSources.currentPhpNetteSourceContextForRoot).toHaveBeenCalledWith(
      ROOT,
    );
  });

  it("loads and invalidates Nette source collections with an explicit root", async () => {
    const netteSources = makeNetteSources();
    const provider = phpNetteFrameworkSourceRegistryProvider(netteSources);

    await provider.ensurePhpFrameworkSourceCollectionsLoaded(ROOT);
    provider.invalidatePhpFrameworkSourcePathForRoot(ROOT, NEON_PATH);

    expect(
      netteSources.ensurePhpNetteNeonConfigSourcesLoaded,
    ).toHaveBeenCalledWith(ROOT);
    expect(
      netteSources.invalidatePhpNetteNeonConfigSourcesForPath,
    ).toHaveBeenCalledWith(ROOT, NEON_PATH);
  });
});
