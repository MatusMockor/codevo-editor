import type {
  PhpFrameworkFileChangeInvalidationContribution,
  PhpFrameworkFileChangeInvalidationDescriptorLike,
} from "./phpFrameworkFileChangeInvalidationContributions";
import { orderPhpFrameworkRegistrationsByPriority } from "./phpFrameworkRegistrationOrdering";

export type PhpFrameworkFileChangeInvalidationContributionCatalog =
  readonly PhpFrameworkFileChangeInvalidationContribution[];

export function createPhpFrameworkFileChangeInvalidationContributionCatalog(
  contributions: readonly PhpFrameworkFileChangeInvalidationContribution[],
): PhpFrameworkFileChangeInvalidationContributionCatalog {
  assertUniqueContributionIds(contributions);

  return Object.freeze([...contributions]);
}

export function fileChangeInvalidationContributionForDescriptor(
  catalog: PhpFrameworkFileChangeInvalidationContributionCatalog,
  descriptor: PhpFrameworkFileChangeInvalidationDescriptorLike,
): PhpFrameworkFileChangeInvalidationContribution | null {
  const matching = orderPhpFrameworkRegistrationsByPriority(
    catalog.filter((contribution) => contribution.supports(descriptor)),
  );

  return matching[0] ?? null;
}

function assertUniqueContributionIds(
  contributions: readonly PhpFrameworkFileChangeInvalidationContribution[],
): void {
  const seen = new Set<string>();

  for (const contribution of contributions) {
    if (seen.has(contribution.id)) {
      throw new Error(
        `Duplicate PHP file-change invalidation contribution id: ${contribution.id}`,
      );
    }

    seen.add(contribution.id);
  }
}
