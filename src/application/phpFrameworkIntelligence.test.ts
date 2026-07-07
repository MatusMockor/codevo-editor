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
    expect(intelligence.hasProvider("laravel")).toBe(false);
    expect(intelligence.hasProvider("nette")).toBe(true);
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
    expect(intelligence.hasProvider("laravel")).toBe(false);
    expect(intelligence.hasProvider("nette")).toBe(false);
    expect(intelligence.isLaravel).toBe(false);
    expect(intelligence.isNette).toBe(false);
  });
});
