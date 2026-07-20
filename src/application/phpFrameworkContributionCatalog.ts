import { orderPhpFrameworkRegistrationsByPriority } from "./phpFrameworkRegistrationOrdering";

export interface PhpFrameworkSynchronousContribution<TDescriptor> {
  readonly id: string;
  readonly priority?: number;
  supports(descriptor: TDescriptor): boolean;
}

interface PhpFrameworkContributionCatalogOptions {
  readonly duplicateIdMessage: (id: string) => string;
}

/**
 * Owns registration policy for synchronous framework contribution catalogs.
 * Async ownership and cancellation remain the responsibility of
 * PhpFrameworkScopedRegistry.
 */
export function createPhpFrameworkContributionCatalog<
  TContribution extends { readonly id: string },
>(
  contributions: readonly TContribution[],
  { duplicateIdMessage }: PhpFrameworkContributionCatalogOptions,
): readonly TContribution[] {
  assertUniqueContributionIds(contributions, duplicateIdMessage);

  return Object.freeze([...contributions]);
}

export function firstPhpFrameworkContributionForDescriptor<
  TDescriptor,
  TContribution extends PhpFrameworkSynchronousContribution<TDescriptor>,
>(
  catalog: readonly TContribution[],
  descriptor: TDescriptor,
): TContribution | null {
  const matching = orderPhpFrameworkRegistrationsByPriority(
    catalog.filter((contribution) => contribution.supports(descriptor)),
  );

  return matching[0] ?? null;
}

function assertUniqueContributionIds(
  contributions: readonly { readonly id: string }[],
  duplicateIdMessage: (id: string) => string,
): void {
  const seen = new Set<string>();

  for (const contribution of contributions) {
    if (seen.has(contribution.id)) {
      throw new Error(duplicateIdMessage(contribution.id));
    }

    seen.add(contribution.id);
  }
}
