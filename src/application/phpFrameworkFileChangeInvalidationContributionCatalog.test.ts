import { describe, expect, it, vi } from "vitest";
import {
  createPhpFrameworkFileChangeInvalidationContributionCatalog,
  fileChangeInvalidationContributionForDescriptor,
} from "./phpFrameworkFileChangeInvalidationContributionCatalog";
import type { PhpFrameworkFileChangeInvalidationContribution } from "./phpFrameworkFileChangeInvalidationContributions";

function contribution(
  id: string,
  priority = 0,
): PhpFrameworkFileChangeInvalidationContribution {
  return {
    id,
    priority,
    supports: ({ kind }) => kind === "future-framework-cache",
    invalidate: vi.fn(),
  };
}

describe("phpFrameworkFileChangeInvalidationContributionCatalog", () => {
  it("rejects duplicate contribution ids", () => {
    expect(() =>
      createPhpFrameworkFileChangeInvalidationContributionCatalog([
        contribution("duplicate"),
        contribution("duplicate"),
      ]),
    ).toThrowError(
      "Duplicate PHP file-change invalidation contribution id: duplicate",
    );
  });

  it("returns an immutable catalog copy", () => {
    const source = [contribution("first")];
    const catalog =
      createPhpFrameworkFileChangeInvalidationContributionCatalog(source);

    source.push(contribution("second"));

    expect(catalog.map((item) => item.id)).toEqual(["first"]);
    expect(Object.isFrozen(catalog)).toBe(true);
  });

  it("supports future framework descriptors without changing the registry", () => {
    const catalog = createPhpFrameworkFileChangeInvalidationContributionCatalog(
      [contribution("lower", 1), contribution("higher", 10)],
    );

    expect(
      fileChangeInvalidationContributionForDescriptor(catalog, {
        kind: "future-framework-cache",
      })?.id,
    ).toBe("higher");
  });
});
