import { describe, expect, it } from "vitest";
import {
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

describe("createPhpFrameworkRuntimeContext", () => {
  it("exposes a capability-first Laravel runtime boundary", () => {
    const intelligence = createPhpFrameworkIntelligence({
      matchedProviderIds: ["laravel"],
      profile: "laravel",
      providers: [phpLaravelFrameworkProvider],
    });

    const runtime = createPhpFrameworkRuntimeContext(intelligence);

    expect(runtime.profile).toBe("laravel");
    expect("intelligence" in runtime).toBe(false);
    expect(runtime.isLaravel).toBe(true);
    expect(runtime.isNette).toBe(false);
    expect(runtime.hasProvider("laravel")).toBe(true);
    expect(runtime.supports("routes")).toBe(true);
    expect(runtime.supports("views")).toBe(true);
    expect(runtime.supportsTargetCollection("routes")).toBe(true);
  });

  it("keeps Nette runtime capabilities separate from Laravel identity", () => {
    const intelligence = createPhpFrameworkIntelligence({
      matchedProviderIds: ["nette"],
      profile: "nette",
      providers: [phpNetteFrameworkProvider],
    });

    const runtime = createPhpFrameworkRuntimeContext(intelligence);

    expect(runtime.profile).toBe("nette");
    expect(runtime.isLaravel).toBe(false);
    expect(runtime.isNette).toBe(true);
    expect(runtime.hasProvider("nette")).toBe(true);
    expect(runtime.supports("latteTemplateIntelligence")).toBe(true);
    expect(runtime.supports("routes")).toBe(false);
  });
});
