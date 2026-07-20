import { describe, expect, it, vi } from "vitest";
import { composePhpFrameworkActiveDocumentDiagnosticsContributions } from "./phpFrameworkActiveDocumentDiagnosticsComposition";
import type { PhpFrameworkPlugin } from "./phpFrameworkPlugin";
import { phpFrameworkPlugins } from "./phpFrameworkPluginCatalog";

describe("composePhpFrameworkActiveDocumentDiagnosticsContributions", () => {
  it("composes concrete framework adapters outside the neutral registry", () => {
    const catalog = composePhpFrameworkActiveDocumentDiagnosticsContributions({
      collectCompleteLatteTemplateRelativePaths: vi.fn(async () => []),
      collectViewTargets: vi.fn(async () => []),
      provideLattePresenterLinkDiagnostics: vi.fn(async () => []),
    });

    expect(catalog.map((contribution) => contribution.id)).toEqual([
      "bladeViewReferences",
      "latteTemplateReferences",
      "lattePresenterLinks",
    ]);
  });

  it("derives the catalog from the plugin list without central edits", () => {
    const symfonyPlugin: PhpFrameworkPlugin = {
      features: {},
      provider: {
        appliesTo: () => false,
        id: "symfony",
        presentation: { activityLabel: "Symfony" },
      },
      diagnostics: () => [
        {
          id: "twigTemplateReferences",
          provideDiagnostics: async () => [],
          supports: ({ kind }) => kind === "twigTemplateReferences",
        },
      ],
    };
    const catalog = composePhpFrameworkActiveDocumentDiagnosticsContributions(
      {
        collectCompleteLatteTemplateRelativePaths: vi.fn(async () => []),
        collectViewTargets: vi.fn(async () => []),
        provideLattePresenterLinkDiagnostics: vi.fn(async () => []),
      },
      [...phpFrameworkPlugins, symfonyPlugin],
    );

    expect(catalog.map((contribution) => contribution.id)).toEqual([
      "bladeViewReferences",
      "latteTemplateReferences",
      "lattePresenterLinks",
      "twigTemplateReferences",
    ]);
  });

  it("rejects duplicate contribution ids from separate plugins", () => {
    const duplicatePlugin: PhpFrameworkPlugin = {
      features: {},
      provider: {
        appliesTo: () => false,
        id: "duplicate-diagnostics",
        presentation: { activityLabel: "Duplicate" },
      },
      diagnostics: () => [
        {
          id: "bladeViewReferences",
          provideDiagnostics: async () => [],
          supports: () => true,
        },
      ],
    };

    expect(() =>
      composePhpFrameworkActiveDocumentDiagnosticsContributions(
        {
          collectCompleteLatteTemplateRelativePaths: vi.fn(async () => []),
          collectViewTargets: vi.fn(async () => []),
          provideLattePresenterLinkDiagnostics: vi.fn(async () => []),
        },
        [...phpFrameworkPlugins, duplicatePlugin],
      ),
    ).toThrowError(/Duplicate PHP framework registration id "bladeViewReferences"/);
  });
});
