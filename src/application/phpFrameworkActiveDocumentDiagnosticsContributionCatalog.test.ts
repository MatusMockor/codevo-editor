import { describe, expect, it } from "vitest";
import { createPhpFrameworkActiveDocumentDiagnosticsContributionCatalog } from "./phpFrameworkActiveDocumentDiagnosticsContributionCatalog";
import type { PhpFrameworkActiveDocumentDiagnosticsContribution } from "./phpFrameworkActiveDocumentDiagnosticsContributions";

function contribution(
  id: string,
): PhpFrameworkActiveDocumentDiagnosticsContribution {
  return {
    id,
    supports: () => false,
    provideDiagnostics: async () => [],
  };
}

describe("createPhpFrameworkActiveDocumentDiagnosticsContributionCatalog", () => {
  it("rejects duplicate contribution ids", () => {
    expect(() =>
      createPhpFrameworkActiveDocumentDiagnosticsContributionCatalog([
        contribution("duplicate"),
        contribution("duplicate"),
      ]),
    ).toThrowError(
      "Duplicate PHP active-document diagnostics contribution id: duplicate",
    );
  });

  it("returns an immutable catalog copy", () => {
    const source = [contribution("first")];
    const catalog =
      createPhpFrameworkActiveDocumentDiagnosticsContributionCatalog(source);

    source.push(contribution("second"));

    expect(catalog.map((item) => item.id)).toEqual(["first"]);
    expect(Object.isFrozen(catalog)).toBe(true);
  });
});
