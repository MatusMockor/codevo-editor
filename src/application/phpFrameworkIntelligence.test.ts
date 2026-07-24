import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
import { definePhpFrameworkCapability } from "../domain/phpFrameworkCapabilityRegistry";
import type { PhpFrameworkPluginProject } from "../domain/phpFrameworkProviderFeatures";
import type { PhpProjectDescriptor } from "../domain/workspace";
import { describe, expect, it } from "vitest";

import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { composePhpFrameworkPluginCatalog, phpFrameworkPlugins } from "./phpFrameworkPluginCatalog";
import type { PhpFrameworkPlugin } from "./phpFrameworkPlugin";
import {
  phpFrameworkLegacyFeatures,
  projectPhpFrameworkLegacyProvider,
} from "./phpFrameworkLegacyProviderAdapter";
import { resolvePhpFrameworkProfile } from "./phpFrameworkResolution";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

function phpProjectDescriptor(packageNames: readonly string[]): PhpProjectDescriptor {
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

describe("createPhpFrameworkIntelligence", () => {
  it("exposes Laravel as the active application framework intelligence", () => {
    const providers = [phpLaravelFrameworkProvider];
    const intelligence = createPhpFrameworkIntelligence({
      matchedProviderIds: ["laravel"],
      profile: "laravel",
      providers,
    });

    expect(intelligence.providers).toBe(providers);
    expect(intelligence.providerIds).toEqual(["laravel"]);
    expect(intelligence.providerSignature).toBe("laravel");
    expect(intelligence.capabilities.providerSignature).toBe("laravel");
    expect(intelligence.capabilities.supports("routes")).toBe(true);
    expect(intelligence.capabilities.supports("views")).toBe(true);
    expect(intelligence.capabilities.supports("eloquentModelSemantics")).toBe(true);
    expect(intelligence.hasProvider("laravel")).toBe(true);
    expect(intelligence.hasProvider("nette")).toBe(false);
  });

  it("exposes Nette without activating Laravel branches", () => {
    const providers = [phpNetteFrameworkProvider];
    const intelligence = createPhpFrameworkIntelligence({
      matchedProviderIds: ["nette"],
      profile: "nette",
      providers,
    });

    expect(intelligence.providers).toBe(providers);
    expect(intelligence.providerIds).toEqual(["nette"]);
    expect(intelligence.providerSignature).toBe("nette");
    expect(intelligence.capabilities.providerSignature).toBe("nette");
    expect(intelligence.capabilities.supports("routes")).toBe(false);
    expect(intelligence.capabilities.supports("stringLiterals")).toBe(true);
    expect(intelligence.capabilities.supports("latteTemplateIntelligence")).toBe(true);
    expect(intelligence.hasProvider("laravel")).toBe(false);
    expect(intelligence.hasProvider("nette")).toBe(true);
  });

  it("derives framework activation from providers instead of profile labels", () => {
    const intelligence = createPhpFrameworkIntelligence({
      matchedProviderIds: ["nette"],
      profile: "generic",
      providers: [phpNetteFrameworkProvider],
    });

    expect(intelligence.hasProvider("laravel")).toBe(false);
    expect(intelligence.hasProvider("nette")).toBe(true);
  });

  it("keeps generic workspaces provider-empty", () => {
    const intelligence = createPhpFrameworkIntelligence({
      matchedProviderIds: [],
      profile: "generic",
      providers: [],
    });

    expect(intelligence.providers).toEqual([]);
    expect(intelligence.providerIds).toEqual([]);
    expect(intelligence.providerSignature).toBe("");
    expect(intelligence.capabilities.providerSignature).toBe("");
    expect(intelligence.capabilities.supports("routes")).toBe(false);
    expect(intelligence.hasProvider("laravel")).toBe(false);
    expect(intelligence.hasProvider("nette")).toBe(false);
  });

  it("exposes an injected third plugin capability without leaking project state", () => {
    const cakePhp = projectPhpFrameworkLegacyProvider({
      appliesTo: (php) => php.packages.some(({ name }) => name === "cakephp/cakephp"),
      id: "cakephp",
      presentation: { activityLabel: "CakePHP" },
    });
    const cakePhpPlugin: PhpFrameworkPlugin = {
      capabilityDefinitions: [
        definePhpFrameworkCapability(
          "cakePhpTemplateIntelligence",
          (project: PhpFrameworkPluginProject) =>
            Boolean(phpFrameworkLegacyFeatures(project)?.templating),
        ),
      ],
      ...cakePhp,
      forProject: (php) =>
        projectPhpFrameworkLegacyProvider({
          ...cakePhp.provider,
          templating: php.packages.some(({ name }) => name === "cakephp/plugin-installer")
            ? { completionInsertText: ({ name }) => name }
            : undefined,
        }),
    };
    const catalog = composePhpFrameworkPluginCatalog([...phpFrameworkPlugins, cakePhpPlugin]);
    const runtimeFor = (packages: readonly string[]) =>
      createPhpFrameworkRuntimeContext(
        createPhpFrameworkIntelligence(
          resolvePhpFrameworkProfile(phpProjectDescriptor(packages), catalog),
        ),
      );

    const enabled = runtimeFor(["cakephp/cakephp", "cakephp/plugin-installer"]);
    const disabled = runtimeFor(["cakephp/cakephp"]);

    expect(enabled.hasProvider("cakephp")).toBe(true);
    expect(enabled.supports("cakePhpTemplateIntelligence")).toBe(true);
    expect(disabled.hasProvider("cakephp")).toBe(true);
    expect(disabled.supports("cakePhpTemplateIntelligence")).toBe(false);
  });
});
