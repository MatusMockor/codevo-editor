import { describe, expect, it, vi } from "vitest";
import { createPhpFrameworkDefinitionNavigationContributionCatalog } from "./phpFrameworkDefinitionNavigationContributionCatalog";
import type { PhpFrameworkActivationContext } from "./phpFrameworkExtensionRegistry";
import type { PhpFrameworkPlugin } from "./phpFrameworkPlugin";
import { phpFrameworkPlugins } from "./phpFrameworkPluginCatalog";

function activation(): PhpFrameworkActivationContext {
  return {
    generation: 0,
    isCurrent: () => true,
    ownerKey: "owner",
    rootPath: "/workspace",
  };
}

function catalogDependencies() {
  return {
    openPhpClassTarget: vi.fn(async () => false),
    readNavigationFileContent: vi.fn(async () => ""),
    resolvePhpClassSourcePaths: vi.fn(async () => []),
    resolvePhpExpressionType: vi.fn(async () => null),
  };
}

describe("createPhpFrameworkDefinitionNavigationContributionCatalog", () => {
  it("derives navigation contributions from the plugin list", async () => {
    const provideDefinition = vi.fn(async () => true);
    const symfonyPlugin: PhpFrameworkPlugin = {
      features: {},
      provider: {
        appliesTo: () => false,
        id: "symfony",
        presentation: { activityLabel: "Symfony" },
      },
      navigation: () => [
        {
          createProvider: () => ({ provideDefinition }),
          id: "symfony-route-definition-navigation",
          supports: () => true,
        },
      ],
    };
    const registry = createPhpFrameworkDefinitionNavigationContributionCatalog({
      activation: activation(),
      frameworkRuntime: { hasProvider: () => false, supports: () => false },
      plugins: [...phpFrameworkPlugins, symfonyPlugin],
      ...catalogDependencies(),
    });

    await expect(registry.provideDefinition("<?php", 0)).resolves.toBe(true);
    expect(provideDefinition).toHaveBeenCalled();
  });

  it("stays inert when no plugin contribution supports the runtime", async () => {
    const registry = createPhpFrameworkDefinitionNavigationContributionCatalog({
      activation: activation(),
      frameworkRuntime: { hasProvider: () => false, supports: () => false },
      ...catalogDependencies(),
    });

    await expect(registry.provideDefinition("<?php", 0)).resolves.toBe(false);
  });

  it("rejects duplicate navigation ids from separate plugins", () => {
    const duplicatePlugin: PhpFrameworkPlugin = {
      features: {},
      provider: {
        appliesTo: () => false,
        id: "duplicate-navigation",
        presentation: { activityLabel: "Duplicate" },
      },
      navigation: () => [
        {
          createProvider: () => ({ provideDefinition: async () => false }),
          id: "nette-database-definition-navigation",
          supports: () => true,
        },
      ],
    };

    expect(() =>
      createPhpFrameworkDefinitionNavigationContributionCatalog({
        activation: activation(),
        frameworkRuntime: { hasProvider: () => false, supports: () => false },
        plugins: [...phpFrameworkPlugins, duplicatePlugin],
        ...catalogDependencies(),
      }),
    ).toThrowError(
      /Duplicate PHP framework registration id "nette-database-definition-navigation"/,
    );
  });
});
