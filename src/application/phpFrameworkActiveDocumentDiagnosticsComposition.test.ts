import { describe, expect, it, vi } from "vitest";
import { composePhpFrameworkActiveDocumentDiagnosticsContributions } from "./phpFrameworkActiveDocumentDiagnosticsComposition";

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
});
