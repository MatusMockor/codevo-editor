import { describe, expect, it } from "vitest";
import {
  createPhpFrameworkContributionCatalog,
  firstPhpFrameworkContributionForDescriptor,
  type PhpFrameworkSynchronousContribution,
} from "./phpFrameworkContributionCatalog";

interface Descriptor {
  readonly kind: string;
}

function contribution(
  id: string,
  priority = 0,
  supportedKind = "supported",
): PhpFrameworkSynchronousContribution<Descriptor> {
  return {
    id,
    priority,
    supports: ({ kind }) => kind === supportedKind,
  };
}

describe("phpFrameworkContributionCatalog", () => {
  it("rejects duplicate ids with the catalog-specific message", () => {
    expect(() =>
      createPhpFrameworkContributionCatalog(
        [contribution("duplicate"), contribution("duplicate")],
        {
          duplicateIdMessage: (id) => `Duplicate test contribution: ${id}`,
        },
      ),
    ).toThrowError("Duplicate test contribution: duplicate");
  });

  it("creates an immutable copy without mutating registration order", () => {
    const source = [contribution("first"), contribution("second", 10)];
    const catalog = createPhpFrameworkContributionCatalog(source, {
      duplicateIdMessage: (id) => id,
    });

    source.push(contribution("third"));

    expect(catalog.map(({ id }) => id)).toEqual(["first", "second"]);
    expect(Object.isFrozen(catalog)).toBe(true);
  });

  it("selects the highest-priority supported contribution", () => {
    const catalog = createPhpFrameworkContributionCatalog(
      [
        contribution("unsupported", 100, "other"),
        contribution("lower", 1),
        contribution("higher", 10),
      ],
      { duplicateIdMessage: (id) => id },
    );

    expect(
      firstPhpFrameworkContributionForDescriptor(catalog, {
        kind: "supported",
      })?.id,
    ).toBe("higher");
  });

  it("uses registration order as the deterministic priority tiebreak", () => {
    const catalog = createPhpFrameworkContributionCatalog(
      [contribution("first", 10), contribution("second", 10)],
      { duplicateIdMessage: (id) => id },
    );

    expect(
      firstPhpFrameworkContributionForDescriptor(catalog, {
        kind: "supported",
      })?.id,
    ).toBe("first");
  });

  it("returns null when no contribution supports the descriptor", () => {
    const catalog = createPhpFrameworkContributionCatalog(
      [contribution("other", 0, "other")],
      { duplicateIdMessage: (id) => id },
    );

    expect(
      firstPhpFrameworkContributionForDescriptor(catalog, {
        kind: "supported",
      }),
    ).toBeNull();
  });
});
