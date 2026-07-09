import { describe, expect, it } from "vitest";

import {
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import {
  phpFrameworkSupportsCapability,
  phpFrameworkSupportsCollection,
} from "./phpFrameworkCapabilityGuards";

describe("phpFrameworkCapabilityGuards", () => {
  it("answers application capability gates through the provider registry", () => {
    expect(
      phpFrameworkSupportsCapability([phpLaravelFrameworkProvider], "views"),
    ).toBe(true);
    expect(
      phpFrameworkSupportsCapability([phpNetteFrameworkProvider], "views"),
    ).toBe(false);
    expect(
      phpFrameworkSupportsCapability(
        [phpNetteFrameworkProvider],
        "latteTemplateIntelligence",
      ),
    ).toBe(true);
  });

  it("answers target collection gates through the provider registry", () => {
    expect(
      phpFrameworkSupportsCollection([phpLaravelFrameworkProvider], "routes"),
    ).toBe(true);
    expect(
      phpFrameworkSupportsCollection([phpNetteFrameworkProvider], "routes"),
    ).toBe(false);
  });
});
