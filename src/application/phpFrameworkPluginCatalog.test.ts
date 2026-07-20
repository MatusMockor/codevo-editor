import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
import { describe, expect, it, vi } from "vitest";
import {
  createPhpFrameworkCapabilityRegistry,
  definePhpFrameworkCapability,
} from "../domain/phpFrameworkCapabilityRegistry";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { PhpProjectDescriptor } from "../domain/workspace";
import {
  composePhpFrameworkPluginCatalog,
  createPhpFrameworkPluginCatalog,
  createPhpFrameworkPluginRegistry,
  phpFrameworkCapabilityDefinitionsForPlugins,
  phpFrameworkPluginContributions,
  phpFrameworkPluginCatalog,
  phpFrameworkPlugins,
} from "./phpFrameworkPluginCatalog";
import type { PhpFrameworkPlugin } from "./phpFrameworkPlugin";
import { phpLaravelFrameworkPlugin } from "./phpLaravelFrameworkPlugin";
import { phpNetteFrameworkPlugin } from "./phpNetteFrameworkPlugin";
import { resolvePhpFrameworkProfile } from "./phpFrameworkResolution";
import {
  phpFrameworkLegacyFeatures,
  projectPhpFrameworkLegacyProvider,
} from "./phpFrameworkLegacyProviderAdapter";

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

function pluginFromLegacyProvider(
  provider: PhpFrameworkProvider,
): PhpFrameworkPlugin {
  const project = projectPhpFrameworkLegacyProvider(provider);
  return { features: project.features, provider: project.provider };
}

describe("phpFrameworkPlugins", () => {
  it("owns the shipped plugin order in application composition", () => {
    expect(phpFrameworkPlugins).toEqual([
      phpLaravelFrameworkPlugin,
      phpNetteFrameworkPlugin,
    ]);
    expect(Object.isFrozen(phpFrameworkPlugins)).toBe(true);
  });

  it("derives the provider catalog from the plugin list", () => {
    expect(phpFrameworkPluginCatalog.map(({ id }) => id)).toEqual(
      phpFrameworkPlugins.map(({ provider }) => provider.id),
    );
  });

  it("rejects duplicate plugin provider ids at registry construction", () => {
    expect(() =>
      createPhpFrameworkPluginRegistry([
        phpLaravelFrameworkPlugin,
        phpLaravelFrameworkPlugin,
      ]),
    ).toThrowError(
      'Duplicate PHP framework registration id "laravel" in PHP framework plugin catalog.',
    );
  });

  it("rejects a feature bag owned by another provider", () => {
    const foreign = projectPhpFrameworkLegacyProvider({ id: "foreign" });

    expect(() =>
      createPhpFrameworkPluginRegistry([
        { features: foreign.features, provider: { id: "owner" } },
      ]),
    ).toThrow(
      'PHP framework feature owner "foreign" does not match provider "owner".',
    );
  });

  it("rejects duplicate contribution ids across separate plugins", () => {
    const contribution = { id: "shared-navigation" };

    expect(() =>
      phpFrameworkPluginContributions(
        [phpLaravelFrameworkPlugin, phpNetteFrameworkPlugin],
        () => () => [contribution],
        undefined,
        "test contribution catalog",
      ),
    ).toThrowError(
      'Duplicate PHP framework registration id "shared-navigation" in test contribution catalog.',
    );
  });

  it("returns an immutable contribution snapshot", () => {
    const contributions = phpFrameworkPluginContributions(
      [phpLaravelFrameworkPlugin],
      () => () => [{ id: "laravel-test" }],
      undefined,
      "test contribution catalog",
    );

    expect(contributions).toEqual([{ id: "laravel-test" }]);
    expect(Object.isFrozen(contributions)).toBe(true);
  });

  it("freezes cloned plugin feature snapshots", () => {
    const searchQueries = ["route("];
    const plugin = pluginFromLegacyProvider({
      id: "mutable",
      routes: { searchQueries },
    });
    const [snapshot] = createPhpFrameworkPluginRegistry([plugin]);

    searchQueries.push("Route::get");

    const features = snapshot && phpFrameworkLegacyFeatures(snapshot);

    expect(features?.routes?.searchQueries).toEqual(["route("]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.features)).toBe(true);
    expect(
      Object.isFrozen(features?.routes?.searchQueries),
    ).toBe(true);
  });

  it("does not run a capability predicate against another plugin owner", () => {
    const foreignPredicate = vi.fn(() => true);
    const definitions = phpFrameworkCapabilityDefinitionsForPlugins([
      {
        capabilityDefinitions: [
          definePhpFrameworkCapability("foreign", foreignPredicate),
        ],
        ...pluginFromLegacyProvider({ id: "first" }),
      },
      pluginFromLegacyProvider({ id: "second" }),
    ]);
    const registry = createPhpFrameworkCapabilityRegistry({
      definitions,
      providers: [{ id: "second" }],
    });

    expect(registry.supports("foreign")).toBe(false);
    expect(foreignPredicate).not.toHaveBeenCalled();
  });
});

