import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
import { describe, expect, it, vi } from "vitest";

import { activePhpFrameworkCodeActions } from "./phpFrameworkCodeActionContributionRegistry";
import { createPhpFrameworkCodeActionContributionCatalog } from "./phpFrameworkCodeActionContributionCatalog";
import type { PhpFrameworkCodeActionContributionAdapter } from "./phpFrameworkCodeActionContributions";
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
  providers: [{ id: "custom" }],
  hasProvider: (providerId) => providerId === "custom",
  supports: (capability) => capability === "codeActions",
};

function selectActions(
  frameworkRuntime: PhpFrameworkRuntimeContext,
  contributionAdapters?: readonly PhpFrameworkCodeActionContributionAdapter[],
) {
  const adapters =
    contributionAdapters ??
    createPhpFrameworkCodeActionContributionCatalog({
      collectViewTargets: vi.fn(async () => [{ name: "dashboard" }]),
      readTestFileIfExists: vi.fn(async () => null),
      workspaceRoot: ROOT,
    });

  return activePhpFrameworkCodeActions({
    contributionAdapters: adapters,
    frameworkRuntime,
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

  it("requires the code-actions capability", () => {
    const runtime: PhpFrameworkRuntimeContext = {
      ...NETTE_RUNTIME,
      supports: (capability) => capability !== "codeActions",
    };

    expect(selectActions(runtime).contributions).toEqual([]);
  });

  it("requires the Laravel code-actions capability", () => {
    const runtime: PhpFrameworkRuntimeContext = {
      ...LARAVEL_RUNTIME,
      supports: (capability) => capability !== "codeActions",
    };

    expect(selectActions(runtime).contributions).toEqual([]);
  });

  it("routes missing-template actions through a neutral contribution", async () => {
    const [missingTemplateContribution] =
      selectActions(LARAVEL_RUNTIME).contributions;
    const source = "<?php\n\nreturn view('orders.show');\n";
    const cursor = source.indexOf("orders.show") + "orders.sh".length;

    await expect(
      missingTemplateContribution?.(
        source,
        { end: cursor, start: cursor },
        () => true,
      ),
    ).resolves.toEqual([
      {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        newFile: {
          content: "",
          path: `${ROOT}/resources/views/orders/show.blade.php`,
          title: "Create Blade View",
        },
        title: "Create Blade view orders.show",
      },
    ]);
  });

  it("runs framework-neutral adapters in stable priority order", async () => {
    const adapter = (
      id: string,
      priority: number,
    ): PhpFrameworkCodeActionContributionAdapter => ({
      contributionsFor: () => [
        {
          id,
          providePhpCodeAction: async () => [
            {
              edits: [],
              kind: "quickfix",
              title: id,
            },
          ],
        },
      ],
      id,
      priority,
    });
    const { contributions } = selectActions(CUSTOM_RUNTIME, [
      adapter("last", 10),
      adapter("first", 20),
    ]);

    await expect(
      Promise.all(
        contributions.map((contribution) =>
          contribution("<?php", { end: 0, start: 0 }, () => true),
        ),
      ),
    ).resolves.toEqual([
      [expect.objectContaining({ title: "first" })],
      [expect.objectContaining({ title: "last" })],
    ]);
  });

  it("rejects duplicate contribution adapter ids", () => {
    const duplicate: PhpFrameworkCodeActionContributionAdapter = {
      contributionsFor: () => [],
      id: "duplicate",
    };

    expect(() => selectActions(CUSTOM_RUNTIME, [duplicate, duplicate])).toThrow(
      /Duplicate PHP framework registration id "duplicate"/,
    );
  });

  it("orders active contributions globally across providers", async () => {
    const multiProviderRuntime: PhpFrameworkRuntimeContext = {
      ...CUSTOM_RUNTIME,
      providers: [{ id: "first-provider" }, { id: "second-provider" }],
    };
    const adapter: PhpFrameworkCodeActionContributionAdapter = {
      contributionsFor: (provider) => [
        {
          id: provider.id,
          priority: provider.id === "second-provider" ? 200 : 10,
          providePhpCodeAction: async () => [
            { edits: [], kind: "quickfix", title: provider.id },
          ],
        },
      ],
      id: "multi-provider",
    };
    const { contributions } = selectActions(multiProviderRuntime, [adapter]);

    await expect(
      Promise.all(
        contributions.map((contribution) =>
          contribution("<?php", { end: 0, start: 0 }, () => true),
        ),
      ),
    ).resolves.toEqual([
      [expect.objectContaining({ title: "second-provider" })],
      [expect.objectContaining({ title: "first-provider" })],
    ]);
  });

  it("rejects duplicate active contribution identities", () => {
    const multiProviderRuntime: PhpFrameworkRuntimeContext = {
      ...CUSTOM_RUNTIME,
      providers: [{ id: "first-provider" }, { id: "second-provider" }],
    };
    const adapter: PhpFrameworkCodeActionContributionAdapter = {
      contributionsFor: () => [
        {
          id: "duplicate-action",
          providePhpCodeAction: async () => null,
        },
      ],
      id: "multi-provider",
    };

    expect(() => selectActions(multiProviderRuntime, [adapter])).toThrow(
      /Duplicate PHP framework registration id "duplicate-action" in active PHP framework code-action contributions/,
    );
  });
});
