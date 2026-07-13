import { describe, expect, it } from "vitest";
import {
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

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
    expect(intelligence.hasProvider("laravel")).toBe(true);
    expect(intelligence.hasProvider("nette")).toBe(false);
    expect(intelligence.isLaravel).toBe(true);
    expect(intelligence.isNette).toBe(false);
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
    expect(intelligence.capabilities.supports("latteTemplateIntelligence")).toBe(
      true,
    );
    expect(intelligence.hasProvider("laravel")).toBe(false);
    expect(intelligence.hasProvider("nette")).toBe(true);
    expect(intelligence.isLaravel).toBe(false);
    expect(intelligence.isNette).toBe(true);
  });

  it("derives framework activation from providers instead of profile labels", () => {
    const intelligence = createPhpFrameworkIntelligence({
      matchedProviderIds: ["nette"],
      profile: "generic",
      providers: [phpNetteFrameworkProvider],
    });

    expect(intelligence.isLaravel).toBe(false);
    expect(intelligence.isNette).toBe(true);
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
    expect(intelligence.isLaravel).toBe(false);
    expect(intelligence.isNette).toBe(false);
  });
});
