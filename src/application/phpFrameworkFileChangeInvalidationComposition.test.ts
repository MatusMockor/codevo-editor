import { describe, expect, it, vi } from "vitest";
import { composePhpFrameworkFileChangeInvalidationContributions } from "./phpFrameworkFileChangeInvalidationComposition";
import type { PhpFrameworkPlugin } from "./phpFrameworkPlugin";
import { phpFrameworkPlugins } from "./phpFrameworkPluginCatalog";

describe("composePhpFrameworkFileChangeInvalidationContributions", () => {
  it("owns concrete Blade and Nette callback wiring outside the generic registry", () => {
    const contributions =
      composePhpFrameworkFileChangeInvalidationContributions({
        invalidateBladeComponentNamesForPath: vi.fn(),
        invalidateBladeViewDataEntriesForPath: vi.fn(),
        invalidateLatteExpressionDataForPath: vi.fn(),
        invalidateNeonConfigForPath: vi.fn(),
      });

    expect(contributions.map(({ id }) => id)).toEqual([
      "blade-component-names",
      "blade-view-data-entries",
      "latte-expression-data",
      "neon-config",
    ]);
  });

  it("delegates cache cleanup to the framework-owned callback", () => {
    const invalidateNeonConfigForPath = vi.fn();
    const contributions =
      composePhpFrameworkFileChangeInvalidationContributions({
        invalidateBladeComponentNamesForPath: vi.fn(),
        invalidateBladeViewDataEntriesForPath: vi.fn(),
        invalidateLatteExpressionDataForPath: vi.fn(),
        invalidateNeonConfigForPath,
      });
    const neon = contributions.find(({ id }) => id === "neon-config");

    neon?.invalidate({
      rootPath: "/workspace-a",
      path: "/workspace-a/config/services.neon",
    });

    expect(invalidateNeonConfigForPath).toHaveBeenCalledWith(
      "/workspace-a",
      "/workspace-a/config/services.neon",
    );
  });

  it("derives the catalog from the plugin list without central edits", () => {
    const symfonyPlugin: PhpFrameworkPlugin = {
      features: {},
      provider: {
        appliesTo: () => false,
        id: "symfony",
        presentation: { activityLabel: "Symfony" },
      },
      invalidations: () => [
        {
          id: "twig-template-data",
          invalidate: vi.fn(),
          supports: ({ kind }) => kind === "twigTemplateData",
        },
      ],
    };
    const contributions = composePhpFrameworkFileChangeInvalidationContributions(
      {
        invalidateBladeComponentNamesForPath: vi.fn(),
        invalidateBladeViewDataEntriesForPath: vi.fn(),
        invalidateLatteExpressionDataForPath: vi.fn(),
        invalidateNeonConfigForPath: vi.fn(),
      },
      [...phpFrameworkPlugins, symfonyPlugin],
    );

    expect(contributions.map(({ id }) => id)).toEqual([
      "blade-component-names",
      "blade-view-data-entries",
      "latte-expression-data",
      "neon-config",
      "twig-template-data",
    ]);
  });

  it("rejects duplicate invalidation ids from separate plugins", () => {
    const duplicatePlugin: PhpFrameworkPlugin = {
      features: {},
      provider: {
        appliesTo: () => false,
        id: "duplicate-invalidation",
        presentation: { activityLabel: "Duplicate" },
      },
      invalidations: () => [
        {
          id: "neon-config",
          invalidate: vi.fn(),
          supports: () => true,
        },
      ],
    };

    expect(() =>
      composePhpFrameworkFileChangeInvalidationContributions(
        {
          invalidateBladeComponentNamesForPath: vi.fn(),
          invalidateBladeViewDataEntriesForPath: vi.fn(),
          invalidateLatteExpressionDataForPath: vi.fn(),
          invalidateNeonConfigForPath: vi.fn(),
        },
        [...phpFrameworkPlugins, duplicatePlugin],
      ),
    ).toThrowError(/Duplicate PHP framework registration id "neon-config"/);
  });
});
