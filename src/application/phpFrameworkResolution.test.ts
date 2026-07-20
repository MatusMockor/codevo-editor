import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { PhpProjectDescriptor } from "../domain/workspace";
import {
  frameworkProfileForProject,
  frameworkProfileFromProviderId,
  resolvePhpFrameworkProfile,
} from "./phpFrameworkResolution";

function phpProjectDescriptor(
  packageName: string | null,
  packageNames: readonly string[] = [],
): PhpProjectDescriptor {
  return {
    classmapRoots: [],
    hasComposer: true,
    packageName,
    packages: packageNames.map((name) => ({
      classmapRoots: [],
      dev: false,
      installPath: null,
      name,
      packageType: null,
      psr4Roots: [],
      version: null,
    })),
    phpPlatformVersion: null,
    phpVersionConstraint: null,
    psr4Roots: [],
  };
}

const SHIPPED_PROVIDERS = [
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
];

describe("resolvePhpFrameworkProfile", () => {
  it("maps shipped providers to their UI profiles", () => {
    expect(
      frameworkProfileForProject(
        phpProjectDescriptor("laravel/laravel"),
        SHIPPED_PROVIDERS,
      ),
    ).toBe("laravel");
    expect(
      frameworkProfileForProject(
        phpProjectDescriptor("nette/web-project", ["nette/application"]),
        SHIPPED_PROVIDERS,
      ),
    ).toBe("nette");
  });

  it("maps unknown providers and missing projects to generic", () => {
    expect(frameworkProfileFromProviderId("symfony")).toBe("generic");
    expect(frameworkProfileFromProviderId(null)).toBe("generic");
    expect(frameworkProfileForProject(null, SHIPPED_PROVIDERS)).toBe("generic");
  });

  it("resolves ambiguity from one detection pass in registry order", () => {
    const laravelAppliesTo = vi.fn(() => true);
    const netteAppliesTo = vi.fn(() => true);
    const laravel: PhpFrameworkProvider = {
      ...phpLaravelFrameworkProvider,
      appliesTo: laravelAppliesTo,
    };
    const nette: PhpFrameworkProvider = {
      ...phpNetteFrameworkProvider,
      appliesTo: netteAppliesTo,
    };
    const resolution = resolvePhpFrameworkProfile(
      phpProjectDescriptor("custom/app"),
      [laravel, nette],
    );

    expect(laravelAppliesTo).toHaveBeenCalledOnce();
    expect(netteAppliesTo).toHaveBeenCalledOnce();
    expect(resolution.profile).toBe("laravel");
    expect(resolution.providers).toHaveLength(1);
    expect(resolution.providers[0]?.id).toBe("laravel");
    expect(resolution.matchedProviderIds).toEqual(["laravel", "nette"]);
  });

  it("keeps custom providers active while presenting a generic profile", () => {
    const provider: PhpFrameworkProvider = {
      id: "symfony",
      appliesTo: () => true,
      presentation: { activityLabel: "Symfony" },
    };
    const resolution = resolvePhpFrameworkProfile(
      phpProjectDescriptor("symfony/app"),
      [provider],
    );

    expect(resolution.profile).toBe("generic");
    expect(resolution.providers).toEqual([provider]);
    expect(resolution.activityLabel).toBe("Symfony");
    expect(resolution.matchedProviderIds).toEqual(["symfony"]);
  });
});
