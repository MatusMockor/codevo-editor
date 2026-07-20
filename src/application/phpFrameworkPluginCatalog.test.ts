import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
import { describe, expect, it } from "vitest";
import {
  resolvePhpFrameworkProfile,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { PhpProjectDescriptor } from "../domain/workspace";
import {
  createPhpFrameworkPluginCatalog,
  phpFrameworkPluginCatalog,
} from "./phpFrameworkPluginCatalog";

function phpProjectDescriptor(
  packageNames: readonly string[],
): PhpProjectDescriptor {
  return {
    classmapRoots: [],
    hasComposer: true,
    packageName: null,
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

describe("phpFrameworkPluginCatalog", () => {
  it("owns the shipped provider order in application composition", () => {
    expect(phpFrameworkPluginCatalog).toEqual([
      phpLaravelFrameworkProvider,
      phpNetteFrameworkProvider,
    ]);
    expect(Object.isFrozen(phpFrameworkPluginCatalog)).toBe(true);
  });

  it("accepts a third provider without changing framework resolution", () => {
    const symfonyProvider: PhpFrameworkProvider = {
      id: "symfony",
      appliesTo: (php) =>
        php.packages.some(
          (composerPackage) =>
            composerPackage.name === "symfony/framework-bundle",
        ),
      presentation: { activityLabel: "Symfony" },
    };
    const catalog = createPhpFrameworkPluginCatalog([
      ...phpFrameworkPluginCatalog,
      symfonyProvider,
    ]);

    const resolution = resolvePhpFrameworkProfile(
      phpProjectDescriptor(["symfony/framework-bundle"]),
      catalog,
    );

    expect(resolution.providers).toEqual([symfonyProvider]);
    expect(resolution.matchedProviderIds).toEqual(["symfony"]);
    expect(resolution.activityLabel).toBe("Symfony");
    expect(resolution.profile).toBe("generic");
  });

  it("rejects duplicate provider ids at catalog construction", () => {
    expect(() =>
      createPhpFrameworkPluginCatalog([
        phpLaravelFrameworkProvider,
        phpLaravelFrameworkProvider,
      ]),
    ).toThrowError(
      'Duplicate PHP framework registration id "laravel" in PHP framework plugin catalog.',
    );
  });
});
