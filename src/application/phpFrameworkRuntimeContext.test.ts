import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
import { describe, expect, it } from "vitest";

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
    expect("isLaravel" in runtime).toBe(false);
    expect("isNette" in runtime).toBe(false);
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
    expect("isLaravel" in runtime).toBe(false);
    expect("isNette" in runtime).toBe(false);
    expect(runtime.hasProvider("nette")).toBe(true);
    expect(runtime.supports("latteTemplateIntelligence")).toBe(true);
    expect(runtime.supports("routes")).toBe(false);
  });
});
