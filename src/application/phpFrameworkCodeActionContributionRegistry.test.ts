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
    collectViewTargets: vi.fn(async () => [{ name: "dashboard" }]),
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
    ["custom", CUSTOM_RUNTIME],
  ])("does not expose Laravel actions for the %s provider", (_, runtime) => {
    expect(selectActions(runtime).contributions).toEqual([]);
  });

  it("activates the Nette contribution when PHP presenter links are supported", () => {
    expect(selectActions(NETTE_RUNTIME).contributions).toHaveLength(1);
  });

  it("routes presenter-link actions only through the Nette contribution", async () => {
    const source = `<?php

use Nette\\Application\\UI\\Presenter;

class ProductPresenter extends Presenter
{
    public function renderDefault(): void
    {
        $this->link('show');
    }
}
`;
    const start = source.indexOf("show");
    const range = { end: start + "show".length, start };
    const isRequestedRootActive = () => true;
    const netteContribution = selectActions(NETTE_RUNTIME).contributions[0];

    await expect(
      netteContribution?.(source, range, isRequestedRootActive),
    ).resolves.toEqual([
      expect.objectContaining({ title: "Create actionShow" }),
      expect.objectContaining({ title: "Create renderShow" }),
    ]);

    await expect(
      Promise.all(
        selectActions(LARAVEL_RUNTIME).contributions.map((contribution) =>
          contribution(source, range, isRequestedRootActive),
        ),
      ),
    ).resolves.toEqual([null]);
    expect(selectActions(GENERIC_RUNTIME).contributions).toEqual([]);
  });

  it("requires the Nette PHP presenter links capability", () => {
    const runtime: PhpFrameworkRuntimeContext = {
      ...NETTE_RUNTIME,
      supports: (capability) => capability !== "phpPresenterLinks",
    };

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
