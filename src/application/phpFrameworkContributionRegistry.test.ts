import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
import { describe, expect, it } from "vitest";
import {
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { collectActiveContributions } from "./phpFrameworkContributionRegistry";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  createPhpFrameworkRuntimeContext,
  type PhpFrameworkRuntimeContext,
} from "./phpFrameworkRuntimeContext";

function runtimeFor(
  providers: readonly PhpFrameworkProvider[],
): PhpFrameworkRuntimeContext {
  return createPhpFrameworkRuntimeContext(
    createPhpFrameworkIntelligence({
      matchedProviderIds: providers.map((provider) => provider.id),
      profile: "generic",
      providers,
    }),
  );
}

describe("collectActiveContributions", () => {
  it("merges selected descriptors preserving provider registry order", () => {
    expect(
      collectActiveContributions({
        frameworkRuntime: runtimeFor([
          phpLaravelFrameworkProvider,
          phpNetteFrameworkProvider,
        ]),
        select: (provider) => provider.fileChangeInvalidations,
      }),
    ).toEqual([
      { kind: "bladeComponentNames" },
      { kind: "bladeViewDataEntries" },
      { kind: "latteExpressionData" },
      { kind: "neonConfig" },
    ]);

    expect(
      collectActiveContributions({
        frameworkRuntime: runtimeFor([
          phpNetteFrameworkProvider,
          phpLaravelFrameworkProvider,
        ]),
        select: (provider) => provider.fileChangeInvalidations,
      }),
    ).toEqual([
      { kind: "latteExpressionData" },
      { kind: "neonConfig" },
      { kind: "bladeComponentNames" },
      { kind: "bladeViewDataEntries" },
    ]);
  });

  it("collects gated contributions when the runtime supports the capability", () => {
    expect(
      collectActiveContributions({
        capability: "codeActions",
        frameworkRuntime: runtimeFor([phpLaravelFrameworkProvider]),
        select: (provider) => provider.activeDocumentDiagnostics,
      }),
    ).toEqual([
      {
        kind: "bladeViewReferences",
        language: "blade",
      },
    ]);
  });

  it("collects nothing when the capability gate fails", () => {
    const runtime: PhpFrameworkRuntimeContext = {
      ...runtimeFor([phpNetteFrameworkProvider]),
      supports: (capability) => capability !== "codeActions",
    };

    expect(
      collectActiveContributions({
        capability: "codeActions",
        frameworkRuntime: runtime,
        select: (provider) => provider.activeDocumentDiagnostics,
      }),
    ).toEqual([]);
  });

  it("collects nothing when no provider is active", () => {
    expect(
      collectActiveContributions({
        frameworkRuntime: runtimeFor([]),
        select: (provider) => provider.fileChangeInvalidations,
      }),
    ).toEqual([]);
  });

  it("skips providers that do not declare the selected contribution", () => {
    expect(
      collectActiveContributions({
        frameworkRuntime: runtimeFor([{ id: "bare" }]),
        select: (provider) => provider.fileChangeInvalidations,
      }),
    ).toEqual([]);
  });

  it("applies the selector's per-descriptor filtering", () => {
    expect(
      collectActiveContributions({
        frameworkRuntime: runtimeFor([phpNetteFrameworkProvider]),
        select: (provider) =>
          provider.activeDocumentDiagnostics?.filter(
            (descriptor) => descriptor.kind === "lattePresenterLinks",
          ),
      }),
    ).toEqual([
      {
        kind: "lattePresenterLinks",
        language: "latte",
      },
    ]);
  });
});
