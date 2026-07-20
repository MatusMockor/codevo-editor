import type {
  PhpFrameworkFileChangeInvalidationContribution,
  PhpFrameworkFileChangeInvalidationDescriptorLike,
} from "./phpFrameworkFileChangeInvalidationContributions";
import {
  createPhpFrameworkContributionCatalog,
  firstPhpFrameworkContributionForDescriptor,
} from "./phpFrameworkContributionCatalog";

export type PhpFrameworkFileChangeInvalidationContributionCatalog =
  readonly PhpFrameworkFileChangeInvalidationContribution[];

export function createPhpFrameworkFileChangeInvalidationContributionCatalog(
  contributions: readonly PhpFrameworkFileChangeInvalidationContribution[],
): PhpFrameworkFileChangeInvalidationContributionCatalog {
  return createPhpFrameworkContributionCatalog(contributions, {
    duplicateIdMessage: (id) =>
      `Duplicate PHP file-change invalidation contribution id: ${id}`,
  });
}

export function fileChangeInvalidationContributionForDescriptor(
  catalog: PhpFrameworkFileChangeInvalidationContributionCatalog,
  descriptor: PhpFrameworkFileChangeInvalidationDescriptorLike,
): PhpFrameworkFileChangeInvalidationContribution | null {
  return firstPhpFrameworkContributionForDescriptor(catalog, descriptor);
}
