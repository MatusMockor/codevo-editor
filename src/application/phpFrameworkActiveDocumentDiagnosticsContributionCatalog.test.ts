import { describe, expect, it } from "vitest";
import {
  activeDocumentDiagnosticsContributionForDescriptor,
  createPhpFrameworkActiveDocumentDiagnosticsContributionCatalog,
} from "./phpFrameworkActiveDocumentDiagnosticsContributionCatalog";
import type { PhpFrameworkActiveDocumentDiagnosticsContribution } from "./phpFrameworkActiveDocumentDiagnosticsContributions";

function contribution(
  id: string,
  priority = 0,
): PhpFrameworkActiveDocumentDiagnosticsContribution {
  return {
    id,
    priority,
    supports: ({ kind }) => kind === "future-framework",
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

  it("selects future framework diagnostics by stable priority", () => {
    const catalog =
      createPhpFrameworkActiveDocumentDiagnosticsContributionCatalog([
        contribution("first-high", 10),
        contribution("lower", 1),
        contribution("second-high", 10),
      ]);

    expect(
      activeDocumentDiagnosticsContributionForDescriptor(catalog, {
        kind: "future-framework",
        language: "php",
      })?.id,
    ).toBe("first-high");
  });
});
