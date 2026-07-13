import { describe, expect, it, vi } from "vitest";
import {
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { activePhpFrameworkCodeActions } from "./phpFrameworkCodeActionContributionRegistry";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  createPhpFrameworkRuntimeContext,
  type PhpFrameworkRuntimeContext,
} from "./phpFrameworkRuntimeContext";

const ROOT = "/workspace";
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);
const NETTE_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["nette"],
    profile: "nette",
    providers: [phpNetteFrameworkProvider],
  }),
);
const CUSTOM_RUNTIME: PhpFrameworkRuntimeContext = {
  ...GENERIC_RUNTIME,
  hasProvider: (providerId) => providerId === "custom",
};

function selectActions(
  frameworkRuntime: PhpFrameworkRuntimeContext | undefined,
  legacyIsLaravelFrameworkActive = false,
) {
  return activePhpFrameworkCodeActions({
    collectPhpLaravelViewTargets: vi.fn(async () => [{ name: "dashboard" }]),
    frameworkRuntime,
    legacyIsLaravelFrameworkActive,
    readTestFileIfExists: vi.fn(async () => null),
    workspaceRoot: ROOT,
  });
}

describe("phpFrameworkCodeActionContributionRegistry", () => {
  it("activates the Laravel contribution when views are supported", () => {
    expect(selectActions(LARAVEL_RUNTIME).contributions).toHaveLength(1);
  });

  it.each([
    ["generic", GENERIC_RUNTIME],
    ["Nette", NETTE_RUNTIME],
    ["custom", CUSTOM_RUNTIME],
  ])("does not expose Laravel actions for the %s provider", (_, runtime) => {
    expect(selectActions(runtime).contributions).toEqual([]);
  });

  it("requires the Laravel views capability", () => {
    const runtime: PhpFrameworkRuntimeContext = {
      ...LARAVEL_RUNTIME,
      supports: (capability) => capability !== "views",
    };

    expect(selectActions(runtime, true).contributions).toEqual([]);
  });

  it("keeps the legacy Laravel activation fallback without a runtime", () => {
    expect(selectActions(undefined, true).contributions).toHaveLength(1);
  });

  it("preserves the missing Blade view creation descriptor", async () => {
    const { createMissingBladeViewCodeAction } = selectActions(LARAVEL_RUNTIME);
    const source = "@include('orders.show')";
    const start = source.indexOf("orders.show");

    await expect(
      createMissingBladeViewCodeAction(
        source,
        { end: start + "orders.show".length, start: start + 1 },
        "blade",
        () => true,
      ),
    ).resolves.toEqual({
      edits: [],
      isPreferred: true,
      kind: "quickfix",
      newFile: {
        content: "",
        path: `${ROOT}/resources/views/orders/show.blade.php`,
        title: "Create Blade View",
      },
      title: "Create Blade view orders.show",
    });
  });
});