describe("phpFrameworkPluginCatalog", () => {
  it("owns the shipped provider order in application composition", () => {
    expect(phpFrameworkPluginCatalog).toEqual([
      phpLaravelFrameworkProvider,
      phpNetteFrameworkProvider,
    ]);
    expect(Object.isFrozen(phpFrameworkPluginCatalog)).toBe(true);
    expect(phpFrameworkPluginCatalog[0]).not.toBe(phpLaravelFrameworkProvider);
    expect(phpFrameworkPluginCatalog[1]).not.toBe(phpNetteFrameworkProvider);
    expect(Object.isFrozen(phpLaravelFrameworkProvider)).toBe(false);
    expect(Object.isFrozen(phpNetteFrameworkProvider)).toBe(false);
  });

  it("preserves the Laravel per-project provider projection", () => {
    const plainLaravel = resolvePhpFrameworkProfile(
      phpProjectDescriptor(["laravel/framework"]),
      phpFrameworkPluginCatalog,
    ).providers[0];
    const inertiaLaravel = resolvePhpFrameworkProfile(
      phpProjectDescriptor(["laravel/framework", "inertiajs/inertia-laravel"]),
      phpFrameworkPluginCatalog,
    ).providers[0];

    expect(plainLaravel?.inertia).toBeUndefined();
    expect(inertiaLaravel?.inertia).toBeDefined();
    expect(plainLaravel?.id).toBe("laravel");
    expect(inertiaLaravel?.id).toBe("laravel");
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

  it("composes a third minimal framework with only one feature group", () => {
    const minimalPlugin = pluginFromLegacyProvider({
      id: "minimal",
      appliesTo: (php) =>
        php.packages.some(({ name }) => name === "example/minimal"),
      templating: {
        completionInsertText: ({ name }) => name,
      },
    });

    const catalog = composePhpFrameworkPluginCatalog([
      ...phpFrameworkPlugins,
      minimalPlugin,
    ]);
    const minimalProvider = catalog[catalog.length - 1];

    expect(minimalProvider?.id).toBe("minimal");
    expect(
      minimalProvider?.templating?.completionInsertText?.({
        name: "page",
        prefix: "pa",
      }),
    ).toBe("page");
    expect(minimalProvider?.routes).toBeUndefined();
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(minimalProvider)).toBe(true);
  });

  it("isolates project-specific features when composing a plugin", () => {
    const base = projectPhpFrameworkLegacyProvider({
      id: "projected",
      appliesTo: () => true,
    });
    const projectPlugin: PhpFrameworkPlugin = {
      ...base,
      forProject: (php) =>
        projectPhpFrameworkLegacyProvider({
          id: "projected",
          templating: {
            completionInsertText: () => php.packages[0]?.name ?? "none",
          },
        }),
    };
    const [provider] = composePhpFrameworkPluginCatalog([projectPlugin]);

    const first = resolvePhpFrameworkProfile(
      phpProjectDescriptor(["example/first"]),
      [provider].filter((value): value is PhpFrameworkProvider => Boolean(value)),
    ).providers[0];
    const second = resolvePhpFrameworkProfile(
      phpProjectDescriptor(["example/second"]),
      [provider].filter((value): value is PhpFrameworkProvider => Boolean(value)),
    ).providers[0];

    expect(first).not.toBe(second);
    expect(
      first?.templating?.completionInsertText?.({
        name: "page",
        prefix: "pa",
      }),
    ).toBe("example/first");
    expect(
      second?.templating?.completionInsertText?.({
        name: "page",
        prefix: "pa",
      }),
    ).toBe("example/second");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
    expect(first?.templating).not.toBe(second?.templating);
    expect(Object.isFrozen(first?.templating)).toBe(true);
    expect(Object.isFrozen(second?.templating)).toBe(true);
  });

  it("rejects a project specialization that changes plugin ownership", () => {
    const owner = projectPhpFrameworkLegacyProvider({
      appliesTo: () => true,
      id: "owner",
    });
    const other = projectPhpFrameworkLegacyProvider({ id: "other" });
    const [provider] = composePhpFrameworkPluginCatalog([
      {
        ...owner,
        forProject: () => other,
      },
    ]);

    expect(() =>
      resolvePhpFrameworkProfile(
        phpProjectDescriptor(["example/project"]),
        provider ? [provider] : [],
      ),
    ).toThrow(
      'PHP framework project specialization changed provider id from "owner" to "other".',
    );
  });
});
