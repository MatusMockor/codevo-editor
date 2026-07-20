import { describe, expect, it } from "vitest";
import { phpLaravelFrameworkProvider } from "./phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "./phpFrameworkNetteProvider";
import type {
  PhpFrameworkSemanticCapabilities,
  PhpFrameworkSemanticProvider,
} from "./phpFrameworkSemanticContracts";

describe("PHP framework semantic contracts", () => {
  it("accepts a provider exposing only semantic type capabilities", () => {
    const semantics = {
      propertyTypeFromSource: ({ propertyName }) =>
        propertyName === "id" ? "int" : null,
      supportsNetteDatabaseSemantics: true,
    } satisfies PhpFrameworkSemanticCapabilities;
    const provider = {
      id: "minimal-fixture",
      semantics,
    } satisfies PhpFrameworkSemanticProvider;

    expect(
      provider.semantics.propertyTypeFromSource({
        propertyName: "id",
        receiverType: null,
        source: "<?php",
      }),
    ).toBe("int");
    expect(provider.semantics.supportsNetteDatabaseSemantics).toBe(true);
  });

  it("keeps shipped framework providers structurally compatible", () => {
    const providers = [
      phpLaravelFrameworkProvider,
      phpNetteFrameworkProvider,
    ] satisfies readonly PhpFrameworkSemanticProvider[];

    expect(providers.map(({ id }) => id)).toEqual(["laravel", "nette"]);
  });
});
