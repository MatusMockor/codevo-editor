import { describe, expect, it, vi } from "vitest";
import { createPhpFrameworkCodeActionContributionCatalog } from "./phpFrameworkCodeActionContributionCatalog";
import type { PhpFrameworkPlugin } from "./phpFrameworkPlugin";
import { phpFrameworkPlugins } from "./phpFrameworkPluginCatalog";

describe("phpFrameworkCodeActionContributionCatalog", () => {
  it("composes framework code-action adapters outside the generic registry", () => {
    expect(
      createPhpFrameworkCodeActionContributionCatalog({
        collectViewTargets: vi.fn(async () => []),
        readTestFileIfExists: vi.fn(async () => null),
        workspaceRoot: "/workspace",
      }).map(({ id }) => id),
    ).toEqual(["missing-template-file", "nette-presenter-link-method"]);
  });

  it("derives the catalog from the plugin list without central edits", () => {
    const symfonyPlugin: PhpFrameworkPlugin = {
      features: {},
      provider: {
        appliesTo: () => false,
        id: "symfony",
        presentation: { activityLabel: "Symfony" },
      },
      codeActions: () => [
        {
          contributionsFor: () => [],
          id: "symfony-route-method",
          priority: 80,
        },
      ],
    };

    expect(
      createPhpFrameworkCodeActionContributionCatalog(
        {
          collectViewTargets: vi.fn(async () => []),
          readTestFileIfExists: vi.fn(async () => null),
          workspaceRoot: "/workspace",
        },
        [...phpFrameworkPlugins, symfonyPlugin],
      ).map(({ id }) => id),
    ).toEqual([
      "missing-template-file",
      "nette-presenter-link-method",
      "symfony-route-method",
    ]);
  });

  it("rejects duplicate adapter ids from separate plugins", () => {
    const duplicatePlugin: PhpFrameworkPlugin = {
      features: {},
      provider: {
        appliesTo: () => false,
        id: "duplicate-code-actions",
        presentation: { activityLabel: "Duplicate" },
      },
      codeActions: () => [
        {
          contributionsFor: () => [],
          id: "missing-template-file",
        },
      ],
    };

    expect(() =>
      createPhpFrameworkCodeActionContributionCatalog(
        {
          collectViewTargets: vi.fn(async () => []),
          readTestFileIfExists: vi.fn(async () => null),
          workspaceRoot: "/workspace",
        },
        [...phpFrameworkPlugins, duplicatePlugin],
      ),
    ).toThrowError(/Duplicate PHP framework registration id "missing-template-file"/);
  });
});
